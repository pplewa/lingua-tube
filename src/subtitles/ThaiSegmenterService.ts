import { storageService } from '../storage';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';
import { phraseSet } from './gazetter';

export interface ThaiSegmenterConfig {
	enabled?: boolean;
	maxSpanLength: number; // maximum characters per merged span
	minCollocationCount: number; // minimum occurrences per video to consider merge
	pmiThreshold: number; // minimum PMI for merge candidate
	enableDictionaryBonus: boolean;
	enableAiHints: boolean; // optional per-video AI hints
	aiTopN?: number; // number of candidates to send to AI when enabled
	aiCooldownMinutes?: number; // minimum minutes between AI calls per video
	cacheTtlSeconds: number; // cache lifetime for per-video merges
	maxMergesPerVideo?: number; // cap of merges kept per video
}

export interface ThaiSegmentationDebugSnapshot {
	videoId: string;
	original: string[]; // baseline Intl.Segmenter tokens
	collocationApplied: string[]; // after per-video collocation DP
	aiApplied?: string[]; // after AI hints (if any)
}

export interface ThaiSegmenterHints {
	videoId: string;
	merges: Array<{ phrase: string; weight?: number }>; // AI-proposed merges
}

export class ThaiSegmenterService {
	private static instance: ThaiSegmenterService | null = null;
	private readonly logger = Logger.getInstance();
	private readonly config: ThaiSegmenterConfig;
	// In-memory per-video collocation cache
	private mergesByVideo = new Map<string, Set<string>>();
	private lastAiFetchByVideo = new Map<string, number>();
	private aiProvider: AiHintProvider | null = null;
	// Per-line AI segmentation cache: videoId -> (hash(text) -> tokens)
	private lineSegByVideo = new Map<string, Map<string, string[]>>();

	private constructor(config?: Partial<ThaiSegmenterConfig>) {
		this.config = {
			enabled: true,
			maxSpanLength: 10,
			minCollocationCount: 2,
			pmiThreshold: 3.0,
			enableDictionaryBonus: true,
			enableAiHints: true,
			aiTopN: 10000,
			aiCooldownMinutes: 60,
			cacheTtlSeconds: 24 * 60 * 60,
			maxMergesPerVideo: 10000,
			...config,
		};
	}

	public static getInstance(config?: Partial<ThaiSegmenterConfig>): ThaiSegmenterService {
		if (!ThaiSegmenterService.instance) {
			ThaiSegmenterService.instance = new ThaiSegmenterService(config);
		}
		return ThaiSegmenterService.instance;
	}

	// Normalize Thai string: NFC and strip zero-width / variation selectors
	private normalize(s: string): string {
		return (s || '')
			.normalize('NFC')
			.replace(/[\u200B-\u200D\uFE00-\uFE0F]/g, '')
			.trim();
	}

	public async warmUpForVideo(videoId: string, cuesText: string[]): Promise<void> {
		try {
			const merges = this.buildCollocations(cuesText);
      const set = new Set<string>(merges);
      this.mergesByVideo.set(videoId, set);
			await storageService.setCache(
        `thai_merges_${videoId}`,
        { phrases: merges, ts: Date.now() },
        this.config.cacheTtlSeconds,
      );

			// Optionally request AI hints (single, gated by cooldown)
			if (this.config.enableAiHints && this.aiProvider) {
				const now = Date.now();
				const last = this.lastAiFetchByVideo.get(videoId) || 0;
				const cooldownMs = (this.config.aiCooldownMinutes || 60) * 60 * 1000;
				if (now - last > cooldownMs) {
					const sample = merges.slice(0, this.config.aiTopN || 300);
					try {
						const hints = await this.aiProvider.fetchThaiMergeHints(videoId, sample);
						if (hints && hints.merges?.length) {
							await this.setAiMergeHints(hints);
							this.lastAiFetchByVideo.set(videoId, now);
						}
					} catch (e) {
						this.logger?.warn('AI hint fetch failed', {
							component: ComponentType.SUBTITLE_MANAGER,
							metadata: { error: e instanceof Error ? e.message : String(e) },
						});
					}
				}
			}
    } catch (error) {
			this.logger?.warn('Thai warm-up failed', {
				component: ComponentType.SUBTITLE_MANAGER,
				metadata: { error: error instanceof Error ? error.message : String(error) },
			});
		}
	}

	public async setAiMergeHints(hints: ThaiSegmenterHints): Promise<void> {
		try {
			const normalized = hints.merges.map((m) => this.normalize(m.phrase)).filter((p) => p.length > 0);
			const set = this.mergesByVideo.get(hints.videoId) || new Set<string>();
			normalized.forEach((p) => set.add(p));
			this.mergesByVideo.set(hints.videoId, set);
			await storageService.setCache(`thai_merges_${hints.videoId}`, { phrases: Array.from(set), ts: Date.now() }, this.config.cacheTtlSeconds);
		} catch (error) {
			this.logger?.warn('Failed to set AI merge hints', {
				component: ComponentType.SUBTITLE_MANAGER,
				metadata: { error: error instanceof Error ? error.message : String(error) },
			});
		}
	}

	public segment(text: string, videoId?: string, debug?: { capture?: boolean; sink?: (snapshot: ThaiSegmentationDebugSnapshot) => void }): string[] {
		if (this.config.enabled === false) {
			return this.tokenize(this.normalize(text));
		}
    const clean = this.normalize(text);
    if (!clean) return [];

		const baseTokens = this.tokenize(clean);
    if (baseTokens.length <= 1) return baseTokens;

		const merges = this.getVideoMerges(videoId);

    // Dynamic programming over tokens
    const n = baseTokens.length;
    const dp: number[] = new Array(n + 1).fill(Number.POSITIVE_INFINITY);
    const nextIdx: number[] = new Array(n + 1).fill(-1);
    dp[n] = 0;

    const maxSpan = Math.min(this.config.maxSpanLength, n);

    for (let i = n - 1; i >= 0; i--) {
      for (let len = 1; len <= maxSpan && i + len <= n; len++) {
        // Do not merge across boundary tokens; and boundary tokens cannot be merged with neighbors
        if (!this.canSpan(baseTokens, i, i + len)) continue;
        const phrase = baseTokens.slice(i, i + len).join('');
        const cost = this.spanCost(phrase, len, merges);
        const total = cost + dp[i + len];
        if (total < dp[i]) {
          dp[i] = total;
          nextIdx[i] = i + len;
        }
      }
    }

		// Reconstruct segmentation
    const output: string[] = [];
    let idx = 0;
    while (idx >= 0 && idx < n && nextIdx[idx] > idx) {
      const j = nextIdx[idx];
      output.push(baseTokens.slice(idx, j).join(''));
      idx = j;
    }
    if (output.length === 0) return baseTokens; // Fallback

		// Optional debug snapshot capture
		if (debug?.capture && typeof debug.sink === 'function' && videoId) {
			try {
				debug.sink({ videoId, original: baseTokens, collocationApplied: output });
			} catch {}
		}
    return output;
  }

  // ==============================
  // Internals
  // ==============================

  private tokenize(text: string): string[] {
    const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    return Array.from(segmenter.segment(text))
      .map((s) => this.normalize(s.segment))
      .filter((s) => s.length > 0);
  }

	private getVideoMerges(videoId?: string): Set<string> {
    if (!videoId) return new Set<string>();
    let set = this.mergesByVideo.get(videoId);
    if (set) return set;
    // Try to hydrate from cache synchronously-best-effort (note: storage is async; we skip await to keep runtime cost low)
    // Caller paths usually warmUp first; this is just a fallback.
    (async () => {
      const cached = await storageService.getCache<{ phrases: string[] }>(`thai_merges_${videoId}`);
      if (cached.success && cached.data?.phrases) {
        const s = new Set<string>(cached.data.phrases.map((p) => this.normalize(p)));
        this.mergesByVideo.set(videoId, s);
      }
    })().catch(() => {});
		return new Set<string>();
  }

  private isBoundaryToken(token: string): boolean {
    // Treat any token containing characters outside Thai block as a hard boundary
    // This includes punctuation, spaces, Latin letters, digits, etc.
    return /[^\u0E00-\u0E7F]/.test(token);
  }

  private canSpan(tokens: string[], start: number, end: number): boolean {
    // end is exclusive
    if (end - start > 1) {
      for (let k = start; k < end; k++) {
        if (this.isBoundaryToken(tokens[k])) return false;
      }
    } else {
      // Single token spans are always allowed
      return true;
    }
    return true;
  }

  private spanCost(phrase: string, tokens: number, merges: Set<string>): number {
    // Lower is better. Start with base proportional to number of tokens to discourage fragmentation.
    let cost = tokens * 1.0;

    // Dictionary bonus (strong)
    if (this.config.enableDictionaryBonus && phraseSet.has(phrase)) {
      cost -= 2.0;
    }

    // Per-video merge bonus (medium)
    if (merges.has(phrase)) {
      cost -= 1.2;
    }

    // Synergy bonus: both dictionary and video merge support
    if (phraseSet.has(phrase) && merges.has(phrase)) {
      cost -= 0.5;
    }

    // Small penalty for very long spans to avoid over-merge
    if (phrase.length > this.config.maxSpanLength) {
      cost += 2.0;
    }
    // Keep cost floor
    if (cost < 0.05) cost = 0.05;
    return cost;
  }

	private buildCollocations(cuesText: string[]): string[] {
    // Build unigram, bigram, trigram counts from baseline tokens
    const unigram = new Map<string, number>();
    const bigram = new Map<string, number>(); // key: a|b
    const trigram = new Map<string, number>(); // key: a|b|c
    let totalTokens = 0;

    const add = (map: Map<string, number>, key: string) => {
      map.set(key, (map.get(key) || 0) + 1);
    };

    for (const raw of cuesText) {
      const tokens = this.tokenize(this.normalize(raw));
      if (tokens.length === 0) continue;
      totalTokens += tokens.length;
      for (let i = 0; i < tokens.length; i++) {
        add(unigram, tokens[i]);
        if (i + 1 < tokens.length) {
          add(bigram, tokens[i] + '|' + tokens[i + 1]);
        }
        if (i + 2 < tokens.length) {
          add(trigram, tokens[i] + '|' + tokens[i + 1] + '|' + tokens[i + 2]);
        }
      }
    }

    const pmi = (xy: number, x: number, y: number): number => {
      const eps = 1e-9;
      const pxy = xy / Math.max(1, totalTokens - 1);
      const px = x / Math.max(1, totalTokens);
      const py = y / Math.max(1, totalTokens);
      return Math.log2((pxy + eps) / (px * py + eps));
    };

    const merges = new Set<string>();

    // Evaluate bigrams with PMI
    for (const [key, c] of bigram.entries()) {
      if (c < this.config.minCollocationCount) continue;
      const [a, b] = key.split('|');
      const score = pmi(c, unigram.get(a) || 0, unigram.get(b) || 0);
      const phrase = a + b;
      if (phrase.length <= this.config.maxSpanLength && score >= this.config.pmiThreshold) {
        merges.add(phrase);
      }
    }

    // Evaluate trigrams using min of adjacent PMIs
    for (const [key, c] of trigram.entries()) {
      if (c < this.config.minCollocationCount + 1) continue;
      const [a, b, c3] = key.split('|');
      const ab = bigram.get(a + '|' + b) || 0;
      const bc = bigram.get(b + '|' + c3) || 0;
      if (!ab || !bc) continue;
      const pmi1 = pmi(ab, unigram.get(a) || 0, unigram.get(b) || 0);
      const pmi2 = pmi(bc, unigram.get(b) || 0, unigram.get(c3) || 0);
      const minPmi = Math.min(pmi1, pmi2);
      const phrase = a + b + c3;
      if (phrase.length <= this.config.maxSpanLength && minPmi >= this.config.pmiThreshold) {
        merges.add(phrase);
      }
    }

		// Limit set size via config (defaults to 10k)
		const maxKeep = Math.max(100, Math.min(this.config.maxMergesPerVideo || 10000, 20000));
		return Array.from(merges).slice(0, maxKeep);
  }

  // ==============================
  // Configuration / Provider API
  // ==============================

  public updateConfig(config: Partial<ThaiSegmenterConfig>): void {
    Object.assign(this.config, config);
  }

  public setAiHintProvider(provider: AiHintProvider | null): void {
    this.aiProvider = provider;
  }

  public isAiProviderActive(): boolean {
    return !!this.aiProvider;
  }

  /**
   * Force-fetch AI hints immediately for debugging, bypassing cooldown.
   */
  public async forceFetchAiHints(videoId: string): Promise<void> {
    if (!this.aiProvider) {
      this.logger?.debug('ThaiSegmenter forceFetchAiHints: AI provider not active', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { videoId },
      });
      return;
    }
    const existing = Array.from(this.getVideoMerges(videoId));
    if (existing.length === 0) {
      this.logger?.debug('ThaiSegmenter forceFetchAiHints: no candidate merges', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { videoId },
      });
      return;
    }
    const sample = existing.slice(0, this.config.aiTopN || 300);
    try {
      const hints = await this.aiProvider.fetchThaiMergeHints(videoId, sample);
      if (hints && hints.merges?.length) {
        await this.setAiMergeHints(hints);
        this.logger?.debug('ThaiSegmenter forceFetchAiHints applied', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { videoId, hintCount: hints.merges.length },
        });
      } else {
        this.logger?.debug('ThaiSegmenter forceFetchAiHints: no hints returned', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { videoId },
        });
      }
    } catch (e) {
      this.logger?.warn('ThaiSegmenter forceFetchAiHints failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { videoId, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

	// ==============================
	// Per-line AI segmentation (optional, cached)
	// ==============================

	private hash(text: string): string {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
		}
		return (h >>> 0).toString(36);
	}

	public getCachedLineSeg(videoId: string | undefined, text: string): string[] | null {
		if (!videoId) return null;
		const key = this.hash(this.normalize(text));
		const m = this.lineSegByVideo.get(videoId);
		if (m && m.has(key)) return m.get(key) || null;
		return null;
	}

	private setCachedLineSeg(videoId: string, text: string, tokens: string[]): void {
		if (!videoId) return;
		const key = this.hash(this.normalize(text));
		let m = this.lineSegByVideo.get(videoId);
		if (!m) {
			m = new Map<string, string[]>();
			this.lineSegByVideo.set(videoId, m);
		}
		m.set(key, tokens);
		// Persist best-effort
		(async () => {
			await storageService.setCache(`thai_seg_line_${videoId}_${key}`, { tokens }, 30 * 24 * 60 * 60);
		})().catch(() => {});
	}

	public async improveSegmentationAsync(
		videoId: string | undefined,
		text: string,
		baselineTokens: string[],
		currentTokens: string[],
	): Promise<string[] | null> {
		if (!videoId || !this.aiProvider) return null;
		const key = this.hash(this.normalize(text));
		// Try hydrate from storage
		const existing = this.getCachedLineSeg(videoId, text);
		if (existing && existing.length > 0) return existing;
		try {
			const cached = await storageService.getCache<{ tokens: string[] }>(`thai_seg_line_${videoId}_${key}`);
			if (cached.success && cached.data?.tokens?.length) {
				this.setCachedLineSeg(videoId, text, cached.data.tokens);
				return cached.data.tokens;
			}
		} catch {}

		// Only one AI call per video allowed: rely on global merge hints batch only.
		// Per-line adjudication is disabled by returning null here.
		return null;
	}
}

export const thaiSegmenterService = ThaiSegmenterService.getInstance();

// ==============================
// AI Hint Provider Interface
// ==============================
export interface AiHintProvider {
  fetchThaiMergeHints(videoId: string, candidatePhrases: string[]): Promise<ThaiSegmenterHints | null>;
  fetchThaiSegmentationLine(
    videoId: string,
    lineText: string,
    baselineTokens: string[],
  ): Promise<string[] | null>;
}

// ==============================
// Default OpenRouter AI Provider (wired to existing AI key path)
// ==============================

class OpenRouterThaiAiProvider implements AiHintProvider {
  private readonly logger = Logger.getInstance();
  private readonly apiKey: string;
  private readonly model = 'google/gemini-2.5-flash-lite-preview-06-17';

  public constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  public async fetchThaiMergeHints(
    videoId: string,
    candidatePhrases: string[],
  ): Promise<ThaiSegmenterHints | null> {
    if (!candidatePhrases || candidatePhrases.length === 0) {
      return null;
    }

    const prompt = this.buildPrompt(candidatePhrases);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://youtube.com',
          'X-Title': 'LinguaTube',
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          max_tokens: 800,
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        this.logger?.warn('AI provider HTTP error', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { status: response.status, statusText: response.statusText },
        });
        return null;
      }

      const data = await response.json();
      const text: string | undefined = data?.choices?.[0]?.text;
      if (!text) {
        this.logger?.warn('AI provider: empty response text', {
          component: ComponentType.SUBTITLE_MANAGER,
        });
        return null;
      }

      const merges = this.parseMerges(text);
      if (!merges || merges.length === 0) return null;

      return {
        videoId,
        merges: merges.map((phrase) => ({ phrase })),
      };
    } catch (error) {
      this.logger?.warn('AI provider request failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return null;
    }
  }

  public async fetchThaiSegmentationLine(
    videoId: string,
    lineText: string,
    baselineTokens: string[],
  ): Promise<string[] | null> {
    const prompt = this.buildSegmentationPrompt(lineText, baselineTokens);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://youtube.com',
          'X-Title': 'LinguaTube',
        },
        body: JSON.stringify({
          model: this.model,
          prompt,
          max_tokens: 800,
          temperature: 0.1,
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      const text: string | undefined = data?.choices?.[0]?.text;
      if (!text) return null;
      const tokens = this.parseSegmentation(text);
      return tokens && tokens.length ? tokens : null;
    } catch {
      return null;
    }
  }

  private buildPrompt(candidates: string[]): string {
    const sample = candidates.slice(0, 200); // keep prompt compact
    const list = sample.map((p) => `- ${p}`).join('\n');
    return (
      'You are assisting Thai word segmentation for subtitles.\n' +
      'Given a list of Thai candidate multi-token collocations observed within a single video,\n' +
      'return ONLY a compact JSON object with a field "merges" which is an array of unique Thai phrases to be merged as single tokens.\n' +
      'Prioritize high-confidence collocations and dictionary-like compounds.\n' +
      'Do NOT include explanations, code fences, or extra text.\n' +
      'Limit to at most 100 items.\n\n' +
      'CANDIDATES:\n' +
      list +
      '\n\n' +
      'Return JSON like: {"merges": ["แบคทีเรีย", "ยังเชื่อ", "คิดว่า", "ที่เรา"] }'
    );
  }

  private parseMerges(text: string): string[] | null {
    // Try direct JSON parse
    const tryParse = (s: string): any => {
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    };

    // Common case: model returns raw JSON
    const direct = tryParse(text.trim());
    if (direct && Array.isArray(direct.merges)) {
      return direct.merges.filter((x: unknown) => typeof x === 'string');
    }

    // Extract JSON blob between first '{' and last '}'
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const json = tryParse(text.slice(start, end + 1));
      if (json && Array.isArray(json.merges)) {
        return json.merges.filter((x: unknown) => typeof x === 'string');
      }
    }

    return null;
  }

  private buildSegmentationPrompt(lineText: string, baselineTokens: string[]): string {
    const baseline = baselineTokens.join(' ');
    return (
      'You are assisting Thai subtitle segmentation.\n' +
      'Given a Thai sentence and a baseline tokenization, return ONLY JSON with field "tokens" as an array of Thai tokens that preserve meaning by merging dictionary collocations.\n' +
      'Prefer compounds that change meaning when split.\n' +
      'Do not add Latin annotations. No code fences, no explanations.\n\n' +
      `SENTENCE: ${lineText}\n` +
      `BASELINE: ${baseline}\n` +
      'Return JSON like: {"tokens": ["ยังเชื่อคิดว่า", "สูตรนี้", ...] }'
    );
  }

  private parseSegmentation(text: string): string[] | null {
    const tryParse = (s: string): any => {
      try { return JSON.parse(s); } catch { return null; }
    };
    const direct = tryParse(text.trim());
    if (direct && Array.isArray(direct.tokens)) {
      return direct.tokens.filter((x: unknown) => typeof x === 'string');
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const obj = tryParse(text.slice(start, end + 1));
      if (obj && Array.isArray(obj.tokens)) {
        return obj.tokens.filter((x: unknown) => typeof x === 'string');
      }
    }
    return null;
  }
}

// Auto-wire provider if key is present via the same env path used in word lookup
const OPENROUTER_KEY: string | undefined =
  (import.meta.env && (import.meta.env as any).VITE_AI_API_KEY) ||
  (import.meta.env && (import.meta.env as any).VITE_OPENROUTER_API_KEY);
try {
  if (OPENROUTER_KEY && typeof OPENROUTER_KEY === 'string' && OPENROUTER_KEY.trim().length > 0) {
    const provider = new OpenRouterThaiAiProvider(OPENROUTER_KEY);
    thaiSegmenterService.setAiHintProvider(provider);
    // Provider enabled; keep silent in production to reduce console noise
  } else {
    // No key found; silent
  }
} catch {}


