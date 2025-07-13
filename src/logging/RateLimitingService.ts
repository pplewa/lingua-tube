// ========================================
// Rate Limiting and Deduplication Service
// ========================================

import { LogLevel, LogEntry, ComponentType, ErrorSeverity, LoggerConfig } from './types'

/**
 * Enhanced rate limiting configuration per component/level
 */
export interface RateLimitConfig {
  readonly enabled: boolean
  readonly algorithm: 'sliding_window' | 'token_bucket' | 'leaky_bucket'
  readonly globalLimits: {
    readonly maxLogsPerSecond: number
    readonly burstLimit: number
    readonly windowMs: number
  }
  readonly componentLimits: Partial<
    Record<
      ComponentType,
      {
        readonly maxLogsPerSecond: number
        readonly burstLimit: number
      }
    >
  >
  readonly severityMultipliers: Record<ErrorSeverity, number>
  readonly cleanupIntervalMs: number
}

/**
 * Enhanced deduplication configuration
 */
export interface DeduplicationConfig {
  readonly enabled: boolean
  readonly windowMs: number
  readonly maxDuplicates: number
  readonly fingerprintStrategy: 'simple' | 'advanced' | 'context_aware'
  readonly hierarchicalDedup: boolean
  readonly cleanupIntervalMs: number
  readonly reportingThreshold: number // Report when duplicates exceed this count
}

/**
 * Rate limiting statistics
 */
export interface RateLimitStats {
  readonly totalRequests: number
  readonly blockedRequests: number
  readonly allowedRequests: number
  readonly blockageRate: number
  readonly byComponent: Record<
    ComponentType,
    {
      readonly total: number
      readonly blocked: number
      readonly rate: number
    }
  >
  readonly byLevel: Record<
    LogLevel,
    {
      readonly total: number
      readonly blocked: number
      readonly rate: number
    }
  >
  readonly currentTokens: Record<string, number>
  readonly avgProcessingTime: number
}

/**
 * Deduplication statistics
 */
export interface DeduplicationStats {
  readonly totalEntries: number
  readonly uniqueEntries: number
  readonly duplicatedEntries: number
  readonly deduplicationRate: number
  readonly topDuplicates: Array<{
    readonly fingerprint: string
    readonly count: number
    readonly message: string
    readonly component: ComponentType
  }>
  readonly byComponent: Record<
    ComponentType,
    {
      readonly total: number
      readonly unique: number
      readonly duplicated: number
    }
  >
  readonly cacheSize: number
  readonly avgProcessingTime: number
}

/**
 * Token bucket for rate limiting
 */
interface TokenBucket {
  tokens: number
  readonly capacity: number
  readonly refillRate: number
  lastRefill: number
}

/**
 * Sliding window entry
 */
interface WindowEntry {
  readonly timestamp: number
  readonly weight: number
}

/**
 * Deduplication cache entry
 */
interface DeduplicationEntry {
  count: number
  firstSeen: number
  lastSeen: number
  readonly message: string
  readonly component: ComponentType
  readonly level: LogLevel
  reportedAt?: number
}

/**
 * Comprehensive Rate Limiting and Deduplication Service
 */
export class RateLimitingService {
  private static instance: RateLimitingService | null = null

  private rateLimitConfig: RateLimitConfig
  private deduplicationConfig: DeduplicationConfig

  // Rate limiting state
  private tokenBuckets: Map<string, TokenBucket> = new Map()
  private slidingWindows: Map<string, WindowEntry[]> = new Map()
  private rateLimitStats: Map<
    string,
    { total: number; blocked: number; lastProcessingTime: number }
  > = new Map()

  // Deduplication state
  private deduplicationCache: Map<string, DeduplicationEntry> = new Map()
  private deduplicationStats: Map<
    string,
    { total: number; unique: number; lastProcessingTime: number }
  > = new Map()

  // Cleanup timers
  private rateLimitCleanupTimer: number | null = null
  private deduplicationCleanupTimer: number | null = null

  private constructor(rateLimitConfig: RateLimitConfig, deduplicationConfig: DeduplicationConfig) {
    this.rateLimitConfig = rateLimitConfig
    this.deduplicationConfig = deduplicationConfig

    this.initialize()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(
    rateLimitConfig?: RateLimitConfig,
    deduplicationConfig?: DeduplicationConfig,
  ): RateLimitingService | null {
    if (typeof window === 'undefined') {
      return null
    }
    if (!RateLimitingService.instance) {
      const defaultRateLimit: RateLimitConfig = {
        enabled: true,
        algorithm: 'token_bucket',
        globalLimits: {
          maxLogsPerSecond: 10,
          burstLimit: 50,
          windowMs: 1000,
        },
        componentLimits: {
          [ComponentType.BACKGROUND]: { maxLogsPerSecond: 20, burstLimit: 100 },
          [ComponentType.CONTENT_SCRIPT]: { maxLogsPerSecond: 15, burstLimit: 75 },
          [ComponentType.TRANSLATION_SERVICE]: { maxLogsPerSecond: 8, burstLimit: 40 },
          [ComponentType.YOUTUBE_INTEGRATION]: { maxLogsPerSecond: 12, burstLimit: 60 },
        },
        severityMultipliers: {
          [ErrorSeverity.LOW]: 1.0,
          [ErrorSeverity.MEDIUM]: 1.5,
          [ErrorSeverity.HIGH]: 2.0,
          [ErrorSeverity.CRITICAL]: 3.0,
        },
        cleanupIntervalMs: 60000, // 1 minute
      }

      const defaultDeduplication: DeduplicationConfig = {
        enabled: true,
        windowMs: 300000, // 5 minutes
        maxDuplicates: 10,
        fingerprintStrategy: 'context_aware',
        hierarchicalDedup: true,
        cleanupIntervalMs: 120000, // 2 minutes
        reportingThreshold: 50, // Report when duplicates exceed 50
      }

      RateLimitingService.instance = new RateLimitingService(
        rateLimitConfig || defaultRateLimit,
        deduplicationConfig || defaultDeduplication,
      )
    }
    return RateLimitingService.instance
  }

  /**
   * Initialize the service
   */
  private initialize(): void {
    if (this.rateLimitConfig.enabled) {
      this.setupRateLimitCleanup()
    }

    if (this.deduplicationConfig.enabled) {
      this.setupDeduplicationCleanup()
    }
  }

  /**
   * Check if log entry should be rate limited
   */
  public checkRateLimit(entry: LogEntry): boolean {
    if (!this.rateLimitConfig.enabled) return true

    const startTime = performance.now()
    const key = this.generateRateLimitKey(entry)
    const result = this.performRateLimitCheck(key, entry)
    const processingTime = performance.now() - startTime

    // Update statistics
    this.updateRateLimitStats(key, result, processingTime)

    return result
  }

  /**
   * Check for deduplication
   */
  public checkDeduplication(entry: LogEntry): {
    shouldLog: boolean
    dedupInfo?: DeduplicationEntry
  } {
    if (!this.deduplicationConfig.enabled) {
      return { shouldLog: true }
    }

    const startTime = performance.now()
    const fingerprint = this.generateFingerprint(entry)
    const result = this.performDeduplicationCheck(fingerprint, entry)
    const processingTime = performance.now() - startTime

    // Update statistics
    this.updateDeduplicationStats(entry.context.component, result.shouldLog, processingTime)

    return result
  }

  /**
   * Generate rate limit key
   */
  private generateRateLimitKey(entry: LogEntry): string {
    const component = entry.context.component
    const level = entry.level
    const severity = entry.errorContext?.severity || ErrorSeverity.LOW

    // Hierarchical key: global -> component -> level
    return `${component}:${level}:${severity}`
  }

  /**
   * Perform rate limit check based on configured algorithm
   */
  private performRateLimitCheck(key: string, entry: LogEntry): boolean {
    switch (this.rateLimitConfig.algorithm) {
      case 'token_bucket':
        return this.checkTokenBucket(key, entry)
      case 'sliding_window':
        return this.checkSlidingWindow(key, entry)
      case 'leaky_bucket':
        return this.checkLeakyBucket(key, entry)
      default:
        return this.checkTokenBucket(key, entry)
    }
  }

  /**
   * Token bucket rate limiting
   */
  private checkTokenBucket(key: string, entry: LogEntry): boolean {
    const now = Date.now()
    const limits = this.getRateLimitsForEntry(entry)

    let bucket = this.tokenBuckets.get(key)
    if (!bucket) {
      bucket = {
        tokens: limits.burstLimit,
        capacity: limits.burstLimit,
        refillRate: limits.maxLogsPerSecond,
        lastRefill: now,
      }
      this.tokenBuckets.set(key, bucket)
    }

    // Refill tokens based on elapsed time
    const timeSinceRefill = now - bucket.lastRefill
    const tokensToAdd = (timeSinceRefill / 1000) * bucket.refillRate
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd)
    bucket.lastRefill = now

    // Check if we have tokens available
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }

    return false
  }

  /**
   * Sliding window rate limiting
   */
  private checkSlidingWindow(key: string, entry: LogEntry): boolean {
    const now = Date.now()
    const limits = this.getRateLimitsForEntry(entry)
    const windowMs = this.rateLimitConfig.globalLimits.windowMs

    let _window = this.slidingWindows.get(key) || []

    // Remove entries outside the window
    _window = _window.filter((w) => now - w.timestamp < windowMs)

    // Calculate current weight in window
    const currentWeight = _window.reduce((sum, w) => sum + w.weight, 0)
    const severityWeight = this.getSeverityWeight(entry)

    if (currentWeight + severityWeight <= limits.maxLogsPerSecond) {
      _window.push({ timestamp: now, weight: severityWeight })
      this.slidingWindows.set(key, _window)
      return true
    }

    this.slidingWindows.set(key, _window)
    return false
  }

  /**
   * Leaky bucket rate limiting
   */
  private checkLeakyBucket(key: string, entry: LogEntry): boolean {
    // Simplified leaky bucket - similar to token bucket but with constant drain
    return this.checkTokenBucket(key, entry)
  }

  /**
   * Get rate limits for a specific entry
   */
  private getRateLimitsForEntry(entry: LogEntry): { maxLogsPerSecond: number; burstLimit: number } {
    const component = entry.context.component
    const componentLimits = this.rateLimitConfig.componentLimits[component]

    if (componentLimits) {
      return componentLimits
    }

    return {
      maxLogsPerSecond: this.rateLimitConfig.globalLimits.maxLogsPerSecond,
      burstLimit: this.rateLimitConfig.globalLimits.burstLimit,
    }
  }

  /**
   * Get severity weight for rate limiting
   */
  private getSeverityWeight(entry: LogEntry): number {
    const severity = entry.errorContext?.severity || ErrorSeverity.LOW
    return this.rateLimitConfig.severityMultipliers[severity] || 1.0
  }

  /**
   * Generate enhanced fingerprint for deduplication
   */
  private generateFingerprint(entry: LogEntry): string {
    switch (this.deduplicationConfig.fingerprintStrategy) {
      case 'simple':
        return this.generateSimpleFingerprint(entry)
      case 'advanced':
        return this.generateAdvancedFingerprint(entry)
      case 'context_aware':
        return this.generateContextAwareFingerprint(entry)
      default:
        return this.generateSimpleFingerprint(entry)
    }
  }

  /**
   * Simple fingerprint generation
   */
  private generateSimpleFingerprint(entry: LogEntry): string {
    return `${entry.level}:${entry.message}:${entry.context.component}`
  }

  /**
   * Advanced fingerprint generation
   */
  private generateAdvancedFingerprint(entry: LogEntry): string {
    const messageNormalized = entry.message.replace(/\d+/g, 'N').replace(/['"]/g, '')
    const action = entry.context.action || 'unknown'
    const errorType = entry.errorContext?.errorType || 'none'

    return `${entry.level}:${messageNormalized}:${entry.context.component}:${action}:${errorType}`
  }

  /**
   * Context-aware fingerprint generation
   */
  private generateContextAwareFingerprint(entry: LogEntry): string {
    const messageNormalized = entry.message
      .replace(/\d+/g, 'N')
      .replace(/['"]/g, '')
      .replace(/https?:\/\/[^\s]+/g, 'URL')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, 'EMAIL')

    const action = entry.context.action || 'unknown'
    const errorType = entry.errorContext?.errorType || 'none'
    const severity = entry.errorContext?.severity || 'none'
    const stackSignature = entry.errorContext?.stackTrace
      ? this.extractStackSignature(entry.errorContext.stackTrace)
      : 'none'

    return `${entry.level}:${messageNormalized}:${entry.context.component}:${action}:${errorType}:${severity}:${stackSignature}`
  }

  /**
   * Extract stack trace signature for fingerprinting
   */
  private extractStackSignature(stackTrace: string): string {
    const lines = stackTrace.split('\n').slice(0, 3) // Top 3 stack frames
    return lines
      .map((line) => line.replace(/:\d+:\d+/g, ':N:N')) // Remove line numbers
      .join('|')
      .substring(0, 100) // Limit length
  }

  /**
   * Perform deduplication check
   */
  private performDeduplicationCheck(
    fingerprint: string,
    entry: LogEntry,
  ): { shouldLog: boolean; dedupInfo?: DeduplicationEntry } {
    const now = Date.now()
    const existing = this.deduplicationCache.get(fingerprint)

    if (!existing) {
      // First occurrence
      const dedupEntry: DeduplicationEntry = {
        count: 1,
        firstSeen: now,
        lastSeen: now,
        message: entry.message,
        component: entry.context.component,
        level: entry.level,
      }
      this.deduplicationCache.set(fingerprint, dedupEntry)
      return { shouldLog: true, dedupInfo: dedupEntry }
    }

    // Check if within deduplication window
    if (now - existing.firstSeen < this.deduplicationConfig.windowMs) {
      existing.count++
      existing.lastSeen = now

      // Check if we should report this duplicate batch
      if (existing.count >= this.deduplicationConfig.reportingThreshold && !existing.reportedAt) {
        existing.reportedAt = now
        // Create a summary log entry for high-volume duplicates
        return {
          shouldLog: true,
          dedupInfo: {
            ...existing,
            message: `High volume duplicate detected: "${existing.message}" (${existing.count} occurrences)`,
          },
        }
      }

      // Check if we've exceeded max duplicates
      if (existing.count > this.deduplicationConfig.maxDuplicates) {
        return { shouldLog: false, dedupInfo: existing }
      }

      // Log every nth duplicate to maintain some visibility
      const logFrequency = Math.max(1, Math.floor(existing.count / 10))
      if (existing.count % logFrequency === 0) {
        return {
          shouldLog: true,
          dedupInfo: {
            ...existing,
            message: `${entry.message} (duplicate #${existing.count})`,
          },
        }
      }

      return { shouldLog: false, dedupInfo: existing }
    } else {
      // Outside window, reset
      const dedupEntry: DeduplicationEntry = {
        count: 1,
        firstSeen: now,
        lastSeen: now,
        message: entry.message,
        component: entry.context.component,
        level: entry.level,
      }
      this.deduplicationCache.set(fingerprint, dedupEntry)
      return { shouldLog: true, dedupInfo: dedupEntry }
    }
  }

  /**
   * Update rate limiting statistics
   */
  private updateRateLimitStats(key: string, allowed: boolean, processingTime: number): void {
    let stats = this.rateLimitStats.get(key)
    if (!stats) {
      stats = { total: 0, blocked: 0, lastProcessingTime: 0 }
      this.rateLimitStats.set(key, stats)
    }

    stats.total++
    if (!allowed) {
      stats.blocked++
    }
    stats.lastProcessingTime = processingTime
  }

  /**
   * Update deduplication statistics
   */
  private updateDeduplicationStats(
    component: ComponentType,
    shouldLog: boolean,
    processingTime: number,
  ): void {
    const key = component
    let stats = this.deduplicationStats.get(key)
    if (!stats) {
      stats = { total: 0, unique: 0, lastProcessingTime: 0 }
      this.deduplicationStats.set(key, stats)
    }

    stats.total++
    if (shouldLog) {
      stats.unique++
    }
    stats.lastProcessingTime = processingTime
  }

  /**
   * Setup rate limit cleanup timer
   */
  private setupRateLimitCleanup(): void {
    this.rateLimitCleanupTimer = window.setInterval(() => {
      this.cleanupRateLimitData()
    }, this.rateLimitConfig.cleanupIntervalMs)
  }

  /**
   * Setup deduplication cleanup timer
   */
  private setupDeduplicationCleanup(): void {
    this.deduplicationCleanupTimer = window.setInterval(() => {
      this.cleanupDeduplicationData()
    }, this.deduplicationConfig.cleanupIntervalMs)
  }

  /**
   * Cleanup old rate limit data
   */
  private cleanupRateLimitData(): void {
    const now = Date.now()
    const windowMs = this.rateLimitConfig.globalLimits.windowMs

    // Clean up sliding windows
    for (const [key, window] of this.slidingWindows.entries()) {
      const filtered = window.filter((w) => now - w.timestamp < windowMs)
      if (filtered.length === 0) {
        this.slidingWindows.delete(key)
      } else {
        this.slidingWindows.set(key, filtered)
      }
    }

    // Clean up token buckets that haven't been used recently
    for (const [key, bucket] of this.tokenBuckets.entries()) {
      if (now - bucket.lastRefill > windowMs * 10) {
        // 10x window for cleanup
        this.tokenBuckets.delete(key)
      }
    }
  }

  /**
   * Cleanup old deduplication data
   */
  private cleanupDeduplicationData(): void {
    const now = Date.now()
    const windowMs = this.deduplicationConfig.windowMs

    for (const [fingerprint, entry] of this.deduplicationCache.entries()) {
      if (now - entry.lastSeen > windowMs) {
        this.deduplicationCache.delete(fingerprint)
      }
    }
  }

  /**
   * Get rate limiting statistics
   */
  public getRateLimitStats(): RateLimitStats {
    const totalRequests = Array.from(this.rateLimitStats.values()).reduce(
      (sum, stats) => sum + stats.total,
      0,
    )
    const blockedRequests = Array.from(this.rateLimitStats.values()).reduce(
      (sum, stats) => sum + stats.blocked,
      0,
    )

    const byComponent: Record<ComponentType, { total: number; blocked: number; rate: number }> =
      {} as any
    const byLevel: Record<LogLevel, { total: number; blocked: number; rate: number }> = {} as any

    // Aggregate by component and level
    for (const [key, stats] of this.rateLimitStats.entries()) {
      const [component, level] = key.split(':')

      if (!byComponent[component as ComponentType]) {
        byComponent[component as ComponentType] = { total: 0, blocked: 0, rate: 0 }
      }
      if (!byLevel[level as LogLevel]) {
        byLevel[level as LogLevel] = { total: 0, blocked: 0, rate: 0 }
      }

      byComponent[component as ComponentType].total += stats.total
      byComponent[component as ComponentType].blocked += stats.blocked
      byLevel[level as LogLevel].total += stats.total
      byLevel[level as LogLevel].blocked += stats.blocked
    }

    // Calculate rates
    Object.values(byComponent).forEach((stats) => {
      stats.rate = stats.total > 0 ? (stats.blocked / stats.total) * 100 : 0
    })
    Object.values(byLevel).forEach((stats) => {
      stats.rate = stats.total > 0 ? (stats.blocked / stats.total) * 100 : 0
    })

    const currentTokens: Record<string, number> = {}
    for (const [key, bucket] of this.tokenBuckets.entries()) {
      currentTokens[key] = bucket.tokens
    }

    const avgProcessingTime =
      Array.from(this.rateLimitStats.values()).reduce(
        (sum, stats) => sum + stats.lastProcessingTime,
        0,
      ) / this.rateLimitStats.size || 0

    return {
      totalRequests,
      blockedRequests,
      allowedRequests: totalRequests - blockedRequests,
      blockageRate: totalRequests > 0 ? (blockedRequests / totalRequests) * 100 : 0,
      byComponent,
      byLevel,
      currentTokens,
      avgProcessingTime,
    }
  }

  /**
   * Get deduplication statistics
   */
  public getDeduplicationStats(): DeduplicationStats {
    const totalEntries = Array.from(this.deduplicationStats.values()).reduce(
      (sum, stats) => sum + stats.total,
      0,
    )
    const uniqueEntries = Array.from(this.deduplicationStats.values()).reduce(
      (sum, stats) => sum + stats.unique,
      0,
    )

    const topDuplicates = Array.from(this.deduplicationCache.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([fingerprint, entry]) => ({
        fingerprint: fingerprint.substring(0, 50) + '...',
        count: entry.count,
        message: entry.message,
        component: entry.component,
      }))

    const byComponent: Record<
      ComponentType,
      { total: number; unique: number; duplicated: number }
    > = {} as any
    for (const [component, stats] of this.deduplicationStats.entries()) {
      byComponent[component as ComponentType] = {
        total: stats.total,
        unique: stats.unique,
        duplicated: stats.total - stats.unique,
      }
    }

    const avgProcessingTime =
      Array.from(this.deduplicationStats.values()).reduce(
        (sum, stats) => sum + stats.lastProcessingTime,
        0,
      ) / this.deduplicationStats.size || 0

    return {
      totalEntries,
      uniqueEntries,
      duplicatedEntries: totalEntries - uniqueEntries,
      deduplicationRate:
        totalEntries > 0 ? ((totalEntries - uniqueEntries) / totalEntries) * 100 : 0,
      topDuplicates,
      byComponent,
      cacheSize: this.deduplicationCache.size,
      avgProcessingTime,
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(
    rateLimitConfig?: Partial<RateLimitConfig>,
    deduplicationConfig?: Partial<DeduplicationConfig>,
  ): void {
    if (rateLimitConfig) {
      this.rateLimitConfig = { ...this.rateLimitConfig, ...rateLimitConfig }
    }

    if (deduplicationConfig) {
      this.deduplicationConfig = { ...this.deduplicationConfig, ...deduplicationConfig }
    }
  }

  /**
   * Reset all statistics and caches
   */
  public reset(): void {
    this.tokenBuckets.clear()
    this.slidingWindows.clear()
    this.rateLimitStats.clear()
    this.deduplicationCache.clear()
    this.deduplicationStats.clear()
  }

  /**
   * Destroy the service
   */
  public destroy(): void {
    if (this.rateLimitCleanupTimer) {
      clearInterval(this.rateLimitCleanupTimer)
      this.rateLimitCleanupTimer = null
    }

    if (this.deduplicationCleanupTimer) {
      clearInterval(this.deduplicationCleanupTimer)
      this.deduplicationCleanupTimer = null
    }

    this.reset()
    RateLimitingService.instance = null
  }
}

/**
 * Create rate limiting service from logger config
 */
export function createRateLimitingServiceFromConfig(
  config: LoggerConfig,
): RateLimitingService | null {
  const rateLimitConfig: RateLimitConfig = {
    enabled: config.rateLimiting.enabled,
    algorithm: 'token_bucket',
    globalLimits: {
      maxLogsPerSecond: config.rateLimiting.maxLogsPerSecond,
      burstLimit: config.rateLimiting.burstLimit,
      windowMs: 1000,
    },
    componentLimits: {},
    severityMultipliers: {
      [ErrorSeverity.LOW]: 1.0,
      [ErrorSeverity.MEDIUM]: 1.5,
      [ErrorSeverity.HIGH]: 2.0,
      [ErrorSeverity.CRITICAL]: 3.0,
    },
    cleanupIntervalMs: 60000,
  }

  const deduplicationConfig: DeduplicationConfig = {
    enabled: config.deduplication.enabled,
    windowMs: config.deduplication.windowMs,
    maxDuplicates: config.deduplication.maxDuplicates,
    fingerprintStrategy: 'context_aware',
    hierarchicalDedup: true,
    cleanupIntervalMs: 120000,
    reportingThreshold: 50,
  }

  return RateLimitingService.getInstance(rateLimitConfig, deduplicationConfig)
}
