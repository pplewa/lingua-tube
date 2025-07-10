/**
 * Dual Subtitle Manager
 * Coordinates the dual subtitle component with translation services, storage, and player interactions
 */

import { DualSubtitleComponent, DualSubtitleConfig, WordClickEvent } from './DualSubtitleComponent';
import { PlayerInteractionService } from '../youtube/PlayerInteractionService';
import { StorageService } from '../storage';
import { TranslationApiService } from '../translation/TranslationApiService';
import { translationCacheService } from '../translation/TranslationCacheService';
import { UserSettings } from '../storage/types';

// ========================================
// Types and Interfaces
// ========================================

export interface SubtitleManagerConfig {
  readonly autoTranslate: boolean;
  readonly translationDelay: number; // ms to wait before translating
  readonly cacheTranslations: boolean;
  readonly vocabularyIntegration: boolean;
  readonly autoSaveWords: boolean;
  readonly contextWindow: number; // words around clicked word for context
}

export interface TranslationRequest {
  readonly text: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly context?: string;
  readonly priority: 'high' | 'normal' | 'low';
}

export interface VocabularyEntry {
  readonly word: string;
  readonly translation: string;
  readonly context: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly videoId: string;
  readonly timestamp: number;
}

export type TranslationCallback = (translation: string, cueId: string) => void;
export type VocabularyCallback = (entry: VocabularyEntry) => void;

// ========================================
// Main Manager Class
// ========================================

export class DualSubtitleManager {
  private subtitleComponent: DualSubtitleComponent | null = null;
  private playerService: PlayerInteractionService;
  private storageService: StorageService;
  private translationService: TranslationApiService;
  
  private config: SubtitleManagerConfig;
  private currentVideoId: string | null = null;
  private sourceLanguage: string = 'en';
  private targetLanguage: string = 'es';
  
  private translationQueue: Map<string, TranslationRequest> = new Map();
  private pendingTranslations: Set<string> = new Set();
  private translationTimeouts: Map<string, number> = new Map();
  
  private vocabularyCallbacks: Set<VocabularyCallback> = new Set();
  private translationCallbacks: Set<TranslationCallback> = new Set();
  
  private isInitialized: boolean = false;

  constructor(
    playerService: PlayerInteractionService,
    storageService: StorageService,
    translationService: TranslationApiService
  ) {
    this.playerService = playerService;
    this.storageService = storageService;
    this.translationService = translationService;
    
    this.config = {
      autoTranslate: true,
      translationDelay: 500,
      cacheTranslations: true,
      vocabularyIntegration: true,
      autoSaveWords: false,
      contextWindow: 3
    };
    
    this.setupEventHandlers();
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  public async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) {
        console.warn('[DualSubtitleManager] Already initialized');
        return true;
      }

      // Load user settings
      await this.loadUserSettings();
      
      // Initialize subtitle component
      this.subtitleComponent = new DualSubtitleComponent(
        this.playerService,
        this.storageService,
        await this.createSubtitleConfig()
      );

      const initSuccess = await this.subtitleComponent.initialize();
      if (!initSuccess) {
        console.error('[DualSubtitleManager] Failed to initialize subtitle component');
        return false;
      }

      // Set up subtitle component event handlers
      this.setupSubtitleEventHandlers();
      
      // Get current video ID
      this.currentVideoId = this.extractVideoId(window.location.href);
      
      this.isInitialized = true;
      console.log('[DualSubtitleManager] Initialized successfully');
      return true;

    } catch (error) {
      console.error('[DualSubtitleManager] Initialization failed:', error);
      return false;
    }
  }

  public async destroy(): Promise<void> {
    try {
      // Clear all timeouts
      this.translationTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
      this.translationTimeouts.clear();
      
      // Clear queues
      this.translationQueue.clear();
      this.pendingTranslations.clear();
      
      // Destroy subtitle component
      if (this.subtitleComponent) {
        this.subtitleComponent.destroy();
        this.subtitleComponent = null;
      }
      
      // Clear callbacks
      this.vocabularyCallbacks.clear();
      this.translationCallbacks.clear();
      
      this.isInitialized = false;
      console.log('[DualSubtitleManager] Destroyed successfully');

    } catch (error) {
      console.error('[DualSubtitleManager] Destroy failed:', error);
    }
  }

  private async loadUserSettings(): Promise<void> {
    try {
      const result = await this.storageService.getSettings();
      if (result.success && result.data) {
        const settings = result.data;
        
        // Update languages
        this.sourceLanguage = settings.languages.sourceLanguage;
        this.targetLanguage = settings.languages.nativeLanguage;
        
        // Update manager config
        this.config = {
          ...this.config,
          autoTranslate: true, // Could be from settings
          cacheTranslations: settings.privacy.cacheTranslations,
          vocabularyIntegration: true,
          autoSaveWords: settings.vocabulary.autoSave
        };
      }
    } catch (error) {
      console.warn('[DualSubtitleManager] Failed to load user settings:', error);
    }
  }

  private async createSubtitleConfig(): Promise<Partial<DualSubtitleConfig>> {
    try {
      const result = await this.storageService.getSettings();
      if (result.success && result.data) {
        const { subtitle, ui } = result.data;
        
        return {
          showTargetLanguage: subtitle.showSource,
          showNativeLanguage: subtitle.showNative,
          fontSize: subtitle.fontSize,
          fontFamily: subtitle.fontFamily,
          backgroundColor: subtitle.backgroundColor,
          opacity: subtitle.opacity,
          animationEnabled: ui.animationsEnabled,
          clickableWords: true, // Always enable for vocabulary features
          autoHideNative: false
        };
      }
    } catch (error) {
      console.warn('[DualSubtitleManager] Failed to create subtitle config from settings:', error);
    }
    
    return {};
  }

  // ========================================
  // Event Handlers
  // ========================================

  private setupEventHandlers(): void {
    // Listen for video changes
    if (typeof window !== 'undefined') {
      let lastUrl = window.location.href;
      
      const checkForVideoChange = () => {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
          lastUrl = currentUrl;
          this.handleVideoChange(this.extractVideoId(currentUrl));
        }
      };
      
      // Use MutationObserver to detect navigation
      const observer = new MutationObserver(checkForVideoChange);
      observer.observe(document.body, { 
        childList: true, 
        subtree: true 
      });
      
      // Also check periodically as fallback
      setInterval(checkForVideoChange, 2000);
    }
  }

  private setupSubtitleEventHandlers(): void {
    if (!this.subtitleComponent) return;

    // Handle word clicks for vocabulary and translation
    this.subtitleComponent.addWordClickListener(this.handleWordClick.bind(this));
    
    // Handle visibility changes
    this.subtitleComponent.addVisibilityListener((visible, cueCount) => {
      if (visible && this.config.autoTranslate) {
        this.processVisibleCues();
      }
    });
  }

  private handleVideoChange(videoId: string | null): void {
    if (this.currentVideoId !== videoId) {
      this.currentVideoId = videoId;
      this.clearTranslationQueue();
      
      console.log('[DualSubtitleManager] Video changed:', videoId);
    }
  }

  private async handleWordClick(event: WordClickEvent): Promise<void> {
    try {
      const { word, cueId, context, position } = event;
      
      // Get translation for the word
      const translation = await this.getWordTranslation(word, context);
      
      // Show translation tooltip
      this.showTranslationTooltip(word, translation, position);
      
      // Create vocabulary entry if auto-save is enabled
      if (this.config.autoSaveWords && this.currentVideoId) {
        const vocabularyEntry: VocabularyEntry = {
          word,
          translation,
          context,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          videoId: this.currentVideoId,
          timestamp: Date.now()
        };
        
        await this.saveVocabularyItem(vocabularyEntry);
        
        // Notify vocabulary callbacks
        this.vocabularyCallbacks.forEach(callback => {
          try {
            callback(vocabularyEntry);
          } catch (error) {
            console.error('[DualSubtitleManager] Vocabulary callback error:', error);
          }
        });
      }
      
    } catch (error) {
      console.error('[DualSubtitleManager] Word click handling failed:', error);
    }
  }

  // ========================================
  // Translation Management
  // ========================================

  private async processVisibleCues(): Promise<void> {
    if (!this.subtitleComponent) return;

    const visibleCues = this.subtitleComponent.getCurrentCues();
    
    for (const cue of visibleCues) {
      if (cue.targetText && !cue.nativeText) {
        await this.requestCueTranslation(cue.id, cue.targetText);
      }
    }
  }

  private async requestCueTranslation(cueId: string, text: string): Promise<void> {
    // Skip if already pending or in queue
    if (this.pendingTranslations.has(cueId) || this.translationQueue.has(cueId)) {
      return;
    }

    // Check cache first if enabled
    if (this.config.cacheTranslations) {
      try {
        const cached = await translationCacheService.get(text, this.sourceLanguage, this.targetLanguage);
        if (cached) {
          this.deliverTranslation(cueId, cached);
          return;
        }
      } catch (error) {
        console.warn('[DualSubtitleManager] Cache lookup failed:', error);
      }
    }

    // Queue translation request
    const request: TranslationRequest = {
      text,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      priority: 'normal'
    };

    this.translationQueue.set(cueId, request);

    // Set up delayed execution
    const timeoutId = setTimeout(() => {
      this.executeTranslation(cueId, request);
    }, this.config.translationDelay) as any;

    this.translationTimeouts.set(cueId, timeoutId);
  }

  private async executeTranslation(cueId: string, request: TranslationRequest): Promise<void> {
    try {
      this.pendingTranslations.add(cueId);
      
      const translation = await this.translationService.translateText({
        text: request.text,
        fromLanguage: request.sourceLanguage,
        toLanguage: request.targetLanguage
      });

      // Cache the translation
      if (this.config.cacheTranslations) {
        await translationCacheService.set(
          request.text,
          translation,
          request.sourceLanguage,
          request.targetLanguage
        );
      }

      // Deliver translation
      this.deliverTranslation(cueId, translation);
      
    } catch (error) {
      console.error('[DualSubtitleManager] Translation failed:', error);
    } finally {
      this.pendingTranslations.delete(cueId);
      this.translationQueue.delete(cueId);
    }
  }

  private deliverTranslation(cueId: string, translation: string): void {
    // Update subtitle component
    if (this.subtitleComponent) {
      this.subtitleComponent.setNativeTranslation(cueId, translation);
    }

    // Notify translation callbacks
    this.translationCallbacks.forEach(callback => {
      try {
        callback(translation, cueId);
      } catch (error) {
        console.error('[DualSubtitleManager] Translation callback error:', error);
      }
    });
  }

  private async getWordTranslation(word: string, context: string): Promise<string> {
    try {
      // Check cache first
      if (this.config.cacheTranslations) {
        const cached = await translationCacheService.get(word, this.sourceLanguage, this.targetLanguage);
        if (cached) return cached;
      }

      // Request translation with context
      const contextWords = this.extractContext(context, word);
      const textToTranslate = contextWords.length > 1 ? contextWords.join(' ') : word;
      
      const translation = await this.translationService.translateText({
        text: textToTranslate,
        fromLanguage: this.sourceLanguage,
        toLanguage: this.targetLanguage
      });

      // If we translated with context, extract just the word translation
      const wordTranslation = contextWords.length > 1 ? 
        this.extractWordFromTranslation(translation, word, contextWords) : 
        translation;

      // Cache the word translation
      if (this.config.cacheTranslations) {
        await translationCacheService.set(word, wordTranslation, this.sourceLanguage, this.targetLanguage);
      }

      return wordTranslation;

    } catch (error) {
      console.error('[DualSubtitleManager] Word translation failed:', error);
      
      // Provide specific error feedback for authentication issues
      if (error && typeof error === 'object' && 'code' in error) {
        const translationError = error as { code: string; message: string };
        
        if (translationError.code === 'UNAUTHORIZED' || translationError.code === 'SERVICE_NOT_CONFIGURED') {
          console.warn('[DualSubtitleManager] Translation service authentication failed');
          // Show user-friendly error message in console for debugging
          console.log('Translation Error: Please configure your Microsoft Translator API key in the .env file');
          return `[Translation Error: API key needed]`;
        } else if (translationError.code === 'MISSING_API_KEY') {
          console.warn('[DualSubtitleManager] Translation API key missing');
          return `[No API key configured]`;
        }
      }
      
      return word; // Fallback to original word for other errors
    }
  }

  private extractContext(fullContext: string, targetWord: string): string[] {
    const words = fullContext.split(/\s+/);
    const targetIndex = words.findIndex(w => 
      w.toLowerCase().replace(/[^\w]/g, '') === targetWord.toLowerCase().replace(/[^\w]/g, '')
    );
    
    if (targetIndex === -1) return [targetWord];
    
    const start = Math.max(0, targetIndex - this.config.contextWindow);
    const end = Math.min(words.length, targetIndex + this.config.contextWindow + 1);
    
    return words.slice(start, end);
  }

  private extractWordFromTranslation(translation: string, originalWord: string, contextWords: string[]): string {
    // Simple heuristic: if translation is much longer than original word,
    // try to extract the corresponding part
    const translationWords = translation.split(/\s+/);
    const originalIndex = contextWords.findIndex(w => 
      w.toLowerCase().replace(/[^\w]/g, '') === originalWord.toLowerCase().replace(/[^\w]/g, '')
    );
    
    if (originalIndex !== -1 && originalIndex < translationWords.length) {
      return translationWords[originalIndex] || translation;
    }
    
    return translation;
  }

  private clearTranslationQueue(): void {
    this.translationTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    this.translationTimeouts.clear();
    this.translationQueue.clear();
    this.pendingTranslations.clear();
  }

  // ========================================
  // Vocabulary Management
  // ========================================

  private async saveVocabularyItem(entry: VocabularyEntry): Promise<void> {
    try {
      const vocabularyItem = {
        word: entry.word,
        translation: entry.translation,
        context: entry.context,
        sourceLanguage: entry.sourceLanguage,
        targetLanguage: entry.targetLanguage,
        videoId: entry.videoId,
        videoTitle: await this.getVideoTitle(),
        timestamp: entry.timestamp,
        reviewCount: 0,
        difficulty: 'medium' as const
      };

      const result = await this.storageService.saveWord(vocabularyItem);
      
      if (result.success) {
        console.log('[DualSubtitleManager] Vocabulary item saved:', entry.word);
      } else {
        console.error('[DualSubtitleManager] Failed to save vocabulary item:', result.error);
      }

    } catch (error) {
      console.error('[DualSubtitleManager] Vocabulary save error:', error);
    }
  }

  private async getVideoTitle(): Promise<string> {
    try {
      const titleElement = document.querySelector('h1.title yt-formatted-string, h1[class*="title"]');
      return titleElement?.textContent?.trim() || 'Unknown Video';
    } catch (error) {
      return 'Unknown Video';
    }
  }

  private showTranslationTooltip(word: string, translation: string, position: { x: number; y: number }): void {
    // This could be implemented as a separate tooltip component
    // For now, just log to console
    console.log(`[DualSubtitleManager] Translation for "${word}": ${translation}`);
  }

  // ========================================
  // Utility Methods
  // ========================================

  private extractVideoId(url: string): string | null {
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  }

  // ========================================
  // Public API
  // ========================================

  public isReady(): boolean {
    return this.isInitialized && this.subtitleComponent?.isReady() === true;
  }

  public updateConfig(newConfig: Partial<SubtitleManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (newConfig.autoTranslate !== undefined && this.subtitleComponent) {
      // Process visible cues if auto-translate was enabled
      if (newConfig.autoTranslate) {
        this.processVisibleCues();
      }
    }
  }

  public getConfig(): SubtitleManagerConfig {
    return { ...this.config };
  }

  public setLanguages(sourceLanguage: string, targetLanguage: string): void {
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;
    
    // Clear caches and queues since language changed
    this.clearTranslationQueue();
  }

  public getSubtitleComponent(): DualSubtitleComponent | null {
    return this.subtitleComponent;
  }

  public addVocabularyCallback(callback: VocabularyCallback): void {
    this.vocabularyCallbacks.add(callback);
  }

  public removeVocabularyCallback(callback: VocabularyCallback): void {
    this.vocabularyCallbacks.delete(callback);
  }

  public addTranslationCallback(callback: TranslationCallback): void {
    this.translationCallbacks.add(callback);
  }

  public removeTranslationCallback(callback: TranslationCallback): void {
    this.translationCallbacks.delete(callback);
  }

  public async forceTranslateCue(cueId: string, text: string): Promise<void> {
    const request: TranslationRequest = {
      text,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      priority: 'high'
    };

    await this.executeTranslation(cueId, request);
  }

  public highlightVocabularyWords(words: string[]): void {
    if (!this.subtitleComponent) return;

    words.forEach(word => {
      this.subtitleComponent!.highlightWord(word, true);
    });
  }
} 