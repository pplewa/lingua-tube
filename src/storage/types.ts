/**
 * LinguaTube Chrome Storage Module - TypeScript Interfaces
 * Defines strongly typed interfaces for all stored data and configurations
 */

// ========================================
// Core Data Types
// ========================================

/**
 * Represents a vocabulary item saved by the user while learning
 */
export interface VocabularyItem {
  readonly id: string
  readonly word: string
  readonly translation: string
  readonly context: string
  readonly sourceLanguage: string
  readonly targetLanguage: string
  readonly videoId?: string
  readonly videoTitle?: string
  readonly timestamp: number
  readonly createdAt: number
  readonly lastReviewed?: number
  readonly reviewCount: number
  readonly difficulty?: 'easy' | 'medium' | 'hard'
  readonly tags?: string[]
  readonly learningStatus?: 'new' | 'learning' | 'mastered' | 'review'
  readonly notes?: string
  readonly frequency?: number
  readonly lastModified?: number
}

/**
 * User preferences and settings for the extension
 */
export interface UserSettings {
  readonly version: number
  readonly languages: LanguageSettings
  readonly subtitle: SubtitleSettings
  readonly playback: PlaybackSettings
  readonly vocabulary: VocabularySettings
  readonly ui: UISettings
  readonly privacy: PrivacySettings
}

/**
 * Language configuration settings
 */
export interface LanguageSettings {
  readonly sourceLanguage: string // Language being learned (e.g., 'en')
  readonly nativeLanguage: string // User's native language (e.g., 'es')
  readonly autoDetectSource: boolean
  readonly fallbackLanguage: string
}

/**
 * Subtitle display and behavior settings
 */
export interface SubtitleSettings {
  readonly showSource: boolean
  readonly showNative: boolean
  readonly fontSize: number // 12-24px range
  readonly fontFamily: string
  readonly position: 'top' | 'center' | 'bottom'
  readonly backgroundColor: string
  readonly textColor: string
  readonly opacity: number // 0.1-1.0 range
  readonly wordSpacing: number
  readonly lineHeight: number
}

/**
 * Video playback control settings
 */
export interface PlaybackSettings {
  readonly defaultSpeed: number // 0.25-2.0 range
  readonly enableSentenceLoop: boolean
  readonly enableAutoReplay: boolean
  readonly pauseOnClick: boolean
  readonly skipSilence: boolean
}

/**
 * Vocabulary management settings
 */
export interface VocabularySettings {
  readonly autoSave: boolean
  readonly highlightSavedWords: boolean
  readonly highlightColor: string
  readonly maxSavedWords: number
  readonly exportFormat: 'json' | 'csv' | 'anki'
  readonly reviewReminders: boolean
}

/**
 * User interface settings
 */
export interface UISettings {
  readonly theme: 'light' | 'dark' | 'auto'
  readonly compactMode: boolean
  readonly showTooltips: boolean
  readonly animationsEnabled: boolean
  readonly keyboardShortcuts: KeyboardShortcuts
}

/**
 * Keyboard shortcuts configuration
 */
export interface KeyboardShortcuts {
  readonly toggleSubtitles: string
  readonly slowDown: string
  readonly speedUp: string
  readonly replay: string
  readonly saveWord: string
  readonly showDefinition: string
}

/**
 * Privacy and data settings
 */
export interface PrivacySettings {
  readonly collectAnalytics: boolean
  readonly shareUsageData: boolean
  readonly cacheTranslations: boolean
  readonly maxCacheSize: number // MB
  readonly autoDeleteOldData: boolean
  readonly dataRetentionDays: number
}

// ========================================
// Storage Schema & Migration
// ========================================

/**
 * Storage schema versioning for data migrations
 */
export interface StorageSchema {
  readonly version: number
  readonly lastMigration: number
  readonly migrationHistory: MigrationRecord[]
}

/**
 * Record of a completed migration
 */
export interface MigrationRecord {
  readonly fromVersion: number
  readonly toVersion: number
  readonly timestamp: number
  readonly success: boolean
  readonly errorMessage?: string
}

// ========================================
// Storage Operations & Events
// ========================================

/**
 * Storage operation result with status and optional data
 */
export interface StorageResult<T = unknown> {
  readonly success: boolean
  readonly data?: T
  readonly error?: StorageError
  readonly timestamp: number
}

/**
 * Storage error information
 */
export interface StorageError {
  readonly code: StorageErrorCode
  readonly message: string
  readonly details?: Record<string, unknown>
  readonly timestamp: number
}

/**
 * Storage error codes for different failure scenarios
 */
export enum StorageErrorCode {
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  INVALID_DATA = 'INVALID_DATA',
  MIGRATION_FAILED = 'MIGRATION_FAILED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Storage event types for cross-context synchronization
 */
export enum StorageEventType {
  VOCABULARY_ADDED = 'VOCABULARY_ADDED',
  VOCABULARY_REMOVED = 'VOCABULARY_REMOVED',
  VOCABULARY_UPDATED = 'VOCABULARY_UPDATED',
  SETTINGS_UPDATED = 'SETTINGS_UPDATED',
  CACHE_CLEARED = 'CACHE_CLEARED',
  MIGRATION_COMPLETED = 'MIGRATION_COMPLETED',
}

/**
 * Storage event data structure
 */
export interface StorageEvent<T = unknown> {
  readonly type: StorageEventType
  readonly data: T
  readonly timestamp: number
  readonly source: 'content' | 'popup' | 'background'
}

// ========================================
// Storage Keys & Configuration
// ========================================

/**
 * Storage key constants to prevent typos and ensure consistency
 */
export const STORAGE_KEYS = {
  VOCABULARY: 'lingua_vocabulary',
  SETTINGS: 'lingua_settings',
  SCHEMA: 'lingua_schema',
  CACHE: 'lingua_cache',
  ANALYTICS: 'lingua_analytics',
} as const

/**
 * Default storage configuration
 */
export const STORAGE_CONFIG = {
  SCHEMA_VERSION: 1,
  MAX_VOCABULARY_ITEMS: 10000,
  MAX_CACHE_SIZE_MB: 10,
  CACHE_EXPIRY_HOURS: 24,
  MIGRATION_TIMEOUT_MS: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY_MS: 1000,
} as const

// ========================================
// API Function Signatures
// ========================================

/**
 * Main storage service interface defining all public methods
 */
export interface StorageService {
  // Vocabulary operations
  saveWord(item: Omit<VocabularyItem, 'id' | 'createdAt'>): Promise<StorageResult<VocabularyItem>>
  getVocabulary(): Promise<StorageResult<VocabularyItem[]>>
  removeWord(id: string): Promise<StorageResult<void>>
  updateWord(id: string, updates: Partial<VocabularyItem>): Promise<StorageResult<VocabularyItem>>
  clearVocabulary(): Promise<StorageResult<void>>

  // Settings operations
  saveSettings(settings: Partial<UserSettings>): Promise<StorageResult<UserSettings>>
  getSettings(): Promise<StorageResult<UserSettings>>
  resetSettings(): Promise<StorageResult<UserSettings>>

  // Cache operations
  setCache<T>(key: string, value: T, ttl?: number): Promise<StorageResult<void>>
  getCache<T>(key: string): Promise<StorageResult<T | null>>
  clearCache(): Promise<StorageResult<void>>

  // Event handling
  addEventListener(type: StorageEventType, listener: (event: StorageEvent) => void): void
  removeEventListener(type: StorageEventType, listener: (event: StorageEvent) => void): void

  // Utility
  getStorageUsage(): Promise<StorageResult<{ used: number; available: number }>>
  exportData(): Promise<StorageResult<string>>
  importData(data: string): Promise<StorageResult<void>>
}
