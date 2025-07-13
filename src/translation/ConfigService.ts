// Configuration service for Microsoft Translator API integration
// Handles Chrome storage, API key management, and environment configuration

import {
  TranslationConfig,
  DEFAULT_TRANSLATION_CONFIG,
  TranslationErrorCode,
  TranslationError,
  LanguageCode,
} from './types'
import { Logger } from '../logging/Logger'
import { ComponentType } from '../logging/types'

// ============================================================================
// Configuration Keys for Chrome Storage
// ============================================================================

const STORAGE_KEYS = {
  API_KEY: 'translator_api_key',
  CONFIG: 'translator_config',
  USAGE_STATS: 'translator_usage_stats',
  CACHE_STATS: 'translator_cache_stats',
  RATE_LIMIT_DATA: 'translator_rate_limit_data',
} as const

// ============================================================================
// Configuration Validation
// ============================================================================

export class ConfigValidationError extends Error implements TranslationError {
  code: TranslationErrorCode
  details?: any
  retryable: boolean
  timestamp: number

  constructor(message: string, code: TranslationErrorCode, details?: any) {
    super(message)
    this.name = 'ConfigValidationError'
    this.code = code
    this.details = details
    this.retryable = false
    this.timestamp = Date.now()
  }
}

// ============================================================================
// Configuration Service
// ============================================================================

export class ConfigService {
  private cachedConfig: TranslationConfig | null = null
  private configUpdateListeners: Array<(config: TranslationConfig) => void> = []

  // --------------------------------------------------------------------------
  // Core Configuration Management
  // --------------------------------------------------------------------------

  /**
   * Get the complete translation configuration
   */
  async getConfig(): Promise<TranslationConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig
    }

    try {
      const result = await chrome.storage.sync.get([STORAGE_KEYS.CONFIG, STORAGE_KEYS.API_KEY])

      const apiKey = result[STORAGE_KEYS.API_KEY] as string
      const storedConfig = result[STORAGE_KEYS.CONFIG] as Partial<TranslationConfig>

      if (!apiKey) {
        throw new ConfigValidationError(
          'Microsoft Translator API key not found. Please configure your API key in the extension settings.',
          TranslationErrorCode.MISSING_API_KEY,
        )
      }

      // Merge stored config with defaults
      const config: TranslationConfig = {
        ...DEFAULT_TRANSLATION_CONFIG,
        ...storedConfig,
        apiKey,
      } as TranslationConfig

      // Validate the configuration
      this.validateConfig(config)

      // Cache the validated configuration
      this.cachedConfig = config
      return config
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error
      }

      throw new ConfigValidationError(
        'Failed to load translation configuration',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error },
      )
    }
  }

  /**
   * Update the translation configuration
   */
  async updateConfig(updates: Partial<TranslationConfig>): Promise<void> {
    try {
      const currentConfig = await this.getConfig()
      const newConfig = { ...currentConfig, ...updates }

      // Validate the new configuration
      this.validateConfig(newConfig)

      // Save to Chrome storage (excluding API key which is stored separately)
      const { apiKey, ...configToStore } = newConfig

      await Promise.all([
        chrome.storage.sync.set({
          [STORAGE_KEYS.CONFIG]: configToStore,
          [STORAGE_KEYS.API_KEY]: apiKey,
        }),
      ])

      // Update cache
      this.cachedConfig = newConfig

      // Notify listeners
      this.notifyConfigUpdate(newConfig)
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error
      }

      throw new ConfigValidationError(
        'Failed to update translation configuration',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error, updates },
      )
    }
  }

  /**
   * Set the API key securely
   */
  async setApiKey(apiKey: string): Promise<void> {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new ConfigValidationError(
        'Invalid API key provided',
        TranslationErrorCode.MISSING_API_KEY,
      )
    }

    const trimmedKey = apiKey.trim()

    // Basic API key format validation (Azure keys are typically 32 characters)
    if (trimmedKey.length < 16) {
      throw new ConfigValidationError(
        'API key appears to be invalid (too short)',
        TranslationErrorCode.MISSING_API_KEY,
      )
    }

    try {
      await chrome.storage.sync.set({
        [STORAGE_KEYS.API_KEY]: trimmedKey,
      })

      // Clear cached config to force reload with new key
      this.cachedConfig = null
    } catch (error) {
      throw new ConfigValidationError(
        'Failed to save API key',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error },
      )
    }
  }

  /**
   * Get the current API key
   */
  async getApiKey(): Promise<string> {
    try {
      const result = await chrome.storage.sync.get([STORAGE_KEYS.API_KEY])
      const apiKey = result[STORAGE_KEYS.API_KEY] as string

      if (!apiKey) {
        throw new ConfigValidationError('API key not found', TranslationErrorCode.MISSING_API_KEY)
      }

      return apiKey
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        throw error
      }

      throw new ConfigValidationError(
        'Failed to retrieve API key',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error },
      )
    }
  }

  /**
   * Check if the service is properly configured
   */
  async isConfigured(): Promise<boolean> {
    try {
      await this.getConfig()
      return true
    } catch (error) {
      return false
    }
  }

  // --------------------------------------------------------------------------
  // Environment-Specific Configurations
  // --------------------------------------------------------------------------

  /**
   * Get configuration for development environment
   */
  static getDevelopmentConfig(): Partial<TranslationConfig> {
    return {
      ...DEFAULT_TRANSLATION_CONFIG,
      timeout: 10000,
      retryAttempts: 1,
      rateLimitConfig: {
        ...DEFAULT_TRANSLATION_CONFIG.rateLimitConfig!,
        maxCharactersPerMinute: 1000,
        maxRequestsPerSecond: 2,
      },
      cacheConfig: {
        ...DEFAULT_TRANSLATION_CONFIG.cacheConfig!,
        ttlHours: 1,
        maxEntries: 100,
      },
    }
  }

  /**
   * Get configuration for production environment
   */
  static getProductionConfig(): Partial<TranslationConfig> {
    return {
      ...DEFAULT_TRANSLATION_CONFIG,
      timeout: 30000,
      retryAttempts: 3,
      rateLimitConfig: {
        ...DEFAULT_TRANSLATION_CONFIG.rateLimitConfig!,
        maxCharactersPerMonth: 2000000,
        maxCharactersPerMinute: 10000,
        maxRequestsPerSecond: 10,
      },
      cacheConfig: {
        ...DEFAULT_TRANSLATION_CONFIG.cacheConfig!,
        enabled: true,
        ttlHours: 24,
        maxEntries: 10000,
        compressionEnabled: true,
      },
    }
  }

  /**
   * Apply environment-specific configuration
   */
  async applyEnvironmentConfig(environment: 'development' | 'production'): Promise<void> {
    const envConfig =
      environment === 'development'
        ? ConfigService.getDevelopmentConfig()
        : ConfigService.getProductionConfig()

    await this.updateConfig(envConfig)
  }

  // --------------------------------------------------------------------------
  // Configuration Reset and Management
  // --------------------------------------------------------------------------

  /**
   * Reset configuration to defaults (keeping API key)
   */
  async resetToDefaults(): Promise<void> {
    try {
      const apiKey = await this.getApiKey()

      await chrome.storage.sync.set({
        [STORAGE_KEYS.CONFIG]: DEFAULT_TRANSLATION_CONFIG,
      })

      this.cachedConfig = {
        ...DEFAULT_TRANSLATION_CONFIG,
        apiKey,
      } as TranslationConfig

      this.notifyConfigUpdate(this.cachedConfig)
    } catch (error) {
      throw new ConfigValidationError(
        'Failed to reset configuration to defaults',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error },
      )
    }
  }

  /**
   * Clear all configuration data (including API key)
   */
  async clearAllConfig(): Promise<void> {
    try {
      await chrome.storage.sync.remove([
        STORAGE_KEYS.API_KEY,
        STORAGE_KEYS.CONFIG,
        STORAGE_KEYS.USAGE_STATS,
        STORAGE_KEYS.CACHE_STATS,
        STORAGE_KEYS.RATE_LIMIT_DATA,
      ])

      this.cachedConfig = null
    } catch (error) {
      throw new ConfigValidationError(
        'Failed to clear configuration data',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error },
      )
    }
  }

  /**
   * Export configuration for backup
   */
  async exportConfig(): Promise<{ config: Partial<TranslationConfig>; timestamp: number }> {
    try {
      const config = await this.getConfig()
      const { apiKey, ...exportableConfig } = config

      return {
        config: exportableConfig,
        timestamp: Date.now(),
      }
    } catch (error) {
      throw new ConfigValidationError(
        'Failed to export configuration',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error },
      )
    }
  }

  /**
   * Import configuration from backup
   */
  async importConfig(exportedConfig: {
    config: Partial<TranslationConfig>
    timestamp: number
  }): Promise<void> {
    try {
      await this.updateConfig(exportedConfig.config)
    } catch (error) {
      throw new ConfigValidationError(
        'Failed to import configuration',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error, importData: exportedConfig },
      )
    }
  }

  // --------------------------------------------------------------------------
  // Configuration Change Listeners
  // --------------------------------------------------------------------------

  /**
   * Add a listener for configuration changes
   */
  addConfigUpdateListener(listener: (config: TranslationConfig) => void): void {
    this.configUpdateListeners.push(listener)
  }

  /**
   * Remove a configuration change listener
   */
  removeConfigUpdateListener(listener: (config: TranslationConfig) => void): void {
    const index = this.configUpdateListeners.indexOf(listener)
    if (index !== -1) {
      this.configUpdateListeners.splice(index, 1)
    }
  }

  /**
   * Notify all listeners of configuration changes
   */
  private notifyConfigUpdate(config: TranslationConfig): void {
    this.configUpdateListeners.forEach((listener) => {
      try {
        listener(config)
      } catch (error) {
        const logger = Logger.getInstance()
        logger?.warn('Error in config update listener', {
          component: ComponentType.TRANSLATION_SERVICE,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        })
      }
    })
  }

  // --------------------------------------------------------------------------
  // Configuration Validation
  // --------------------------------------------------------------------------

  /**
   * Validate a configuration object
   */
  private validateConfig(config: TranslationConfig): void {
    // Validate API key
    if (!config.apiKey || typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
      throw new ConfigValidationError(
        'API key is required and cannot be empty',
        TranslationErrorCode.MISSING_API_KEY,
      )
    }

    // Validate endpoint
    if (!config.endpoint || typeof config.endpoint !== 'string') {
      throw new ConfigValidationError('Invalid endpoint URL', TranslationErrorCode.INVALID_ENDPOINT)
    }

    try {
      new URL(config.endpoint)
    } catch {
      throw new ConfigValidationError(
        'Invalid endpoint URL format',
        TranslationErrorCode.INVALID_ENDPOINT,
        { endpoint: config.endpoint },
      )
    }

    // Validate API version
    if (!config.apiVersion || typeof config.apiVersion !== 'string') {
      throw new ConfigValidationError(
        'API version is required',
        TranslationErrorCode.INVALID_CONFIG,
        { apiVersion: config.apiVersion },
      )
    }

    // Validate timeout
    if (typeof config.timeout !== 'number' || config.timeout <= 0) {
      throw new ConfigValidationError(
        'Timeout must be a positive number',
        TranslationErrorCode.INVALID_CONFIG,
        { timeout: config.timeout },
      )
    }

    // Validate retry attempts
    if (typeof config.retryAttempts !== 'number' || config.retryAttempts < 0) {
      throw new ConfigValidationError(
        'Retry attempts must be a non-negative number',
        TranslationErrorCode.INVALID_CONFIG,
        { retryAttempts: config.retryAttempts },
      )
    }

    // Validate rate limit config
    if (!config.rateLimitConfig) {
      throw new ConfigValidationError(
        'Rate limit configuration is required',
        TranslationErrorCode.INVALID_CONFIG,
      )
    }

    const { rateLimitConfig } = config
    if (
      rateLimitConfig.maxCharactersPerMonth <= 0 ||
      rateLimitConfig.maxCharactersPerMinute <= 0 ||
      rateLimitConfig.maxRequestsPerSecond <= 0
    ) {
      throw new ConfigValidationError(
        'Rate limit values must be positive numbers',
        TranslationErrorCode.INVALID_CONFIG,
        { rateLimitConfig },
      )
    }

    // Validate cache config
    if (!config.cacheConfig) {
      throw new ConfigValidationError(
        'Cache configuration is required',
        TranslationErrorCode.INVALID_CONFIG,
      )
    }

    const { cacheConfig } = config
    if (cacheConfig.ttlHours <= 0 || cacheConfig.maxEntries <= 0) {
      throw new ConfigValidationError(
        'Cache TTL and max entries must be positive numbers',
        TranslationErrorCode.INVALID_CONFIG,
        { cacheConfig },
      )
    }

    // Validate batch config
    if (!config.batchConfig) {
      throw new ConfigValidationError(
        'Batch configuration is required',
        TranslationErrorCode.INVALID_CONFIG,
      )
    }

    const { batchConfig } = config
    if (
      batchConfig.maxTextsPerBatch <= 0 ||
      batchConfig.maxBatchSizeBytes <= 0 ||
      batchConfig.batchTimeoutMs <= 0
    ) {
      throw new ConfigValidationError(
        'Batch configuration values must be positive numbers',
        TranslationErrorCode.INVALID_CONFIG,
        { batchConfig },
      )
    }
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Get the storage keys used by the configuration service
   */
  static getStorageKeys() {
    return STORAGE_KEYS
  }

  /**
   * Validate a language code
   */
  static isValidLanguageCode(code: string): code is LanguageCode {
    const validCodes = [
      'en',
      'es',
      'fr',
      'de',
      'it',
      'pt',
      'ru',
      'ja',
      'ko',
      'zh',
      'ar',
      'hi',
      'tr',
      'pl',
      'nl',
      'sv',
      'da',
      'no',
      'fi',
      'cs',
      'hu',
      'ro',
      'bg',
      'hr',
      'sk',
      'sl',
      'et',
      'lv',
      'lt',
      'mt',
      'el',
      'he',
      'th',
      'vi',
      'id',
      'ms',
      'tl',
      'sw',
      'yo',
      'zu',
      'af',
      'sq',
      'am',
      'hy',
      'az',
      'eu',
      'be',
      'bn',
      'bs',
      'my',
      'ca',
      'ceb',
      'ny',
      'co',
      'cy',
      'eo',
      'fa',
      'fy',
      'gd',
      'gl',
      'ka',
      'gu',
      'ht',
      'ha',
      'haw',
      'iw',
      'hmn',
      'is',
      'ig',
      'ga',
      'jw',
      'kn',
      'kk',
      'km',
      'rw',
      'ku',
      'ky',
      'lo',
      'la',
      'lb',
      'mk',
      'mg',
      'ml',
      'mi',
      'mr',
      'mn',
      'ne',
      'ps',
      'pa',
      'sm',
      'sr',
      'st',
      'sn',
      'sd',
      'si',
      'so',
      'su',
      'tg',
      'ta',
      'tt',
      'te',
      'uk',
      'ur',
      'ug',
      'uz',
      'xh',
      'yi',
      'auto',
    ]
    return validCodes.includes(code)
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

// Export a singleton instance for use throughout the application
export const configService = new ConfigService()
