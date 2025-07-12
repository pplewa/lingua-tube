/**
 * LinguaTube Vocabulary Module - Main Export
 * Provides enhanced vocabulary management functionality
 */

// Export the main vocabulary manager
export { VocabularyManager, vocabularyManager } from './VocabularyManager'

// Export VocabularyObserver functionality
export {
  VocabularyObserver,
  VocabularyEventType,
  createReactiveVocabularyComponent,
} from './VocabularyObserver'
export type {
  VocabularyEvent,
  VocabularyEventData,
  WordEventData,
  SearchEventData,
  StatisticsEventData,
  HighlightEventData,
  BatchEventData,
  VocabularyObserverCallback,
  VocabularyObserverCallbacks,
  VocabularyUIComponent,
} from './VocabularyObserver'

// Export WordHighlightingService functionality
export {
  WordHighlightingService,
  highlightVocabularyInElement,
  removeVocabularyHighlighting,
  highlightVocabularyInText,
  DEFAULT_HIGHLIGHT_CONFIG,
  SUBTITLE_HIGHLIGHT_CONFIG,
  WEBPAGE_HIGHLIGHT_CONFIG,
} from '../ui/WordHighlightingService'
export type {
  HighlightConfig as WordHighlightConfig,
  HighlightContext,
  HighlightStats,
  WordMatch,
} from '../ui/WordHighlightingService'

// Export types and interfaces
export type {
  VocabularyFilters,
  VocabularySortOptions,
  BatchOperationResult,
  HighlightConfig,
} from './VocabularyManager'

// Re-export storage types for convenience
export type { VocabularyItem } from '../storage'

// Export singleton instance as default
export { vocabularyManager as default } from './VocabularyManager'
