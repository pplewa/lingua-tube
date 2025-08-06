/**
 * WordLookupPopup Component API Design
 *
 * This file defines the public API for the WordLookupPopup component,
 * including configuration options, methods, events, and integration patterns.
 */

import { DictionaryApiService } from '../translation/DictionaryApiService';
import { TranslationApiService } from '../translation/TranslationApiService';
import { TTSService } from '../translation/TTSService';
import { StorageService } from '../storage';

// ========================================
// Configuration Interface
// ========================================

export interface WordLookupPopupConfig {
  // Visual Configuration
  readonly appearance: {
    readonly maxWidth: number; // pixels, default: 400
    readonly maxHeight: number; // pixels, default: 600
    readonly borderRadius: number; // pixels, default: 12
    readonly backgroundColor: string; // default: '#ffffff'
    readonly textColor: string; // default: '#2d3748'
    readonly accentColor: string; // default: '#4299e1'
    readonly shadowColor: string; // default: 'rgba(0, 0, 0, 0.15)'
    readonly fontSize: number; // pixels, default: 14
    readonly padding: number; // pixels, default: 20
    readonly zIndex: number; // default: 2147483647
  };

  // Animation Configuration
  readonly animations: {
    readonly enabled: boolean; // default: true
    readonly duration: number; // ms, default: 250
    readonly easing: string; // default: 'cubic-bezier(0.4, 0, 0.2, 1)'
    readonly respectsReducedMotion: boolean; // default: true
  };

  // Behavior Configuration
  readonly behavior: {
    readonly autoHideDelay: number; // ms, 0 = no auto-hide, default: 0
    readonly clickOutsideToClose: boolean; // default: true
    readonly escapeKeyToClose: boolean; // default: true
    readonly focusTrapping: boolean; // default: true
    readonly loadingTimeout: number; // ms, default: 15000
  };

  // Content Configuration
  readonly content: {
    readonly showPhonetics: boolean; // default: true
    readonly showExamples: boolean; // default: true
    readonly maxDefinitions: number; // default: 5
    readonly maxExamples: number; // default: 3
    readonly contextWindow: number; // words around target for context, default: 3
  };

  // Feature Configuration
  readonly features: {
    readonly enableTTS: boolean; // default: true
    readonly enableVocabulary: boolean; // default: true
    readonly enableTranslation: boolean; // default: true
    readonly enableDefinitions: boolean; // default: true
    readonly enableProgressiveLoading: boolean; // default: true
  };

  // Accessibility Configuration
  readonly accessibility: {
    readonly announceContent: boolean; // default: true
    readonly keyboardNavigation: boolean; // default: true
    readonly screenReaderSupport: boolean; // default: true
    readonly highContrastMode: boolean; // default: false
  };
}

// ========================================
// Content Data Interfaces
// ========================================

export interface WordLookupData {
  readonly word: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly context?: string;
  readonly position: PopupPosition;
  readonly timestamp?: number;
}

export interface PopupContent {
  readonly word: string;
  readonly translation: string;
  readonly phonetic?: string;
  readonly definitions: Definition[];
  readonly examples: Example[];
  readonly partOfSpeech?: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly confidence?: number; // 0-1 score for translation quality
  readonly etymology?: string;
  readonly frequency?: 'common' | 'uncommon' | 'rare';
}

export interface Definition {
  readonly text: string;
  readonly partOfSpeech?: string;
  readonly level?: 'beginner' | 'intermediate' | 'advanced';
  readonly source?: string;
  readonly examples?: string[];
}

export interface Example {
  readonly text: string;
  readonly translation?: string;
  readonly source?: string;
  readonly context?: string;
}

export interface PopupPosition {
  readonly x: number;
  readonly y: number;
  readonly placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto';
  readonly offset?: number;
  readonly anchorElement?: HTMLElement;
}

// ========================================
// Event System
// ========================================

export interface PopupEventData {
  readonly popup: WordLookupPopupAPI;
  readonly word: string;
  readonly timestamp: number;
}

export interface PopupShowEventData extends PopupEventData {
  readonly position: PopupPosition;
  readonly content?: PopupContent;
}

export interface PopupHideEventData extends PopupEventData {
  readonly reason: 'user' | 'timeout' | 'escape' | 'clickOutside' | 'programmatic';
  readonly duration: number; // ms popup was visible
}

export interface PopupContentEventData extends PopupEventData {
  readonly content: PopupContent;
  readonly loadTime: number; // ms
}

export interface PopupErrorEventData extends PopupEventData {
  readonly error: Error;
  readonly context: string;
  readonly recoverable: boolean;
}

export interface PopupActionEventData extends PopupEventData {
  readonly action: 'tts' | 'save' | 'translate' | 'define' | 'copy';
  readonly success: boolean;
  readonly data?: any;
}

export interface PopupStateEventData extends PopupEventData {
  readonly state: 'loading' | 'ready' | 'error' | 'hidden';
  readonly previousState?: string;
}

// Event handler types
export type PopupEventHandler<T = PopupEventData> = (data: T) => void;

export interface PopupEventHandlers {
  onShow?: PopupEventHandler<PopupShowEventData>;
  onHide?: PopupEventHandler<PopupHideEventData>;
  onContentLoaded?: PopupEventHandler<PopupContentEventData>;
  onError?: PopupEventHandler<PopupErrorEventData>;
  onAction?: PopupEventHandler<PopupActionEventData>;
  onStateChange?: PopupEventHandler<PopupStateEventData>;
  onPositionChange?: PopupEventHandler<PopupShowEventData>;
}

// ========================================
// Service Integration Interfaces
// ========================================

export interface PopupServiceDependencies {
  readonly dictionaryService: DictionaryApiService;
  readonly translationService: TranslationApiService;
  readonly ttsService: TTSService;
  readonly storageService: StorageService;
}

export interface PopupServiceConfig {
  readonly retryAttempts: number; // default: 3
  readonly retryDelay: number; // ms, default: 1000
  readonly cacheEnabled: boolean; // default: true
  readonly cacheTTL: number; // ms, default: 3600000 (1 hour)
  readonly batchRequests: boolean; // default: false
}

// ========================================
// State Management
// ========================================

export interface PopupState {
  readonly isVisible: boolean;
  readonly isLoading: boolean;
  readonly currentWord: string | null;
  readonly currentContent: PopupContent | null;
  readonly currentPosition: PopupPosition | null;
  readonly error: Error | null;
  readonly loadingActions: Set<string>;
  readonly focusedElement: HTMLElement | null;
}

export interface PopupStateManager {
  getState(): PopupState;
  subscribe(listener: (state: PopupState) => void): () => void;
  emit(event: string, data: any): void;
}

// ========================================
// Main Component API
// ========================================

export interface WordLookupPopupAPI {
  // ========================================
  // Core Methods
  // ========================================

  /**
   * Display the popup with word lookup data
   * @param data - Word and position information
   * @returns Promise that resolves when popup is shown
   */
  show(data: WordLookupData): Promise<void>;

  /**
   * Hide the popup
   * @param reason - Reason for hiding (default: 'programmatic')
   * @returns Promise that resolves when popup is hidden
   */
  hide(reason?: 'user' | 'timeout' | 'escape' | 'clickOutside' | 'programmatic'): Promise<void>;

  /**
   * Update popup content without re-showing
   * @param content - New content to display
   */
  updateContent(content: PopupContent): void;

  /**
   * Update popup position
   * @param position - New position
   */
  updatePosition(position: PopupPosition): void;

  /**
   * Destroy the popup and clean up resources
   */
  destroy(): void;

  // ========================================
  // State Management
  // ========================================

  /**
   * Get current popup state
   */
  getState(): PopupState;

  /**
   * Check if popup is currently visible
   */
  isVisible(): boolean;

  /**
   * Check if popup is currently loading
   */
  isLoading(): boolean;

  /**
   * Get current word being looked up
   */
  getCurrentWord(): string | null;

  /**
   * Get current content
   */
  getCurrentContent(): PopupContent | null;

  // ========================================
  // Configuration Management
  // ========================================

  /**
   * Update popup configuration
   * @param config - Partial configuration to merge
   */
  updateConfig(config: Partial<WordLookupPopupConfig>): void;

  /**
   * Get current configuration
   */
  getConfig(): WordLookupPopupConfig;

  /**
   * Reset configuration to defaults
   */
  resetConfig(): void;

  // ========================================
  // Event Management
  // ========================================

  /**
   * Add event listener
   * @param event - Event name
   * @param handler - Event handler function
   */
  on<K extends keyof PopupEventHandlers>(event: K, handler: PopupEventHandlers[K]): void;

  /**
   * Remove event listener
   * @param event - Event name
   * @param handler - Event handler function (optional, removes all if not provided)
   */
  off<K extends keyof PopupEventHandlers>(event: K, handler?: PopupEventHandlers[K]): void;

  /**
   * Add one-time event listener
   * @param event - Event name
   * @param handler - Event handler function
   */
  once<K extends keyof PopupEventHandlers>(event: K, handler: PopupEventHandlers[K]): void;

  /**
   * Emit custom event
   * @param event - Event name
   * @param data - Event data
   */
  emit(event: string, data: any): void;

  // ========================================
  // Action Methods
  // ========================================

  /**
   * Trigger text-to-speech for current word
   * @param options - TTS options
   */
  playTTS(options?: TTSOptions): Promise<void>;

  /**
   * Save current word to vocabulary
   * @param options - Save options
   */
  saveToVocabulary(options?: VocabularySaveOptions): Promise<void>;

  /**
   * Copy content to clipboard
   * @param content - Content to copy ('word', 'translation', 'definition', 'all')
   */
  copyToClipboard(content: 'word' | 'translation' | 'definition' | 'all'): Promise<void>;

  /**
   * Refresh content (re-fetch from services)
   */
  refreshContent(): Promise<void>;

  // ========================================
  // Accessibility Methods
  // ========================================

  /**
   * Set focus to popup
   */
  focus(): void;

  /**
   * Enable/disable click-outside detection
   * @param enabled - Whether to enable click-outside
   */
  setClickOutsideEnabled(enabled: boolean): void;

  /**
   * Enable/disable keyboard navigation
   * @param enabled - Whether to enable keyboard navigation
   */
  setKeyboardNavigationEnabled(enabled: boolean): void;

  /**
   * Announce content to screen readers
   * @param message - Message to announce
   */
  announce(message: string): void;

  // ========================================
  // Advanced Methods
  // ========================================

  /**
   * Preload content for a word (for performance)
   * @param word - Word to preload
   * @param languages - Source and target languages
   */
  preloadWord(word: string, languages: { source: string; target: string }): Promise<void>;

  /**
   * Clear content cache
   */
  clearCache(): void;

  /**
   * Get performance metrics
   */
  getMetrics(): PopupMetrics;

  /**
   * Export current state for debugging
   */
  exportState(): any;
}

// ========================================
// Supporting Types
// ========================================

export interface TTSOptions {
  readonly rate?: number; // 0.1-10, default: 1
  readonly pitch?: number; // 0-2, default: 1
  readonly volume?: number; // 0-1, default: 1
  readonly voice?: string; // voice name
  readonly lang?: string; // language code
}

export interface VocabularySaveOptions {
  readonly difficulty?: 'easy' | 'medium' | 'hard';
  readonly tags?: string[];
  readonly notes?: string;
  readonly context?: string;
}

export interface PopupMetrics {
  readonly showCount: number;
  readonly averageLoadTime: number;
  readonly errorRate: number;
  readonly cacheHitRate: number;
  readonly averageVisibilityDuration: number;
}

// ========================================
// Factory and Builder Patterns
// ========================================

export interface PopupBuilder {
  withConfig(config: Partial<WordLookupPopupConfig>): PopupBuilder;
  withServices(services: PopupServiceDependencies): PopupBuilder;
  withEventHandlers(handlers: PopupEventHandlers): PopupBuilder;
  withTheme(theme: PopupTheme): PopupBuilder;
  build(): WordLookupPopupAPI;
}

export interface PopupTheme {
  readonly name: string;
  readonly colors: {
    readonly background: string;
    readonly text: string;
    readonly accent: string;
    readonly border: string;
    readonly shadow: string;
  };
  readonly typography: {
    readonly fontFamily: string;
    readonly fontSize: number;
    readonly lineHeight: number;
  };
  readonly spacing: {
    readonly padding: number;
    readonly margin: number;
    readonly borderRadius: number;
  };
}

// ========================================
// Integration Helpers
// ========================================

export interface IntegrationConfig {
  readonly containerSelector?: string;
  readonly excludeSelectors?: string[];
  readonly wordDetectionPattern?: RegExp;
  readonly autoAttach?: boolean;
  readonly delegatedEvents?: boolean;
}

export interface PopupIntegration {
  attach(element: HTMLElement, config?: IntegrationConfig): void;
  detach(element: HTMLElement): void;
  isAttached(element: HTMLElement): boolean;
  getAttachedElements(): HTMLElement[];
}

// ========================================
// Default Configuration
// ========================================

export const DEFAULT_POPUP_CONFIG: WordLookupPopupConfig = {
  appearance: {
    maxWidth: 400,
    maxHeight: 600,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    textColor: '#2d3748',
    accentColor: '#4299e1',
    shadowColor: 'rgba(0, 0, 0, 0.15)',
    fontSize: 14,
    padding: 20,
    zIndex: 2147483647,
  },
  animations: {
    enabled: true,
    duration: 250,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    respectsReducedMotion: true,
  },
  behavior: {
    autoHideDelay: 0,
    clickOutsideToClose: true,
    escapeKeyToClose: true,
    focusTrapping: true,
    loadingTimeout: 15000,
  },
  content: {
    showPhonetics: true,
    showExamples: true,
    maxDefinitions: 5,
    maxExamples: 3,
    contextWindow: 3,
  },
  features: {
    enableTTS: true,
    enableVocabulary: true,
    enableTranslation: true,
    enableDefinitions: true,
    enableProgressiveLoading: true,
  },
  accessibility: {
    announceContent: true,
    keyboardNavigation: true,
    screenReaderSupport: true,
    highContrastMode: false,
  },
};

// ========================================
// Usage Examples
// ========================================

/*
// Basic usage
const popup = new WordLookupPopup(
  dictionaryService,
  translationService,
  ttsService,
  storageService,
  vocabularyManager
);
await popup.show({
  word: 'hello',
  sourceLanguage: 'en',
  targetLanguage: 'es',
  position: { x: 100, y: 200 }
});

// With configuration
const popup = new WordLookupPopup(
  dictionaryService,
  translationService,
  ttsService,
  storageService,
  vocabularyManager,
  {
    maxWidth: 500,
    backgroundColor: '#f7fafc',
    enableTTS: false
  }
);

// With event handlers
popup.on('onShow', (data) => {
  Logger.getInstance()?.info('Popup shown for word', {
    component: ComponentType.WORD_LOOKUP,
    metadata: { word: data.word },
  });
});

popup.on('onAction', (data) => {
  if (data.action === 'save' && data.success) {
    Logger.getInstance()?.info('Word saved to vocabulary', {
      component: ComponentType.WORD_LOOKUP,
    });
  }
});

// Builder pattern
const popup = new PopupBuilder()
  .withConfig({ appearance: { maxWidth: 500 } })
  .withServices(services)
  .withEventHandlers({
    onShow: (data) =>
      Logger.getInstance()?.info('Shown', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { word: data.word },
      }),
    onHide: (data) =>
      Logger.getInstance()?.info('Hidden', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { reason: data.reason },
      })
  })
  .build();

// Integration helper
const integration = new PopupIntegration(popup);
integration.attach(document.body, {
  wordDetectionPattern: /\b\w+\b/g,
  autoAttach: true
});
*/
