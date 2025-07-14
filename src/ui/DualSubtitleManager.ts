/**
 * Dual Subtitle Manager
 * Coordinates the dual subtitle component with translation services, storage, and player interactions
 */

import { DualSubtitleComponent, DualSubtitleConfig, WordClickEvent } from './DualSubtitleComponent';
import { PlayerInteractionService } from '../youtube/PlayerInteractionService';
import { StorageService } from '../storage';
import { WordLookupPopup } from './WordLookupPopup';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';

// ========================================
// Types and Interfaces
// ========================================

export interface SubtitleManagerConfig {
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
  private wordLookupPopup: WordLookupPopup | null = null;

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
  private readonly logger = Logger.getInstance();

  constructor(
    playerService: PlayerInteractionService,
    storageService: StorageService,
    wordLookupPopup?: WordLookupPopup,
  ) {
    this.playerService = playerService;
    this.storageService = storageService;
    this.wordLookupPopup = wordLookupPopup || null;

    this.config = {
      vocabularyIntegration: true,
      autoSaveWords: false,
      contextWindow: 3,
    };

    this.setupEventHandlers();
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  private async checkTranslationStatus(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TRANSLATION_STATUS',
      });

      if (response.success && response.status) {
        const status = response.status;
        this.logger?.info('Translation status', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            configured: status.configured,
            hasApiKey: status.hasApiKey,
            lastError: status.lastError,
          },
        });

        if (!status.configured || !status.hasApiKey) {
          this.logger?.warn('Translation service not properly configured', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: {
              hasApiKey: status.hasApiKey,
              configured: status.configured,
              lastError: status.lastError,
            },
          });
        } else {
          this.logger?.info('Translation service is ready', {
            component: ComponentType.SUBTITLE_MANAGER,
          });
        }
      } else {
        this.logger?.warn('Failed to get translation status from background service', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            responseSuccess: response?.success,
            hasStatus: !!response?.status,
          },
        });
      }
    } catch (error) {
      this.logger?.warn('Error checking translation status', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  public async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) {
        this.logger?.warn('Already initialized', {
          component: ComponentType.SUBTITLE_MANAGER,
        });
        return true;
      }

      this.logger?.info('Starting initialization', {
        component: ComponentType.SUBTITLE_MANAGER,
      });

      // Check translation service status from background service (non-blocking)
      this.checkTranslationStatus().catch((error) => {
        this.logger?.warn('Translation status check failed', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });

      // Load user settings
      this.logger?.info('Loading user settings', {
        component: ComponentType.SUBTITLE_MANAGER,
      });
      await this.loadUserSettings();
      this.logger?.info('User settings loaded', {
        component: ComponentType.SUBTITLE_MANAGER,
      });

      // Initialize subtitle component
      this.logger?.info('Creating subtitle component', {
        component: ComponentType.SUBTITLE_MANAGER,
      });
      this.subtitleComponent = new DualSubtitleComponent(
        this.playerService,
        this.storageService,
        await this.createSubtitleConfig(),
      );
      this.logger?.info('Subtitle component created', {
        component: ComponentType.SUBTITLE_MANAGER,
      });

      this.logger?.info('Initializing subtitle component', {
        component: ComponentType.SUBTITLE_MANAGER,
      });
      const initSuccess = await this.subtitleComponent.initialize();
      if (!initSuccess) {
        this.logger?.error('Failed to initialize subtitle component', {
          component: ComponentType.SUBTITLE_MANAGER,
        });
        return false;
      }
      this.logger?.info('Subtitle component initialized', {
        component: ComponentType.SUBTITLE_MANAGER,
      });

      // Set up subtitle component event handlers
      this.logger?.info('Setting up event handlers', {
        component: ComponentType.SUBTITLE_MANAGER,
      });
      this.setupSubtitleEventHandlers();
      this.logger?.info('Event handlers set up', {
        component: ComponentType.SUBTITLE_MANAGER,
      });

      // Get current video ID
      this.currentVideoId = this.extractVideoId(window.location.href);

      this.isInitialized = true;
      this.logger?.info('Initialized successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          currentVideoId: this.currentVideoId,
        },
      });
      return true;
    } catch (error) {
      this.logger?.error('Initialization failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  public async destroy(): Promise<void> {
    try {
      // Clear all timeouts
      this.translationTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
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
      this.logger?.info('Destroyed successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
      });
    } catch (error) {
      this.logger?.error('Destroy failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
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

        // Update WordLookupPopup with user's language preferences
        if (this.wordLookupPopup) {
          this.wordLookupPopup.setDefaultLanguages(this.sourceLanguage, this.targetLanguage);
        }

        this.logger?.info('User settings loaded', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            sourceLanguage: this.sourceLanguage,
            targetLanguage: this.targetLanguage,
            autoSaveWords: settings.vocabulary.autoSave,
          },
        });

        // Update manager config
        this.config = {
          ...this.config,
          vocabularyIntegration: true,
          autoSaveWords: settings.vocabulary.autoSave,
        };
      }
    } catch (error) {
      this.logger?.warn('Failed to load user settings', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
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
          autoHideNative: false,
        };
      }
    } catch (error) {
      this.logger?.warn('Failed to create subtitle config from settings', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
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
        subtree: true,
      });

      // Also check periodically as fallback
      setInterval(checkForVideoChange, 2000);
    }
  }

  private setupSubtitleEventHandlers(): void {
    if (!this.subtitleComponent) return;

    // Handle word clicks for vocabulary and translation
    this.subtitleComponent.addWordClickListener(this.handleWordClick.bind(this));
  }

  private handleVideoChange(videoId: string | null): void {
    if (this.currentVideoId !== videoId) {
      this.currentVideoId = videoId;
      this.clearTranslationQueue();

      this.logger?.info('Video changed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          previousVideoId: this.currentVideoId,
          newVideoId: videoId,
        },
      });
    }
  }

  private async handleWordClick(event: WordClickEvent): Promise<void> {
    try {
      this.logger?.debug('Handling word click', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word: event.word,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          cueId: event.cueId,
        },
      });

      const { word, context, position } = event;
      this.showTranslationTooltip(word, context, position);
    } catch (error) {
      this.logger?.error('Word click handling failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word: event.word,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private clearTranslationQueue(): void {
    this.translationTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    this.translationTimeouts.clear();
    this.translationQueue.clear();
    this.pendingTranslations.clear();
  }

  // ========================================
  // Vocabulary Management
  // ========================================

  private showTranslationTooltip(
    word: string,
    context: string,
    position: { x: number; y: number },
  ): void {
    this.logger?.debug('Showing translation tooltip', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        word,
        position,
        hasWordLookupPopup: !!this.wordLookupPopup,
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage,
      },
    });

    if (this.wordLookupPopup) {
      this.wordLookupPopup.show({
        word,
        position,
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage,
        context,
      });
    } else {
      // Fallback logging if popup is not available
      this.logger?.info('Translation fallback display', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          reason: 'No word lookup popup available',
        },
      });
    }
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
  }

  public getConfig(): SubtitleManagerConfig {
    return { ...this.config };
  }

  public setLanguages(sourceLanguage: string, targetLanguage: string): void {
    this.sourceLanguage = sourceLanguage;
    this.targetLanguage = targetLanguage;

    // Update WordLookupPopup with new language settings
    if (this.wordLookupPopup) {
      this.wordLookupPopup.setDefaultLanguages(sourceLanguage, targetLanguage);
    }

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

  public highlightVocabularyWords(words: string[]): void {
    if (!this.subtitleComponent) return;

    words.forEach((word) => {
      this.subtitleComponent!.highlightWord(word, true);
    });
  }
}
