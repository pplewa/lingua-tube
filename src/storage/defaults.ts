/**
 * LinguaTube Chrome Storage Module - Default Settings
 * Defines default configurations and initial data structures
 */

import {
  UserSettings,
  LanguageSettings,
  SubtitleSettings,
  PlaybackSettings,
  VocabularySettings,
  UISettings,
  PrivacySettings,
  KeyboardShortcuts,
  StorageSchema,
  STORAGE_CONFIG,
} from './types'

// ========================================
// Default Language Settings
// ========================================

export const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = {
  sourceLanguage: 'auto', // Let translation API auto-detect the language
  nativeLanguage: 'en', // Will be detected/set by user
  autoDetectSource: true,
  fallbackLanguage: 'en',
}

// ========================================
// Default Subtitle Settings
// ========================================

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  showSource: true,
  showNative: true,
  fontSize: 24,
  fontFamily: '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
  position: 'bottom',
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  textColor: '#ffffff',
  opacity: 0.9,
  wordSpacing: 1.0,
  lineHeight: 1.4,
}

// ========================================
// Default Playback Settings
// ========================================

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  defaultSpeed: 1.0,
  enableSentenceLoop: true,
  enableAutoReplay: false,
  pauseOnClick: true,
  skipSilence: false,
}

// ========================================
// Default Vocabulary Settings
// ========================================

export const DEFAULT_VOCABULARY_SETTINGS: VocabularySettings = {
  autoSave: true,
  highlightSavedWords: true,
  highlightColor: '#ffeb3b',
  maxSavedWords: STORAGE_CONFIG.MAX_VOCABULARY_ITEMS,
  exportFormat: 'json',
  reviewReminders: true,
}

// ========================================
// Default Keyboard Shortcuts
// ========================================

export const DEFAULT_KEYBOARD_SHORTCUTS: KeyboardShortcuts = {
  toggleSubtitles: 'KeyS',
  slowDown: 'Comma',
  speedUp: 'Period',
  replay: 'KeyR',
  saveWord: 'KeyW',
  showDefinition: 'KeyD',
}

// ========================================
// Default UI Settings
// ========================================

export const DEFAULT_UI_SETTINGS: UISettings = {
  theme: 'auto',
  compactMode: false,
  showTooltips: true,
  animationsEnabled: true,
  keyboardShortcuts: DEFAULT_KEYBOARD_SHORTCUTS,
}

// ========================================
// Default Privacy Settings
// ========================================

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  collectAnalytics: false, // Privacy-first approach
  shareUsageData: false,
  cacheTranslations: true,
  maxCacheSize: STORAGE_CONFIG.MAX_CACHE_SIZE_MB,
  autoDeleteOldData: true,
  dataRetentionDays: 365,
}

// ========================================
// Complete Default User Settings
// ========================================

export const DEFAULT_USER_SETTINGS: UserSettings = {
  version: STORAGE_CONFIG.SCHEMA_VERSION,
  languages: DEFAULT_LANGUAGE_SETTINGS,
  subtitle: DEFAULT_SUBTITLE_SETTINGS,
  playback: DEFAULT_PLAYBACK_SETTINGS,
  vocabulary: DEFAULT_VOCABULARY_SETTINGS,
  ui: DEFAULT_UI_SETTINGS,
  privacy: DEFAULT_PRIVACY_SETTINGS,
}

// ========================================
// Default Storage Schema
// ========================================

export const DEFAULT_STORAGE_SCHEMA: StorageSchema = {
  version: STORAGE_CONFIG.SCHEMA_VERSION,
  lastMigration: Date.now(),
  migrationHistory: [],
}

// ========================================
// Helper Functions for Default Values
// ========================================

/**
 * Generates a unique ID for vocabulary items
 */
export const generateVocabularyId = (): string => {
  return `vocab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Creates default settings with user-specific overrides
 */
export const createDefaultSettings = (overrides: Partial<UserSettings> = {}): UserSettings => {
  return {
    ...DEFAULT_USER_SETTINGS,
    ...overrides,
    languages: {
      ...DEFAULT_USER_SETTINGS.languages,
      ...overrides.languages,
    },
    subtitle: {
      ...DEFAULT_USER_SETTINGS.subtitle,
      ...overrides.subtitle,
    },
    playback: {
      ...DEFAULT_USER_SETTINGS.playback,
      ...overrides.playback,
    },
    vocabulary: {
      ...DEFAULT_USER_SETTINGS.vocabulary,
      ...overrides.vocabulary,
    },
    ui: {
      ...DEFAULT_USER_SETTINGS.ui,
      ...overrides.ui,
      keyboardShortcuts: {
        ...DEFAULT_USER_SETTINGS.ui.keyboardShortcuts,
        ...overrides.ui?.keyboardShortcuts,
      },
    },
    privacy: {
      ...DEFAULT_USER_SETTINGS.privacy,
      ...overrides.privacy,
    },
  }
}

/**
 * Validates user settings against the schema
 */
export const validateUserSettings = (settings: unknown): settings is UserSettings => {
  if (!settings || typeof settings !== 'object') return false

  const s = settings as Record<string, unknown>

  return (
    typeof s.version === 'number' &&
    typeof s.languages === 'object' &&
    typeof s.subtitle === 'object' &&
    typeof s.playback === 'object' &&
    typeof s.vocabulary === 'object' &&
    typeof s.ui === 'object' &&
    typeof s.privacy === 'object'
  )
}

/**
 * Language code mapping for common languages
 */
export const LANGUAGE_CODES = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  ru: 'Русский',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  ar: 'العربية',
  hi: 'हिन्दी',
} as const

export type SupportedLanguageCode = keyof typeof LANGUAGE_CODES
