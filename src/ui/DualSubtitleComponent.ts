/**
 * Dual Subtitle UI Component for LinguaTube
 * Displays dual-language subtitles over the YouTube video player with clickable words,
 * customization options, and proper isolation using shadow DOM
 */

import {
  PlayerInteractionService,
  SubtitleSyncEvent,
  ActiveSubtitleCue,
} from '../youtube/PlayerInteractionService';
import { StorageService } from '../storage';
import { UserSettings } from '../storage/types';
import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { VocabularyObserver, VocabularyEventType } from '../vocabulary/VocabularyObserver';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';
import { sortedPhrases } from '../subtitles/gazetter';

// ========================================
// Types and Interfaces
// ========================================

export interface DualSubtitleConfig {
  readonly showTargetLanguage: boolean;
  readonly showNativeLanguage: boolean;
  readonly fontSize: number; // 12-32px
  readonly fontFamily: string;
  readonly targetLanguageColor: string;
  readonly nativeLanguageColor: string;
  readonly backgroundColor: string;
  readonly opacity: number; // 0.1-1.0
  readonly verticalOffset: number; // -100 to 100 (percentage)
  readonly horizontalAlignment: 'left' | 'center' | 'right';
  readonly lineSpacing: number; // 1.0-2.0
  readonly wordSpacing: number; // 0.5-2.0
  readonly containerPadding: number; // 4-20px
  readonly borderRadius: number; // 0-8px
  readonly maxWidth: number; // 50-95% of player width
  readonly animationEnabled: boolean;
  readonly transitionDuration: number; // 100-500ms
  readonly clickableWords: boolean;
  readonly wordHighlightColor: string;
  readonly autoHideNative: boolean; // Hide native when target is clicked
  readonly textShadow: boolean;
  readonly textShadowColor: string;
}

export interface SubtitleCueDisplay {
  readonly id: string;
  readonly targetText: string;
  readonly nativeText: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly isActive: boolean;
  readonly words: WordSegment[];
}

export interface WordSegment {
  readonly text: string;
  readonly index: number;
  readonly isClickable: boolean;
  readonly translation?: string;
  readonly partOfSpeech?: string;
}

export interface SubtitlePosition {
  readonly x: number; // pixels from left
  readonly y: number; // pixels from top
  readonly width: number; // container width
  readonly height: number; // container height
}

export interface WordClickEvent {
  readonly word: string;
  readonly translation?: string;
  readonly context: string;
  readonly timestamp: number;
  readonly cueId: string;
  readonly position: { x: number; y: number };
}

export type WordClickCallback = (event: WordClickEvent) => void;
export type SubtitleVisibilityCallback = (visible: boolean, cueCount: number) => void;

// ========================================
// CSS Constants and Styling
// ========================================

const DEFAULT_CONFIG: DualSubtitleConfig = {
  showTargetLanguage: true,
  showNativeLanguage: true,
  fontSize: 24,
  fontFamily: '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
  targetLanguageColor: '#ffffff',
  nativeLanguageColor: '#cccccc',
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  opacity: 0.95,
  verticalOffset: -20, // 20% from bottom
  horizontalAlignment: 'center',
  lineSpacing: 1.2,
  wordSpacing: 1.0,
  containerPadding: 12,
  borderRadius: 4,
  maxWidth: 80,
  animationEnabled: true,
  transitionDuration: 200,
  clickableWords: true,
  wordHighlightColor: '#ffff00',
  autoHideNative: false,
  textShadow: true,
  textShadowColor: 'rgba(0, 0, 0, 0.8)',
};

const SUBTITLE_CONTAINER_STYLES = `
  :host {
    /* CSS Custom Properties for theming */
    --subtitle-font-size: 24px;
    --subtitle-font-family: "YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif;
    --subtitle-target-color: #ffffff;
    --subtitle-native-color: #cccccc;
    --subtitle-bg-color: rgba(0, 0, 0, 0.8);
    --subtitle-opacity: 0.95;
    --subtitle-padding: 12px;
    --subtitle-border-radius: 4px;
    --subtitle-line-spacing: 1.2;
    --subtitle-word-spacing: 1.0;
    --subtitle-highlight-color: #ffff00;
    --subtitle-transition-duration: 200ms;
    --subtitle-text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
    
    /* Container positioning */
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647; /* Maximum z-index to stay above YouTube controls */
    font-size: 0; /* Reset font size for precise control */
  }

  .subtitle-container {
    position: absolute;
    max-width: var(--subtitle-max-width, 80%);
    padding: var(--subtitle-padding);
    background-color: var(--subtitle-bg-color);
    border-radius: var(--subtitle-border-radius);
    opacity: var(--subtitle-opacity);
    transform: translateX(-50%);
    pointer-events: auto;
    box-sizing: border-box;
    transition: all var(--subtitle-transition-duration) ease-in-out;
  }

  .subtitle-container.hidden {
    opacity: 0;
    transform: translateX(-50%) translateY(10px);
    pointer-events: none;
  }

  .subtitle-line {
    display: block;
    text-align: center;
    line-height: var(--subtitle-line-spacing);
    margin: 0;
    padding: 2px 0;
    word-spacing: calc(var(--subtitle-word-spacing) * 0.2em);
  }

  .subtitle-line.target {
    font-size: var(--subtitle-font-size);
    font-family: var(--subtitle-font-family);
    color: var(--subtitle-target-color);
    font-weight: 600;
    text-shadow: var(--subtitle-text-shadow);
    margin-bottom: 4px;
  }

  .subtitle-line.native {
    font-size: calc(var(--subtitle-font-size) * 0.85);
    font-family: var(--subtitle-font-family);
    color: var(--subtitle-native-color);
    font-weight: 400;
    text-shadow: var(--subtitle-text-shadow);
  }

  .clickable-word {
    display: inline;
    cursor: pointer;
    padding: 1px 2px;
    border-radius: 2px;
    transition: background-color var(--subtitle-transition-duration) ease;
    position: relative;
  }

  .clickable-word:hover {
    background-color: var(--subtitle-highlight-color);
    color: #000000;
    text-shadow: none;
  }

  .clickable-word:active {
    background-color: var(--subtitle-highlight-color);
    color: #000000;
    transform: scale(0.98);
  }

  /* Vocabulary highlighting styles */
  .clickable-word.highlighted,
  .clickable-word.vocabulary-word {
    background-color: rgba(255, 235, 59, 0.8) !important;
    color: #000000 !important;
    text-shadow: none !important;
    border: 1px solid #ffc107;
    box-shadow: 0 0 4px rgba(255, 193, 7, 0.5);
    font-weight: 600;
  }

  .clickable-word.vocabulary-word:hover {
    background-color: rgba(255, 193, 7, 0.9) !important;
    box-shadow: 0 0 6px rgba(255, 193, 7, 0.7);
    transform: scale(1.02);
  }

  .clickable-word.vocabulary-word::after {
    content: '📚';
    position: absolute;
    top: -8px;
    right: -8px;
    font-size: 10px;
    background: rgba(255, 193, 7, 0.9);
    border-radius: 50%;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #ffc107;
  }

  /* High contrast mode for vocabulary words */
  @media (prefers-contrast: high) {
    .clickable-word.vocabulary-word {
      background-color: #ffff00 !important;
      color: #000000 !important;
      border: 2px solid #000000;
    }
  }

  /* Reduced motion for vocabulary highlighting */
  @media (prefers-reduced-motion: reduce) {
    .clickable-word.vocabulary-word {
      transition: none;
      transform: none;
    }
    
    .clickable-word.vocabulary-word:hover {
      transform: none;
    }
  }

  .subtitle-container.compact .subtitle-line.native {
    display: none;
  }

  .subtitle-container.fade-in {
    animation: subtitleFadeIn var(--subtitle-transition-duration) ease-out;
  }

  .subtitle-container.fade-out {
    animation: subtitleFadeOut var(--subtitle-transition-duration) ease-in;
  }

  @keyframes subtitleFadeIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(10px);
    }
    to {
      opacity: var(--subtitle-opacity);
      transform: translateX(-50%) translateY(0);
    }
  }

  @keyframes subtitleFadeOut {
    from {
      opacity: var(--subtitle-opacity);
      transform: translateX(-50%) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(-10px);
    }
  }

  /* Responsive adjustments */
  @media (max-width: 768px) {
    .subtitle-container {
      max-width: 95%;
      padding: calc(var(--subtitle-padding) * 0.8);
    }
    
    .subtitle-line.target {
      font-size: calc(var(--subtitle-font-size) * 0.9);
    }
    
    .subtitle-line.native {
      font-size: calc(var(--subtitle-font-size) * 0.75);
    }
  }

  /* High contrast mode support */
  @media (prefers-contrast: high) {
    .subtitle-container {
      background-color: rgba(0, 0, 0, 0.95);
      border: 1px solid #ffffff;
    }
    
    .subtitle-line.target {
      color: #ffffff;
      text-shadow: 2px 2px 0px #000000;
    }
    
    .subtitle-line.native {
      color: #e0e0e0;
      text-shadow: 2px 2px 0px #000000;
    }
  }

  /* Reduced motion support */
  @media (prefers-reduced-motion: reduce) {
    .subtitle-container,
    .clickable-word {
      transition: none;
    }
    
    .subtitle-container.fade-in,
    .subtitle-container.fade-out {
      animation: none;
    }
  }
`;

// ========================================
// Main Dual Subtitle Component Class
// ========================================

export class DualSubtitleComponent {
  private container: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private subtitleContainer: HTMLElement | null = null;
  private targetLine: HTMLElement | null = null;
  private nativeLine: HTMLElement | null = null;

  private config: DualSubtitleConfig = { ...DEFAULT_CONFIG };
  private currentCues: SubtitleCueDisplay[] = [];
  private isVisible: boolean = false;
  private isInitialized: boolean = false;

  private playerService: PlayerInteractionService;
  private storageService: StorageService;
  private vocabularyManager: VocabularyManager;
  private vocabularyObserver: VocabularyObserver;

  private wordClickListeners: Set<WordClickCallback> = new Set();
  private visibilityListeners: Set<SubtitleVisibilityCallback> = new Set();

  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private lastPlayerSize: { width: number; height: number } = { width: 0, height: 0 };

  private subtitleSyncHandler: (event: SubtitleSyncEvent) => void;
  private vocabularyCache: Map<string, string> = new Map();
  private vocabularyEventUnsubscribers: (() => void)[] = [];
  private readonly logger = Logger.getInstance();

  constructor(
    playerService: PlayerInteractionService,
    storageService: StorageService,
    initialConfig?: Partial<DualSubtitleConfig>,
  ) {
    this.playerService = playerService;
    this.storageService = storageService;

    this.vocabularyManager = VocabularyManager.getInstance();
    this.vocabularyObserver = VocabularyObserver.getInstance();

    if (initialConfig) {
      this.config = { ...this.config, ...initialConfig };
    }

    this.subtitleSyncHandler = this.handleSubtitleSync.bind(this);
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  public async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) {
        this.logger?.warn('Already initialized', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {},
        });
        return true;
      }

      this.logger?.info('Starting initialization', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Load config from storage first
      this.logger?.debug('Loading config from storage', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      await this.loadConfigFromStorage();
      this.logger?.debug('Config loaded from storage', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Find YouTube player container
      this.logger?.debug('Finding YouTube player container', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      const playerContainer = this.findPlayerContainer();
      if (!playerContainer) {
        this.logger?.error('Could not find YouTube player container', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {},
        });
        return false;
      }
      this.logger?.debug('Player container found', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Create shadow DOM container
      this.logger?.debug('Creating container', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      this.container = this.createContainer();
      if (!this.container) {
        this.logger?.error('Failed to create container', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {},
        });
        return false;
      }
      this.logger?.debug('Container created', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Attach to player
      this.logger?.debug('Attaching to player', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      playerContainer.appendChild(this.container);
      this.logger?.debug('Attached to player', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Create shadow root and content
      this.logger?.debug('Creating shadow DOM', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      this.createShadowDOM();
      this.createSubtitleElements();
      this.applyConfiguration();
      this.logger?.debug('Shadow DOM created', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Set up observers
      this.logger?.debug('Setting up observers', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      this.setupResizeObserver();
      this.setupMutationObserver();
      this.setupVocabularyEventListeners();
      this.logger?.debug('Observers set up', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Connect to subtitle sync
      this.logger?.debug('Connecting to subtitle sync', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      this.playerService.addSubtitleSyncListener(this.subtitleSyncHandler);
      this.logger?.debug('Connected to subtitle sync', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      this.isInitialized = true;
      this.logger?.info('Initialized successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      return true;
    } catch (error) {
      this.logger?.error('Initialization failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return false;
    }
  }

  public destroy(): void {
    try {
      // Remove from player sync
      if (this.playerService) {
        this.playerService.removeSubtitleSyncListener(this.subtitleSyncHandler);
      }

      // Clean up observers
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }

      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }

      // Remove DOM elements
      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }

      // Clear references
      this.container = null;
      this.shadowRoot = null;
      this.subtitleContainer = null;
      this.targetLine = null;
      this.nativeLine = null;

      // Clear listeners
      this.wordClickListeners.clear();
      this.visibilityListeners.clear();

      // Clean up vocabulary event listeners
      this.vocabularyEventUnsubscribers.forEach((unsubscribe) => unsubscribe());
      this.vocabularyEventUnsubscribers = [];

      // Clear vocabulary cache
      this.vocabularyCache.clear();

      this.isInitialized = false;
      this.logger?.info('Destroyed successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
    } catch (error) {
      this.logger?.error('Destroy failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private findPlayerContainer(): HTMLElement | null {
    const selectors = [
      '#movie_player',
      '.html5-video-player',
      '[data-layer="0"]',
      '.ytp-player-content',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector) as HTMLElement;
      if (element && this.isValidPlayerContainer(element)) {
        return element;
      }
    }

    return null;
  }

  private isValidPlayerContainer(element: HTMLElement): boolean {
    const video = element.querySelector('video');
    return video !== null && element.offsetWidth > 0 && element.offsetHeight > 0;
  }

  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'linguatube-subtitle-overlay';
    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
    `;
    return container;
  }

  private createShadowDOM(): void {
    if (!this.container) return;

    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    // Create and inject styles
    const styleSheet = document.createElement('style');
    styleSheet.textContent = SUBTITLE_CONTAINER_STYLES;
    this.shadowRoot.appendChild(styleSheet);
  }

  private createSubtitleElements(): void {
    if (!this.shadowRoot) return;

    // Create main subtitle container
    this.subtitleContainer = document.createElement('div');
    this.subtitleContainer.className = 'subtitle-container hidden';

    // Create target language line
    this.targetLine = document.createElement('div');
    this.targetLine.className = 'subtitle-line target';

    // Create native language line
    this.nativeLine = document.createElement('div');
    this.nativeLine.className = 'subtitle-line native';

    // Assemble structure
    this.subtitleContainer.appendChild(this.targetLine);
    this.subtitleContainer.appendChild(this.nativeLine);
    this.shadowRoot.appendChild(this.subtitleContainer);
  }

  // ========================================
  // Configuration Management
  // ========================================

  private async loadConfigFromStorage(): Promise<void> {
    try {
      const result = await this.storageService.getSettings();
      if (result.success && result.data) {
        this.updateConfigFromSettings(result.data);
      }
    } catch (error) {
      this.logger?.warn('Failed to load config from storage', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private updateConfigFromSettings(settings: UserSettings): void {
    const { subtitle, ui } = settings;

    this.config = {
      ...this.config,
      showTargetLanguage: subtitle.showSource,
      showNativeLanguage: subtitle.showNative,
      fontSize: subtitle.fontSize,
      fontFamily: subtitle.fontFamily,
      targetLanguageColor: subtitle.textColor,
      backgroundColor: subtitle.backgroundColor,
      opacity: subtitle.opacity,
      lineSpacing: subtitle.lineHeight,
      wordSpacing: subtitle.wordSpacing,
      animationEnabled: ui.animationsEnabled,
      verticalOffset: subtitle.position === 'top' ? 10 : subtitle.position === 'center' ? 0 : -20,
    };

    if (this.isInitialized) {
      this.applyConfiguration();
    }
  }

  public updateConfig(newConfig: Partial<DualSubtitleConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.applyConfiguration();
  }

  public getConfig(): DualSubtitleConfig {
    return { ...this.config };
  }

  private applyConfiguration(): void {
    if (!this.shadowRoot || !this.subtitleContainer) return;

    // Update CSS custom properties
    const root = this.shadowRoot.host as HTMLElement;
    root.style.setProperty('--subtitle-font-size', `${this.config.fontSize}px`);
    root.style.setProperty('--subtitle-font-family', this.config.fontFamily);
    root.style.setProperty('--subtitle-target-color', this.config.targetLanguageColor);
    root.style.setProperty('--subtitle-native-color', this.config.nativeLanguageColor);
    root.style.setProperty('--subtitle-bg-color', this.config.backgroundColor);
    root.style.setProperty('--subtitle-opacity', this.config.opacity.toString());
    root.style.setProperty('--subtitle-padding', `${this.config.containerPadding}px`);
    root.style.setProperty('--subtitle-border-radius', `${this.config.borderRadius}px`);
    root.style.setProperty('--subtitle-line-spacing', this.config.lineSpacing.toString());
    root.style.setProperty('--subtitle-word-spacing', this.config.wordSpacing.toString());
    root.style.setProperty('--subtitle-highlight-color', this.config.wordHighlightColor);
    root.style.setProperty('--subtitle-transition-duration', `${this.config.transitionDuration}ms`);
    root.style.setProperty('--subtitle-max-width', `${this.config.maxWidth}%`);

    if (this.config.textShadow) {
      root.style.setProperty(
        '--subtitle-text-shadow',
        `2px 2px 4px ${this.config.textShadowColor}`,
      );
    } else {
      root.style.setProperty('--subtitle-text-shadow', 'none');
    }

    // Update positioning
    this.updateSubtitlePosition();

    // Update visibility based on config
    if (this.targetLine) {
      this.targetLine.style.display = this.config.showTargetLanguage ? 'block' : 'none';
    }
    if (this.nativeLine) {
      this.nativeLine.style.display = this.config.showNativeLanguage ? 'block' : 'none';
    }
  }

  // ========================================
  // Subtitle Display Management
  // ========================================

  private handleSubtitleSync(event: SubtitleSyncEvent): void {
    switch (event.type) {
      case 'cue_start':
        if (event.cue) {
          this.addActiveCue(event.cue);
        }
        break;
      case 'cue_end':
        if (event.cue) {
          this.removeActiveCue(event.cue.id);
        }
        break;
      case 'cue_update':
        this.updateActiveCues(event.activeCues);
        break;
      case 'track_change':
        this.clearSubtitles();
        break;
    }
  }

  private addActiveCue(cue: ActiveSubtitleCue): void {
    // Create display cue with word segmentation
    const displayCue: SubtitleCueDisplay = {
      id: cue.id,
      targetText: cue.text,
      nativeText: cue.nativeText || '', // Will be populated by translation service
      startTime: cue.startTime,
      endTime: cue.endTime,
      isActive: true,
      words: this.segmentWords(cue.text),
    };

    this.currentCues.push(displayCue);
    this.updateSubtitleDisplay();
  }

  private removeActiveCue(cueId: string): void {
    this.currentCues = this.currentCues.filter((cue) => cue.id !== cueId);
    this.updateSubtitleDisplay();
  }

  private updateActiveCues(activeCues: ActiveSubtitleCue[]): void {
    // Update existing cues and add new ones
    const newCueIds = new Set(activeCues.map((cue) => cue.id));

    // Remove cues that are no longer active
    this.currentCues = this.currentCues.filter((cue) => newCueIds.has(cue.id));

    // Add or update cues
    for (const cue of activeCues) {
      const existingIndex = this.currentCues.findIndex((c) => c.id === cue.id);
      if (existingIndex === -1) {
        this.addActiveCue(cue);
      }
    }
  }

  /**
   * Enhanced word segmentation for multiple languages including Thai
   * Uses Thai linguistic rules from http://www.thai-language.com/ref/breaking-words
   */
  private segmentWords(text: string): WordSegment[] {
    if (!text) return [];

    this.logger?.debug('Segmenting text', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { text, textLength: text.length },
    });

    // Detect if text contains Thai characters
    const containsThai = /[\u0E00-\u0E7F]/.test(text);

    if (containsThai) {
      return this.segmentThaiText(text);
    } else {
      // For non-Thai languages, use simple space-based segmentation
      return this.segmentNonThaiText(text);
    }
  }

  /**
   * Thai word segmentation using linguistic rules
   */
  private segmentThaiText(text: string): WordSegment[] {
    const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
    const wordSegments = Array.from(segmenter.segment(text))
      .map((s) => s.segment.trim())
      .filter((s) => s.replace(/\s+/g, '').length > 0);

    const words: string[] = [];
    let i = 0;
    while (i < wordSegments.length) {
      let matched = false;

      // Step 2: Attempt to match the longest possible phrase first.
      // We check for phrases up to a reasonable length (e.g., 30 words).
      for (let len = Math.min(30, wordSegments.length - i); len > 1; len--) {
        const potentialPhrase = wordSegments.slice(i, i + len).join('');

        if (sortedPhrases.includes(potentialPhrase)) {
          words.push(potentialPhrase);
          i += len; // Advance the index by the length of the matched phrase
          matched = true;
          break; // Exit the inner loop once the longest match is found
        }
      }

      // Step 3: If no multi-word phrase was matched, add the single token.
      if (!matched) {
        words.push(wordSegments[i]);
        i++;
      }
    }

    const segments = words.map((word, index) => ({
      text: word,
      index,
      isClickable: word.length > 1,
      translation: undefined,
      partOfSpeech: undefined,
    }));

    this.logger?.debug('Thai text segmented', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        segmentCount: segments.length,
        words: segments.map((s) => s.text),
      },
    });
    return segments;
  }

  /**
   * Non-Thai word segmentation (space-based)
   */
  private segmentNonThaiText(text: string): WordSegment[] {
    const words: string[] = [];

    // Split on spaces first
    const spaceSeparatedParts = text.split(/\s+/).filter((part) => part.length > 0);

    for (const part of spaceSeparatedParts) {
      // Further split by punctuation while preserving letters/numbers
      const subWords = part.match(/[\p{L}\p{N}]+/gu) || [];
      words.push(...subWords);
    }

    const segments = words.map((word, index) => ({
      text: word,
      index,
      isClickable: word.length > 0,
      translation: undefined,
      partOfSpeech: undefined,
    }));

    this.logger?.debug('Non-Thai text segmented', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        segmentCount: segments.length,
        words: segments.map((s) => s.text),
      },
    });
    return segments;
  }

  private updateSubtitleDisplay(): void {
    if (!this.targetLine || !this.nativeLine) return;

    // Combine all active cues
    const combinedTarget = this.currentCues.map((cue) => cue.targetText).join(' ');
    const combinedNative = this.currentCues.map((cue) => cue.nativeText).join(' ');

    // Update target language line with clickable words
    if (this.config.showTargetLanguage) {
      this.renderTargetLine(combinedTarget);
    }

    // Update native language line
    if (this.config.showNativeLanguage) {
      this.nativeLine.textContent = combinedNative || '';
    }

    if (combinedNative || combinedTarget) {
      this.showSubtitles();
    }
  }

  private renderTargetLine(text: string): void {
    if (!this.targetLine) return;

    this.logger?.debug('Rendering target line', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { text, textLength: text.length },
    });

    if (!this.config.clickableWords) {
      this.targetLine.textContent = text;
      return;
    }

    // Clear existing content
    this.targetLine.innerHTML = '';

    // Get renderTargetLineed words
    const words = this.segmentWords(text);

    if (words.length === 0) {
      this.targetLine.textContent = text;
      return;
    }

    // Create a more robust rendering approach
    let currentText = text.replace(/\s+/g, '').trim();
    let wordIndex = 0;

    // Process each word and render it with surrounding text
    while (wordIndex < words.length && currentText.length > 0) {
      const word = words[wordIndex];
      const wordStartIndex = currentText.indexOf(word.text);

      if (wordStartIndex === -1) {
        // Word not found, skip it
        wordIndex++;
        continue;
      }

      // Add any text before the word (spaces, punctuation, etc.)
      const beforeWord = currentText.substring(0, wordStartIndex);
      if (beforeWord.length > 0) {
        const textNode = document.createTextNode(beforeWord);
        this.targetLine.appendChild(textNode);
      }

      // Create clickable word span
      const wordSpan = document.createElement('span');
      wordSpan.className = 'clickable-word';
      wordSpan.textContent = word.text;

      // Check if word is in vocabulary and add appropriate class
      this.checkVocabularyWord(word.text)
        .then((isVocabularyWord: boolean) => {
          if (isVocabularyWord) {
            wordSpan.classList.add('vocabulary-word');
          }
        })
        .catch((error) => {
          this.logger?.warn('Error checking vocabulary word', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: {
              word: word.text,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        });

      wordSpan.addEventListener('click', (event) => {
        this.logger?.debug('Word clicked', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { word: word.text },
        });
        this.handleWordClick(word.text, event);
      });

      this.targetLine.appendChild(wordSpan);

      // Move to the next part of the text
      currentText = currentText.substring(wordStartIndex + word.text.length);
      wordIndex++;
    }

    // Add any remaining text
    if (currentText.length > 0) {
      const textNode = document.createTextNode(currentText);
      this.targetLine.appendChild(textNode);
    }

    this.logger?.debug('Rendered clickable words', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { wordCount: words.length },
    });
  }

  private handleWordClick(word: string, event: MouseEvent): void {
    if (!this.config.clickableWords) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const cleanedWord = word.trim(); // Simple cleaning - just remove whitespace

    this.logger?.debug('Handling word click', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { cleanedWord },
    });

    const wordClickEvent: WordClickEvent = {
      word: cleanedWord,
      translation: undefined, // Will be populated by translation service
      context: this.currentCues.map((cue) => cue.targetText).join(' '),
      timestamp: this.playerService.getCurrentTime(),
      cueId: this.currentCues[0]?.id || '',
      position: {
        x: rect.left + rect.width / 2,
        y: rect.bottom, // Use bottom edge so popup appears below the word
      },
    };

    this.logger?.debug('Word click event created', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        word: wordClickEvent.word,
        context: wordClickEvent.context,
        timestamp: wordClickEvent.timestamp,
        listenerCount: this.wordClickListeners.size,
      },
    });

    // Notify all word click listeners
    this.wordClickListeners.forEach((listener) => {
      try {
        this.logger?.debug('Calling word click listener', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {},
        });
        listener(wordClickEvent);
      } catch (error) {
        this.logger?.error('Error in word click listener', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    });
  }

  private showSubtitles(): void {
    if (!this.subtitleContainer || this.isVisible) return;

    this.isVisible = true;
    this.subtitleContainer.classList.remove('hidden');

    if (this.config.animationEnabled) {
      this.subtitleContainer.classList.add('fade-in');
      setTimeout(() => {
        if (this.subtitleContainer) {
          this.subtitleContainer.classList.remove('fade-in');
        }
      }, this.config.transitionDuration);
    }

    this.notifyVisibilityChange(true, this.currentCues.length);
  }

  private hideSubtitles(): void {
    if (!this.subtitleContainer || !this.isVisible) return;

    this.isVisible = false;

    if (this.config.animationEnabled) {
      this.subtitleContainer.classList.add('fade-out');
      setTimeout(() => {
        if (this.subtitleContainer) {
          this.subtitleContainer.classList.remove('fade-out');
          this.subtitleContainer.classList.add('hidden');
        }
      }, this.config.transitionDuration);
    } else {
      this.subtitleContainer.classList.remove('hidden');
    }

    this.notifyVisibilityChange(false, 0);
  }

  private clearSubtitles(): void {
    this.currentCues = [];
    this.updateSubtitleDisplay();
  }

  // ========================================
  // Positioning and Layout
  // ========================================

  private updateSubtitlePosition(): void {
    if (!this.subtitleContainer) return;

    const playerSize = this.getPlayerSize();
    if (!playerSize) return;

    const { width, height } = playerSize;

    // Calculate vertical position based on offset percentage
    const verticalPixels = (this.config.verticalOffset / 100) * height;
    const bottomPosition = Math.max(50, Math.abs(verticalPixels) - height * 0.1);

    // Calculate horizontal position based on alignment
    let leftPosition = '50%'; // Center by default
    if (this.config.horizontalAlignment === 'left') {
      leftPosition = '10%';
    } else if (this.config.horizontalAlignment === 'right') {
      leftPosition = '90%';
    }

    this.subtitleContainer.style.bottom = `${bottomPosition}px`;
    this.subtitleContainer.style.left = leftPosition;
    this.subtitleContainer.style.maxWidth = `${this.config.maxWidth}%`;
  }

  private getPlayerSize(): { width: number; height: number } | null {
    if (!this.container) return null;

    const playerContainer = this.container.parentElement;
    if (!playerContainer) return null;

    return {
      width: playerContainer.offsetWidth,
      height: playerContainer.offsetHeight,
    };
  }

  private setupResizeObserver(): void {
    if (!this.container) return;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width !== this.lastPlayerSize.width || height !== this.lastPlayerSize.height) {
          this.lastPlayerSize = { width, height };
          this.updateSubtitlePosition();
        }
      }
    });

    const playerContainer = this.container.parentElement;
    if (playerContainer) {
      this.resizeObserver.observe(playerContainer);
    }
  }

  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      let needsRepositioning = false;

      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'class' || mutation.attributeName === 'style')
        ) {
          needsRepositioning = true;
          break;
        }
      }

      if (needsRepositioning) {
        setTimeout(() => this.updateSubtitlePosition(), 100);
      }
    });

    const playerContainer = document.querySelector('#movie_player');
    if (playerContainer) {
      this.mutationObserver.observe(playerContainer, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        subtree: true,
      });
    }
  }

  private setupVocabularyEventListeners(): void {
    this.logger?.debug('Setting up vocabulary event listeners', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {},
    });

    // Listen for vocabulary changes that affect highlighting
    this.vocabularyEventUnsubscribers.push(
      this.vocabularyObserver.on(
        VocabularyEventType.WORD_ADDED,
        this.handleVocabularyChange.bind(this),
      ),
    );
    this.vocabularyEventUnsubscribers.push(
      this.vocabularyObserver.on(
        VocabularyEventType.WORD_REMOVED,
        this.handleVocabularyChange.bind(this),
      ),
    );
    this.vocabularyEventUnsubscribers.push(
      this.vocabularyObserver.on(
        VocabularyEventType.VOCABULARY_CLEARED,
        this.handleVocabularyChange.bind(this),
      ),
    );
    this.vocabularyEventUnsubscribers.push(
      this.vocabularyObserver.on(
        VocabularyEventType.VOCABULARY_IMPORTED,
        this.handleVocabularyChange.bind(this),
      ),
    );
    
    this.logger?.debug('Vocabulary event listeners set up', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { listenersCount: this.vocabularyEventUnsubscribers.length },
    });
  }

  private handleVocabularyChange(): void {
    this.logger?.debug('Vocabulary change detected - refreshing highlights', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { 
        isVisible: this.isVisible,
        currentCuesCount: this.currentCues.length,
        cacheSize: this.vocabularyCache.size
      },
    });

    // Clear vocabulary cache to force refresh
    this.vocabularyCache.clear();

    // Re-render current subtitles with updated highlighting
    if (this.isVisible && this.currentCues.length > 0) {
      this.updateSubtitleDisplay();
    }
  }

  // ========================================
  // Event Management
  // ========================================

  public addWordClickListener(listener: WordClickCallback): void {
    this.wordClickListeners.add(listener);
  }

  public removeWordClickListener(listener: WordClickCallback): void {
    this.wordClickListeners.delete(listener);
  }

  public addVisibilityListener(listener: SubtitleVisibilityCallback): void {
    this.visibilityListeners.add(listener);
  }

  public removeVisibilityListener(listener: SubtitleVisibilityCallback): void {
    this.visibilityListeners.delete(listener);
  }

  private notifyVisibilityChange(visible: boolean, cueCount: number): void {
    this.visibilityListeners.forEach((listener) => {
      try {
        listener(visible, cueCount);
      } catch (error) {
        this.logger?.error('Visibility listener error', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            visible,
            cueCount,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });
  }

  // ========================================
  // Public API
  // ========================================

  public isReady(): boolean {
    return this.isInitialized && this.container !== null && this.shadowRoot !== null;
  }

  public setVisibility(targetVisible: boolean, nativeVisible: boolean): void {
    this.config = {
      ...this.config,
      showTargetLanguage: targetVisible,
      showNativeLanguage: nativeVisible,
    };
    this.applyConfiguration();
    this.updateSubtitleDisplay();
  }

  public getCurrentCues(): SubtitleCueDisplay[] {
    return [...this.currentCues];
  }

  public setNativeTranslation(cueId: string, translation: string): void {
    const cue = this.currentCues.find((c) => c.id === cueId);
    if (cue) {
      (cue as any).nativeText = translation; // Type assertion for readonly property
      this.updateSubtitleDisplay();
    }
  }

  public highlightWord(word: string, highlight: boolean = true): void {
    if (!this.targetLine) return;

    const cleanWord = word.replace(/[^\w]/g, '').toLowerCase();
    const wordSpans = this.targetLine.querySelectorAll('.clickable-word');

    wordSpans.forEach((span) => {
      const spanText = span.textContent?.replace(/[^\w]/g, '').toLowerCase();
      if (spanText === cleanWord) {
        if (highlight) {
          span.classList.add('highlighted');
        } else {
          span.classList.remove('highlighted');
        }
      }
    });
  }

  /**
   * Highlight all vocabulary words in current subtitles
   */
  public async highlightVocabularyWords(): Promise<void> {
    if (!this.targetLine) return;

    const wordSpans = this.targetLine.querySelectorAll('.clickable-word');

    for (const span of wordSpans) {
      const word = span.textContent?.replace(/[^\w]/g, '') || '';
      if (word) {
        const isVocabularyWord = await this.checkVocabularyWord(word);
        if (isVocabularyWord) {
          span.classList.add('vocabulary-word');
        } else {
          span.classList.remove('vocabulary-word');
        }
      }
    }
  }

  /**
   * Remove all vocabulary highlighting
   */
  public clearVocabularyHighlighting(): void {
    if (!this.targetLine) return;

    const wordSpans = this.targetLine.querySelectorAll('.vocabulary-word');
    wordSpans.forEach((span) => {
      span.classList.remove('vocabulary-word');
    });
  }

  private async checkVocabularyWord(word: string): Promise<boolean> {
    // Use boolean cache instead of string cache for better performance
    if (this.vocabularyCache.has(word)) {
      return this.vocabularyCache.get(word) === 'true';
    }

    try {
      // Get the current source language from the subtitle track
      const currentTrack = this.playerService.getCurrentSubtitleTrack();
      const sourceLanguage = currentTrack?.language || 'auto';
      
      // Normalize the word - less aggressive than before, preserving more characters
      const cleanWord = word.trim().toLowerCase();
      
      // First try with the actual source language
      let isVocabularyWord = await this.vocabularyManager.isWordSaved(cleanWord, sourceLanguage);
      
      // If not found and source language is not one of the common ones, try fallback languages
      if (!isVocabularyWord && !['auto', 'en', 'es', 'fr', 'th', 'de'].includes(sourceLanguage)) {
        const fallbackLanguages = ['auto', 'en', 'es', 'fr', 'th', 'de'];
        
        for (const lang of fallbackLanguages) {
          isVocabularyWord = await this.vocabularyManager.isWordSaved(cleanWord, lang);
          if (isVocabularyWord) {
            break;
          }
        }
      }

      // Cache the result as a string to maintain compatibility with existing code
      this.vocabularyCache.set(word, isVocabularyWord.toString());
      return isVocabularyWord;
    } catch (error) {
      this.logger?.warn('Error checking vocabulary word', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }
}
