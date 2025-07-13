// Rate limiting service for Microsoft Translator API integration
// Implements token bucket algorithm with persistent storage and quota tracking

import { RateLimitConfig, TranslationErrorCode, TranslationError } from './types'
import { configService } from './ConfigService'
import { TranslationErrorImpl } from './TranslationApiService'
import { Logger } from '../logging/Logger'
import { ComponentType } from '../logging/types'

// ============================================================================
// Rate Limiting Storage Keys
// ============================================================================

const RATE_LIMIT_STORAGE_KEYS = {
  MONTHLY_USAGE: 'translator_monthly_usage',
  DAILY_USAGE: 'translator_daily_usage',
  MINUTE_USAGE: 'translator_minute_usage',
  REQUEST_TOKENS: 'translator_request_tokens',
  LAST_RESET: 'translator_last_reset',
} as const

// ============================================================================
// Rate Limiting Types
// ============================================================================

interface UsageData {
  characters: number
  requests: number
  timestamp: number
  windowStart: number
}

interface TokenBucket {
  tokens: number
  lastRefill: number
  capacity: number
  refillRate: number // tokens per second
}

interface RateLimitStatus {
  allowed: boolean
  remainingCharacters: number
  remainingRequests: number
  resetTime?: number
  retryAfter?: number
  quotaExceeded: boolean
}

interface UsageStats {
  monthly: UsageData
  daily: UsageData
  minute: UsageData
  requestBucket: TokenBucket
}

// ============================================================================
// Rate Limiting Service
// ============================================================================

export class RateLimitService {
  private config: RateLimitConfig | null = null
  private usageStats: UsageStats | null = null
  private lastConfigUpdate: number = 0

  // --------------------------------------------------------------------------
  // Initialization and Configuration
  // --------------------------------------------------------------------------

  /**
   * Initialize the rate limiting service
   */
  async initialize(): Promise<void> {
    try {
      await this.loadConfig()
      await this.loadUsageStats()
    } catch (error) {
      throw new TranslationErrorImpl(
        'Failed to initialize rate limiting service',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error },
      )
    }
  }

  /**
   * Load configuration from the config service
   */
  private async loadConfig(): Promise<void> {
    const translationConfig = await configService.getConfig()
    this.config = translationConfig.rateLimitConfig
    this.lastConfigUpdate = Date.now()
  }

  /**
   * Load usage statistics from Chrome storage
   */
  private async loadUsageStats(): Promise<void> {
    if (!this.config) {
      throw new TranslationErrorImpl(
        'Rate limit configuration not loaded',
        TranslationErrorCode.INVALID_CONFIG,
      )
    }

    try {
      const result = await chrome.storage.local.get([
        RATE_LIMIT_STORAGE_KEYS.MONTHLY_USAGE,
        RATE_LIMIT_STORAGE_KEYS.DAILY_USAGE,
        RATE_LIMIT_STORAGE_KEYS.MINUTE_USAGE,
        RATE_LIMIT_STORAGE_KEYS.REQUEST_TOKENS,
        RATE_LIMIT_STORAGE_KEYS.LAST_RESET,
      ])

      const now = Date.now()
      const monthStart = this.getMonthStart(now)
      const dayStart = this.getDayStart(now)
      const minuteStart = this.getMinuteStart(now)

      // Initialize or load monthly usage
      this.usageStats = {
        monthly: this.initializeUsageData(
          result[RATE_LIMIT_STORAGE_KEYS.MONTHLY_USAGE],
          monthStart,
          now,
        ),
        daily: this.initializeUsageData(result[RATE_LIMIT_STORAGE_KEYS.DAILY_USAGE], dayStart, now),
        minute: this.initializeUsageData(
          result[RATE_LIMIT_STORAGE_KEYS.MINUTE_USAGE],
          minuteStart,
          now,
        ),
        requestBucket: this.initializeTokenBucket(
          result[RATE_LIMIT_STORAGE_KEYS.REQUEST_TOKENS],
          this.config.maxRequestsPerSecond,
        ),
      }

      // Reset windows that have expired
      await this.resetExpiredWindows()
    } catch (error) {
      throw new TranslationErrorImpl(
        'Failed to load usage statistics',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error },
      )
    }
  }

  /**
   * Initialize usage data structure
   */
  private initializeUsageData(stored: any, windowStart: number, now: number): UsageData {
    if (stored && stored.windowStart === windowStart) {
      return {
        characters: stored.characters || 0,
        requests: stored.requests || 0,
        timestamp: stored.timestamp || now,
        windowStart,
      }
    }

    return {
      characters: 0,
      requests: 0,
      timestamp: now,
      windowStart,
    }
  }

  /**
   * Initialize token bucket
   */
  private initializeTokenBucket(stored: any, capacity: number): TokenBucket {
    const now = Date.now()

    if (stored && stored.capacity === capacity) {
      // Refill tokens based on time elapsed
      const secondsElapsed = (now - stored.lastRefill) / 1000
      const tokensToAdd = Math.floor(secondsElapsed * stored.refillRate)

      return {
        tokens: Math.min(capacity, stored.tokens + tokensToAdd),
        lastRefill: now,
        capacity,
        refillRate: capacity, // Refill at rate of capacity per second
      }
    }

    return {
      tokens: capacity,
      lastRefill: now,
      capacity,
      refillRate: capacity,
    }
  }

  // --------------------------------------------------------------------------
  // Rate Limiting Checks
  // --------------------------------------------------------------------------

  /**
   * Check if a request is allowed based on rate limits
   */
  async checkRateLimit(characterCount: number = 0): Promise<RateLimitStatus> {
    await this.ensureInitialized()
    await this.resetExpiredWindows()

    const now = Date.now()
    const stats = this.usageStats!
    const config = this.config!

    // Check monthly quota
    if (stats.monthly.characters + characterCount > config.maxCharactersPerMonth) {
      return {
        allowed: false,
        remainingCharacters: Math.max(0, config.maxCharactersPerMonth - stats.monthly.characters),
        remainingRequests: 0,
        quotaExceeded: true,
        resetTime: this.getMonthStart(now) + 30 * 24 * 60 * 60 * 1000, // Next month
      }
    }

    // Check minute quota
    if (stats.minute.characters + characterCount > config.maxCharactersPerMinute) {
      const minuteResetTime = stats.minute.windowStart + 60 * 1000
      return {
        allowed: false,
        remainingCharacters: Math.max(0, config.maxCharactersPerMinute - stats.minute.characters),
        remainingRequests: Math.max(0, config.maxRequestsPerSecond * 60 - stats.minute.requests),
        quotaExceeded: false,
        resetTime: minuteResetTime,
        retryAfter: Math.ceil((minuteResetTime - now) / 1000),
      }
    }

    // Check request rate limit (token bucket)
    const tokensNeeded = 1 // One token per request
    if (stats.requestBucket.tokens < tokensNeeded) {
      const timeToRefill = Math.ceil(
        (tokensNeeded - stats.requestBucket.tokens) / stats.requestBucket.refillRate,
      )

      return {
        allowed: false,
        remainingCharacters: Math.max(0, config.maxCharactersPerMinute - stats.minute.characters),
        remainingRequests: Math.floor(stats.requestBucket.tokens),
        quotaExceeded: false,
        retryAfter: timeToRefill,
      }
    }

    // Request is allowed
    return {
      allowed: true,
      remainingCharacters: Math.min(
        config.maxCharactersPerMonth - stats.monthly.characters,
        config.maxCharactersPerMinute - stats.minute.characters,
      ),
      remainingRequests: Math.floor(stats.requestBucket.tokens),
      quotaExceeded: false,
    }
  }

  /**
   * Record API usage after a successful request
   */
  async recordUsage(characterCount: number): Promise<void> {
    await this.ensureInitialized()

    const now = Date.now()
    const stats = this.usageStats!

    // Update usage statistics
    stats.monthly.characters += characterCount
    stats.monthly.requests += 1
    stats.monthly.timestamp = now

    stats.daily.characters += characterCount
    stats.daily.requests += 1
    stats.daily.timestamp = now

    stats.minute.characters += characterCount
    stats.minute.requests += 1
    stats.minute.timestamp = now

    // Consume token from bucket
    stats.requestBucket.tokens = Math.max(0, stats.requestBucket.tokens - 1)
    stats.requestBucket.lastRefill = now

    // Save to storage
    await this.saveUsageStats()
  }

  /**
   * Get current usage statistics
   */
  async getUsageStats(): Promise<{
    monthly: { used: number; limit: number; percentage: number }
    daily: { used: number; limit: number; percentage: number }
    minute: { used: number; limit: number; percentage: number }
    requestTokens: { available: number; capacity: number }
  }> {
    await this.ensureInitialized()

    const stats = this.usageStats!
    const config = this.config!

    return {
      monthly: {
        used: stats.monthly.characters,
        limit: config.maxCharactersPerMonth,
        percentage: Math.round((stats.monthly.characters / config.maxCharactersPerMonth) * 100),
      },
      daily: {
        used: stats.daily.characters,
        limit: config.maxCharactersPerMinute * 1440, // Minutes in a day
        percentage: Math.round(
          (stats.daily.characters / (config.maxCharactersPerMinute * 1440)) * 100,
        ),
      },
      minute: {
        used: stats.minute.characters,
        limit: config.maxCharactersPerMinute,
        percentage: Math.round((stats.minute.characters / config.maxCharactersPerMinute) * 100),
      },
      requestTokens: {
        available: Math.floor(stats.requestBucket.tokens),
        capacity: stats.requestBucket.capacity,
      },
    }
  }

  // --------------------------------------------------------------------------
  // Window Management
  // --------------------------------------------------------------------------

  /**
   * Reset expired time windows
   */
  private async resetExpiredWindows(): Promise<void> {
    if (!this.usageStats) return

    const now = Date.now()
    let needsSave = false

    // Check and reset monthly window
    const currentMonthStart = this.getMonthStart(now)
    if (this.usageStats.monthly.windowStart < currentMonthStart) {
      this.usageStats.monthly = this.initializeUsageData(null, currentMonthStart, now)
      needsSave = true
    }

    // Check and reset daily window
    const currentDayStart = this.getDayStart(now)
    if (this.usageStats.daily.windowStart < currentDayStart) {
      this.usageStats.daily = this.initializeUsageData(null, currentDayStart, now)
      needsSave = true
    }

    // Check and reset minute window
    const currentMinuteStart = this.getMinuteStart(now)
    if (this.usageStats.minute.windowStart < currentMinuteStart) {
      this.usageStats.minute = this.initializeUsageData(null, currentMinuteStart, now)
      needsSave = true
    }

    // Refill request tokens
    const secondsSinceRefill = (now - this.usageStats.requestBucket.lastRefill) / 1000
    if (secondsSinceRefill >= 1) {
      const tokensToAdd = Math.floor(secondsSinceRefill * this.usageStats.requestBucket.refillRate)
      if (tokensToAdd > 0) {
        this.usageStats.requestBucket.tokens = Math.min(
          this.usageStats.requestBucket.capacity,
          this.usageStats.requestBucket.tokens + tokensToAdd,
        )
        this.usageStats.requestBucket.lastRefill = now
        needsSave = true
      }
    }

    if (needsSave) {
      await this.saveUsageStats()
    }
  }

  /**
   * Get the start of the current month
   */
  private getMonthStart(timestamp: number): number {
    const date = new Date(timestamp)
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  }

  /**
   * Get the start of the current day
   */
  private getDayStart(timestamp: number): number {
    const date = new Date(timestamp)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  }

  /**
   * Get the start of the current minute
   */
  private getMinuteStart(timestamp: number): number {
    const date = new Date(timestamp)
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      0,
      0,
    ).getTime()
  }

  // --------------------------------------------------------------------------
  // Storage Management
  // --------------------------------------------------------------------------

  /**
   * Save usage statistics to Chrome storage
   */
  private async saveUsageStats(): Promise<void> {
    if (!this.usageStats) return

    try {
      await chrome.storage.local.set({
        [RATE_LIMIT_STORAGE_KEYS.MONTHLY_USAGE]: this.usageStats.monthly,
        [RATE_LIMIT_STORAGE_KEYS.DAILY_USAGE]: this.usageStats.daily,
        [RATE_LIMIT_STORAGE_KEYS.MINUTE_USAGE]: this.usageStats.minute,
        [RATE_LIMIT_STORAGE_KEYS.REQUEST_TOKENS]: this.usageStats.requestBucket,
        [RATE_LIMIT_STORAGE_KEYS.LAST_RESET]: Date.now(),
      })
          } catch (error) {
        const logger = Logger.getInstance()
        logger.warn('Failed to save rate limit usage stats', {
          component: ComponentType.TRANSLATION_SERVICE,
          metadata: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
  }

  /**
   * Clear all usage statistics
   */
  async clearUsageStats(): Promise<void> {
    try {
      await chrome.storage.local.remove([
        RATE_LIMIT_STORAGE_KEYS.MONTHLY_USAGE,
        RATE_LIMIT_STORAGE_KEYS.DAILY_USAGE,
        RATE_LIMIT_STORAGE_KEYS.MINUTE_USAGE,
        RATE_LIMIT_STORAGE_KEYS.REQUEST_TOKENS,
        RATE_LIMIT_STORAGE_KEYS.LAST_RESET,
      ])

      // Reinitialize stats
      await this.loadUsageStats()
    } catch (error) {
      throw new TranslationErrorImpl(
        'Failed to clear usage statistics',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error },
      )
    }
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Ensure the service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.config || !this.usageStats) {
      await this.initialize()
    }

    // Check if config needs to be reloaded (every 5 minutes)
    if (Date.now() - this.lastConfigUpdate > 5 * 60 * 1000) {
      await this.loadConfig()
    }
  }

  /**
   * Get rate limit storage keys
   */
  static getStorageKeys() {
    return RATE_LIMIT_STORAGE_KEYS
  }

  /**
   * Calculate characters in text (for usage tracking)
   */
  static calculateCharacterCount(text: string | string[]): number {
    if (Array.isArray(text)) {
      return text.reduce((total, str) => total + str.length, 0)
    }
    return text.length
  }

  /**
   * Create a rate limit exceeded error
   */
  static createRateLimitError(status: RateLimitStatus): TranslationErrorImpl {
    if (status.quotaExceeded) {
      return new TranslationErrorImpl(
        'Monthly character quota exceeded',
        TranslationErrorCode.QUOTA_EXCEEDED,
        {
          remainingCharacters: status.remainingCharacters,
          resetTime: status.resetTime,
        },
      )
    }

    return new TranslationErrorImpl(
      'Rate limit exceeded',
      TranslationErrorCode.RATE_LIMIT_EXCEEDED,
      {
        remainingCharacters: status.remainingCharacters,
        remainingRequests: status.remainingRequests,
        retryAfter: status.retryAfter,
        resetTime: status.resetTime,
      },
    )
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

// Export a singleton instance for use throughout the application
export const rateLimitService = new RateLimitService()
