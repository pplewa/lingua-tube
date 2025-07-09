// Text-to-Speech service using Web Speech API
// Handles speech synthesis with queue management, voice selection, and fallback mechanisms

import {
  TTSConfig,
  TTSRequest,
  TTSQueueItem,
  TTSVoiceInfo,
  TTSStats,
  TTSError,
  TTSErrorCode,
  ITTSService,
  LanguageCode
} from './types';
import { dictionaryApiService } from './DictionaryApiService';

// ============================================================================
// TTS Error Implementation
// ============================================================================

export class TTSErrorImpl extends Error implements TTSError {
  code: TTSErrorCode;
  details?: any;
  retryable: boolean;
  timestamp: number;

  constructor(message: string, code: TTSErrorCode, details?: any) {
    super(message);
    this.name = 'TTSError';
    this.code = code;
    this.details = details;
    this.retryable = this.isRetryableError(code);
    this.timestamp = Date.now();
  }

  private isRetryableError(code: TTSErrorCode): boolean {
    const retryableCodes = [
      TTSErrorCode.SYNTHESIS_FAILED,
      TTSErrorCode.AUDIO_INTERRUPTED,
      TTSErrorCode.BROWSER_LIMITATION
    ];
    
    return retryableCodes.includes(code);
  }
}

// ============================================================================
// TTS Service Implementation
// ============================================================================

export class TTSService implements ITTSService {
  private config: TTSConfig;
  private voices: SpeechSynthesisVoice[] = [];
  private voicesLoaded = false;
  private queue: TTSQueueItem[] = [];
  private processing = false;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private preferredVoices: Map<string, SpeechSynthesisVoice> = new Map();
  private stats: TTSStats;
  private queueTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.config = {
      defaultRate: 1.0,
      defaultPitch: 1.0,
      defaultVolume: 1.0,
      queueTimeout: 30000, // 30 seconds
      fallbackToAudio: true,
      preferredVoiceNames: {
        'en': ['Google US English', 'Microsoft Mark', 'Alex', 'Daniel'],
        'es': ['Google español', 'Microsoft Helena', 'Monica', 'Jorge'],
        'fr': ['Google français', 'Microsoft Hortense', 'Thomas', 'Amelie'],
        'de': ['Google Deutsch', 'Microsoft Hedda', 'Anna', 'Stefan'],
        'it': ['Google italiano', 'Microsoft Elsa', 'Alice', 'Luca'],
        'pt': ['Google português do Brasil', 'Microsoft Maria', 'Joana', 'Ricardo'],
        'ru': ['Google русский', 'Microsoft Irina', 'Milena', 'Yuri'],
        'ja': ['Google 日本語', 'Microsoft Haruka', 'Kyoko', 'Otoya'],
        'ko': ['Google 한국의', 'Microsoft Heami', 'Yuna', 'Hyuna'],
        'zh': ['Google 中文（普通话）', 'Microsoft Huihui', 'Ting-Ting', 'Sin-ji']
      }
    };

    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      fallbacksUsed: 0,
      averageDuration: 0,
      queueLength: 0,
      voicesAvailable: 0,
      lastRequestTime: 0
    };

    this.initializeVoices();
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize voices and set up event listeners
   */
  private async initializeVoices(): Promise<void> {
    if (!this.isSupported()) {
      console.warn('Speech synthesis not supported in this browser');
      return;
    }

    // Load voices immediately if available
    this.loadVoices();

    // Set up voice loading event listener
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => {
        this.loadVoices();
      };
    }

    // Trigger voice loading in Chrome
    speechSynthesis.getVoices();
  }

  /**
   * Load and categorize available voices
   */
  private loadVoices(): void {
    this.voices = speechSynthesis.getVoices();
    this.voicesLoaded = true;
    this.stats.voicesAvailable = this.voices.length;
    
    // Auto-select preferred voices for each language
    this.selectPreferredVoices();
    
    console.log(`TTS Service: Loaded ${this.voices.length} voices`);
  }

  /**
   * Automatically select preferred voices for each language
   */
  private selectPreferredVoices(): void {
    for (const [lang, preferredNames] of Object.entries(this.config.preferredVoiceNames)) {
      const langVoices = this.getVoicesForLanguage(lang as LanguageCode);
      
      // Try to find a preferred voice
      let selectedVoice: SpeechSynthesisVoice | undefined;
      
      for (const preferredName of preferredNames) {
        selectedVoice = langVoices.find(v => v.name.includes(preferredName));
        if (selectedVoice) break;
      }
      
      // Fall back to first available voice for the language
      if (!selectedVoice && langVoices.length > 0) {
        selectedVoice = langVoices[0];
      }
      
      if (selectedVoice) {
        this.preferredVoices.set(lang, selectedVoice);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Public API Methods
  // --------------------------------------------------------------------------

  /**
   * Speak text using default settings
   */
  async speak(text: string, language: LanguageCode = 'en'): Promise<void> {
    return this.speakWithOptions({
      text,
      language,
      rate: this.config.defaultRate,
      pitch: this.config.defaultPitch,
      volume: this.config.defaultVolume
    });
  }

  /**
   * Speak text with custom options
   */
  async speakWithOptions(request: TTSRequest): Promise<void> {
    this.validateRequest(request);

    // Wait for voices to load if not already loaded
    if (!this.voicesLoaded) {
      await this.waitForVoices();
    }

    return new Promise((resolve, reject) => {
      const queueItem: TTSQueueItem = {
        ...request,
        id: this.generateId(),
        timestamp: Date.now(),
        resolve,
        reject
      };

      this.enqueueItem(queueItem);
      this.processQueue();
    });
  }

  /**
   * Get all available voices
   */
  getAvailableVoices(): SpeechSynthesisVoice[] {
    return [...this.voices];
  }

  /**
   * Get voices for a specific language
   */
  getVoicesForLanguage(language: LanguageCode): SpeechSynthesisVoice[] {
    return this.voices.filter(voice => {
      const voiceLang = voice.lang.toLowerCase();
      const targetLang = language.toLowerCase();
      return voiceLang.startsWith(targetLang) || voiceLang.includes(targetLang);
    });
  }

  /**
   * Set preferred voice for a language
   */
  setPreferredVoice(language: LanguageCode, voice: SpeechSynthesisVoice): void {
    this.preferredVoices.set(language, voice);
  }

  /**
   * Set default speech rate
   */
  setRate(rate: number): void {
    this.config.defaultRate = Math.max(0.1, Math.min(10, rate));
  }

  /**
   * Set default speech pitch
   */
  setPitch(pitch: number): void {
    this.config.defaultPitch = Math.max(0, Math.min(2, pitch));
  }

  /**
   * Set default speech volume
   */
  setVolume(volume: number): void {
    this.config.defaultVolume = Math.max(0, Math.min(1, volume));
  }

  /**
   * Pause current speech
   */
  pause(): void {
    if (speechSynthesis.speaking) {
      speechSynthesis.pause();
    }
  }

  /**
   * Resume paused speech
   */
  resume(): void {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
    }
  }

  /**
   * Cancel current speech and clear queue
   */
  cancel(): void {
    // Cancel current synthesis
    speechSynthesis.cancel();
    
    // Clear queue
    this.queue.forEach(item => {
      if (this.queueTimeouts.has(item.id)) {
        clearTimeout(this.queueTimeouts.get(item.id)!);
        this.queueTimeouts.delete(item.id);
      }
      item.reject(this.createTTSError(
        'Speech cancelled',
        TTSErrorCode.AUDIO_INTERRUPTED,
        { itemId: item.id }
      ));
    });
    
    this.queue = [];
    this.processing = false;
    this.currentUtterance = null;
  }

  /**
   * Check if TTS is supported
   */
  isSupported(): boolean {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return speechSynthesis.speaking;
  }

  /**
   * Get service statistics
   */
  getStats(): TTSStats {
    return {
      ...this.stats,
      queueLength: this.queue.length
    };
  }

  // --------------------------------------------------------------------------
  // Queue Management
  // --------------------------------------------------------------------------

  /**
   * Add item to queue with timeout
   */
  private enqueueItem(item: TTSQueueItem): void {
    this.queue.push(item);
    this.stats.totalRequests++;
    
    // Set timeout for queue item
    const timeoutId = setTimeout(() => {
      this.handleQueueTimeout(item.id);
    }, this.config.queueTimeout);
    
    this.queueTimeouts.set(item.id, timeoutId);
  }

  /**
   * Process the queue
   */
  private processQueue(): void {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const item = this.queue.shift()!;
    
    // Clear timeout
    if (this.queueTimeouts.has(item.id)) {
      clearTimeout(this.queueTimeouts.get(item.id)!);
      this.queueTimeouts.delete(item.id);
    }

    this.speakItem(item);
  }

  /**
   * Speak a queue item
   */
  private async speakItem(item: TTSQueueItem): Promise<void> {
    const startTime = Date.now();
    
    try {
      const utterance = this.createUtterance(item);
      item.utterance = utterance;
      this.currentUtterance = utterance;

      // Set up event handlers
      utterance.onend = () => {
        this.handleSpeechEnd(item, startTime);
      };

      utterance.onerror = (event) => {
        this.handleSpeechError(item, event, startTime);
      };

      utterance.onstart = () => {
        this.stats.lastRequestTime = Date.now();
      };

      // Start speaking
      speechSynthesis.speak(utterance);

         } catch (error: unknown) {
       this.handleSpeechError(item, error, startTime);
     }
  }

  /**
   * Handle successful speech completion
   */
  private handleSpeechEnd(item: TTSQueueItem, startTime: number): void {
    const duration = Date.now() - startTime;
    this.updateStats(true, duration);
    
    this.processing = false;
    this.currentUtterance = null;
    
    item.resolve();
    this.processQueue();
  }

  /**
   * Handle speech errors with fallback
   */
  private async handleSpeechError(item: TTSQueueItem, error: unknown, startTime: number): Promise<void> {
    // Handle the unknown error type properly
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorForLog = error instanceof Error ? error : new Error(String(error || 'Unknown error'));
    
    console.error('TTS Error:', errorForLog);
    
    // Try fallback to audio URL if enabled
    if (this.config.fallbackToAudio && item.text.split(' ').length === 1) {
      try {
        await this.tryAudioFallback(item.text, item.language);
        this.stats.fallbacksUsed++;
        this.handleSpeechEnd(item, startTime);
        return;
      } catch (fallbackError) {
        console.error('Audio fallback failed:', fallbackError);
      }
    }

    // No fallback available or fallback failed
    this.updateStats(false, Date.now() - startTime);
    
    this.processing = false;
    this.currentUtterance = null;
    
    const ttsError = this.createTTSError(
      'Speech synthesis failed',
      TTSErrorCode.SYNTHESIS_FAILED,
      { originalError: errorMessage, item }
    );
    
    item.reject(ttsError);
    this.processQueue();
  }

  /**
   * Handle queue timeout
   */
  private handleQueueTimeout(itemId: string): void {
    const itemIndex = this.queue.findIndex(item => item.id === itemId);
    if (itemIndex !== -1) {
      const item = this.queue[itemIndex];
      this.queue.splice(itemIndex, 1);
      
      item.reject(this.createTTSError(
        'Queue timeout exceeded',
        TTSErrorCode.QUEUE_TIMEOUT,
        { itemId, timeout: this.config.queueTimeout }
      ));
    }
  }

  // --------------------------------------------------------------------------
  // Speech Synthesis
  // --------------------------------------------------------------------------

  /**
   * Create speech synthesis utterance
   */
  private createUtterance(item: TTSQueueItem): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(item.text);
    
    // Set language
    utterance.lang = this.getLanguageCode(item.language);
    
    // Set voice
    utterance.voice = item.voice || this.selectBestVoice(item.language);
    
    // Set speech parameters
    utterance.rate = item.rate || this.config.defaultRate;
    utterance.pitch = item.pitch || this.config.defaultPitch;
    utterance.volume = item.volume || this.config.defaultVolume;
    
    return utterance;
  }

  /**
   * Select the best voice for a language
   */
  private selectBestVoice(language: LanguageCode): SpeechSynthesisVoice | null {
    // Check for preferred voice
    const preferredVoice = this.preferredVoices.get(language);
    if (preferredVoice) {
      return preferredVoice;
    }

    // Find voices for the language
    const availableVoices = this.getVoicesForLanguage(language);
    if (availableVoices.length === 0) {
      return null;
    }

    // Prefer local voices over network voices
    const localVoices = availableVoices.filter(v => v.localService);
    if (localVoices.length > 0) {
      return localVoices[0];
    }

    // Fall back to first available voice
    return availableVoices[0];
  }

  /**
   * Try audio fallback using dictionary API
   */
  private async tryAudioFallback(text: string, language: LanguageCode): Promise<void> {
    if (language !== 'en') {
      throw new Error('Audio fallback only available for English');
    }

    try {
      const audioUrl = await dictionaryApiService.getPronunciationUrl(text, language);
      await this.playAudioUrl(audioUrl);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Audio fallback failed: ${errorMessage}`);
    }
  }

  /**
   * Play audio from URL
   */
  private playAudioUrl(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Audio playback failed'));
      audio.oncanplaythrough = () => audio.play();
      
      audio.load();
    });
  }

  // --------------------------------------------------------------------------
  // Utilities
  // --------------------------------------------------------------------------

  /**
   * Wait for voices to load
   */
  private waitForVoices(): Promise<void> {
    return new Promise((resolve) => {
      if (this.voicesLoaded) {
        resolve();
        return;
      }

      const checkVoices = () => {
        if (this.voicesLoaded) {
          resolve();
        } else {
          setTimeout(checkVoices, 100);
        }
      };

      checkVoices();
    });
  }

  /**
   * Validate TTS request
   */
  private validateRequest(request: TTSRequest): void {
    if (!request.text || typeof request.text !== 'string' || request.text.trim().length === 0) {
      throw this.createTTSError(
        'Text is required and must be a non-empty string',
        TTSErrorCode.INVALID_TEXT,
        { request }
      );
    }

    if (request.text.length > 32767) { // Chrome limit
      throw this.createTTSError(
        'Text is too long (maximum 32767 characters)',
        TTSErrorCode.INVALID_TEXT,
        { request, length: request.text.length }
      );
    }

    if (!this.isSupported()) {
      throw this.createTTSError(
        'Speech synthesis not supported in this browser',
        TTSErrorCode.NOT_SUPPORTED,
        { request }
      );
    }
  }

  /**
   * Generate unique ID for queue items
   */
  private generateId(): string {
    return `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Convert language code to speech synthesis format
   */
  private getLanguageCode(language: LanguageCode): string {
    // Map common language codes to speech synthesis format
    const languageMap: Record<string, string> = {
      'en': 'en-US',
      'es': 'es-ES',
      'fr': 'fr-FR',
      'de': 'de-DE',
      'it': 'it-IT',
      'pt': 'pt-BR',
      'ru': 'ru-RU',
      'ja': 'ja-JP',
      'ko': 'ko-KR',
      'zh': 'zh-CN'
    };

    return languageMap[language] || language;
  }

  /**
   * Update service statistics
   */
  private updateStats(success: boolean, duration: number): void {
    if (success) {
      this.stats.successfulRequests++;
    } else {
      this.stats.failedRequests++;
    }

    // Update average duration
    const totalSuccessful = this.stats.successfulRequests;
    if (totalSuccessful > 0) {
      this.stats.averageDuration = (
        (this.stats.averageDuration * (totalSuccessful - 1)) + duration
      ) / totalSuccessful;
    }
  }

  /**
   * Create TTS error
   */
  private createTTSError(message: string, code: TTSErrorCode, details?: any): TTSErrorImpl {
    return new TTSErrorImpl(message, code, details);
  }

  // --------------------------------------------------------------------------
  // Configuration
  // --------------------------------------------------------------------------

  /**
   * Get current configuration
   */
  getConfig(): TTSConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

// ============================================================================
// Service Instance Export
// ============================================================================

// Create singleton instance
export const ttsService = new TTSService();

// Export default for easy importing
export default ttsService; 