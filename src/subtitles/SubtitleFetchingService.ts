/**
 * LinguaTube Main Subtitle Fetching Service
 * Orchestrates all subtitle components with comprehensive error handling and recovery
 */

import {
  SubtitleFetchRequest,
  SubtitleFetchResult,
  SubtitleFile,
  SubtitleFormat,
  SubtitleErrorCode,
  SubtitleFetchError,
  ParseResult,
  ParserConfig,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_PARSER_CONFIG,
} from './types'

import { SubtitleFetchUtility, createFetchUtility } from './FetchUtility'
import { MultiFormatSubtitleParser } from './MultiFormatParser'
import { SubtitleCacheService, createSubtitleCache } from './CacheService'
import { RetryService, createRetryService } from './RetryService'
import { SegmentMerger, createSegmentMerger } from './SegmentMerger'
import { CorsHandler, createExtensionCorsHandler } from './CorsHandler'

/**
 * Service configuration
 */
export interface SubtitleServiceConfig {
  enableCache: boolean
  enableRetry: boolean
  enableMerging: boolean
  enableCors: boolean
  retryConfig: RetryConfig
  defaultTimeout: number
  maxFileSize: number
  enableMetrics: boolean
  logLevel: 'none' | 'error' | 'warn' | 'info' | 'debug'
}

/**
 * Service metrics and monitoring
 */
export interface ServiceMetrics {
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  cacheHits: number
  cacheMisses: number
  averageResponseTime: number
  errorBreakdown: Record<SubtitleErrorCode, number>
  formatBreakdown: Record<SubtitleFormat, number>
  corsStrategyUsage: Record<string, number>
}

/**
 * Default service configuration
 */
export const DEFAULT_SERVICE_CONFIG: SubtitleServiceConfig = {
  enableCache: true,
  enableRetry: true,
  enableMerging: true,
  enableCors: true,
  retryConfig: DEFAULT_RETRY_CONFIG,
  defaultTimeout: 30000,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  enableMetrics: true,
  logLevel: 'info',
}

/**
 * Main subtitle fetching service
 */
export class SubtitleFetchingService {
  private readonly config: SubtitleServiceConfig
  private readonly fetchUtility: SubtitleFetchUtility
  private readonly cacheService: SubtitleCacheService
  private readonly retryService: RetryService
  private readonly segmentMerger: SegmentMerger
  private readonly corsHandler: CorsHandler

  private readonly metrics: ServiceMetrics
  private readonly requestTimes: number[] = []

  constructor(config: Partial<SubtitleServiceConfig> = {}) {
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config }

    // Initialize components
    this.fetchUtility = createFetchUtility()
    this.cacheService = createSubtitleCache()
    this.retryService = createRetryService(this.config.retryConfig)
    this.segmentMerger = createSegmentMerger()
    this.corsHandler = createExtensionCorsHandler()

    // Initialize metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageResponseTime: 0,
      errorBreakdown: {} as Record<SubtitleErrorCode, number>,
      formatBreakdown: {} as Record<SubtitleFormat, number>,
      corsStrategyUsage: {} as Record<string, number>,
    }

    this.log('info', 'SubtitleFetchingService initialized')
  }

  // ========================================
  // Main Public API
  // ========================================

  /**
   * Fetch subtitles with comprehensive error handling
   */
  async fetchSubtitles(request: SubtitleFetchRequest): Promise<SubtitleFetchResult> {
    const startTime = Date.now()
    const requestId = this.generateRequestId()

    this.log('info', `[${requestId}] Fetching subtitles: ${request.url}`)
    this.metrics.totalRequests++

    try {
      // Validate request
      const validationError = this.validateRequest(request)
      if (validationError) {
        return this.createErrorResult(validationError, startTime)
      }

      // Check cache first
      if (this.config.enableCache && request.useCache !== false) {
        const cachedResult = await this.tryGetFromCache(request, requestId)
        if (cachedResult) {
          return this.finalizeTiming(cachedResult, startTime)
        }
      }

      // Fetch with retry and recovery
      const result = await this.fetchWithRetryAndRecovery(request, requestId)

      // Cache successful results
      if (result.success && this.config.enableCache && result.subtitleFile) {
        await this.tryCacheResult(request, result.subtitleFile, requestId)
      }

      return this.finalizeTiming(result, startTime)
    } catch (error) {
      this.log('error', `[${requestId}] Unexpected error:`, error)

      const fetchError: SubtitleFetchError = {
        code: SubtitleErrorCode.UNKNOWN_ERROR,
        message: 'Unexpected service error',
        originalError: error,
        retryable: false,
      }

      return this.createErrorResult(fetchError, startTime)
    }
  }

  /**
   * Get service metrics
   */
  getMetrics(): ServiceMetrics {
    const avgTime =
      this.requestTimes.length > 0
        ? this.requestTimes.reduce((sum, time) => sum + time, 0) / this.requestTimes.length
        : 0

    return {
      ...this.metrics,
      averageResponseTime: Math.round(avgTime),
    }
  }

  /**
   * Clear all caches and reset metrics
   */
  async reset(): Promise<void> {
    this.log('info', 'Resetting subtitle service')

    if (this.config.enableCache) {
      await this.cacheService.clear()
    }

    // Reset metrics
    this.metrics.totalRequests = 0
    this.metrics.successfulRequests = 0
    this.metrics.failedRequests = 0
    this.metrics.cacheHits = 0
    this.metrics.cacheMisses = 0
    this.metrics.averageResponseTime = 0
    this.metrics.errorBreakdown = {} as Record<SubtitleErrorCode, number>
    this.metrics.formatBreakdown = {} as Record<SubtitleFormat, number>
    this.metrics.corsStrategyUsage = {} as Record<string, number>
    this.requestTimes.length = 0

    this.log('info', 'Service reset complete')
  }

  // ========================================
  // Core Fetching Logic
  // ========================================

  /**
   * Fetch with retry and recovery
   */
  private async fetchWithRetryAndRecovery(
    request: SubtitleFetchRequest,
    requestId: string,
  ): Promise<SubtitleFetchResult> {
    let lastError: SubtitleFetchError | null = null

    const maxAttempts = this.config.enableRetry ? this.config.retryConfig.maxAttempts : 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.log('debug', `[${requestId}] Attempt ${attempt}`)

        const result = await this.performFetch(request, requestId)

        if (result.success) {
          this.metrics.successfulRequests++
          if (result.subtitleFile) {
            this.updateFormatMetrics(result.subtitleFile.format)
          }
          return result
        }

        lastError = result.error!
        this.updateErrorMetrics(lastError)

        // Check if we should retry
        if (!this.config.enableRetry || !lastError.retryable || attempt >= maxAttempts) {
          break
        }

        // Wait before retry
        const delay = this.calculateRetryDelay(attempt)
        this.log('debug', `[${requestId}] Waiting ${delay}ms before retry`)
        await this.sleep(delay)
      } catch (error) {
        lastError = {
          code: SubtitleErrorCode.UNKNOWN_ERROR,
          message: 'Fetch operation failed',
          originalError: error,
          retryable: true,
        }
      }
    }

    this.metrics.failedRequests++
    this.log('error', `[${requestId}] All attempts failed. Last error:`, lastError)

    return {
      success: false,
      error: lastError || {
        code: SubtitleErrorCode.UNKNOWN_ERROR,
        message: 'All fetch attempts failed',
        retryable: false,
      },
      fromCache: false,
      fetchTime: 0,
      responseSize: 0,
    }
  }

  /**
   * Perform the actual fetch operation
   */
  private async performFetch(
    request: SubtitleFetchRequest,
    requestId: string,
  ): Promise<SubtitleFetchResult> {
    const startTime = Date.now()

    try {
      // Fetch content
      let content: string
      let responseSize = 0

      if (this.config.enableCors) {
        this.log('debug', `[${requestId}] Using CORS handler`)

        const corsResult = await this.corsHandler.fetchWithCorsHandling(request.url, {
          timeout: request.timeout || this.config.defaultTimeout,
          headers: request.headers,
        })

        if (!corsResult.success) {
          return {
            success: false,
            error: corsResult.error!,
            fromCache: false,
            fetchTime: Date.now() - startTime,
            responseSize: 0,
          }
        }

        content = corsResult.data!
        responseSize = content.length

        // Update CORS strategy metrics
        if (this.config.enableMetrics) {
          const strategy = corsResult.strategy
          this.metrics.corsStrategyUsage[strategy] =
            (this.metrics.corsStrategyUsage[strategy] || 0) + 1
        }
      } else {
        this.log('debug', `[${requestId}] Using direct fetch`)

        const fetchResult = await this.fetchUtility.fetchContent({
          url: request.url,
          timeout: request.timeout || this.config.defaultTimeout,
          headers: request.headers,
        })

        content = fetchResult.content
        responseSize = fetchResult.contentLength
      }

      this.log('debug', `[${requestId}] Fetched ${responseSize} bytes`)

      // Check file size
      if (responseSize > this.config.maxFileSize) {
        return {
          success: false,
          error: {
            code: SubtitleErrorCode.VALIDATION_ERROR,
            message: `File size ${responseSize} exceeds maximum ${this.config.maxFileSize}`,
            retryable: false,
          },
          fromCache: false,
          fetchTime: Date.now() - startTime,
          responseSize,
        }
      }

      // Parse content
      const parseResult = await this.parseContent(content, request, requestId)
      if (!parseResult.success) {
        return {
          success: false,
          error: parseResult.error!,
          fromCache: false,
          fetchTime: Date.now() - startTime,
          responseSize,
        }
      }

      return {
        success: true,
        subtitleFile: parseResult.subtitleFile!,
        fromCache: false,
        fetchTime: Date.now() - startTime,
        responseSize,
      }
    } catch (error) {
      this.log('error', `[${requestId}] Fetch failed:`, error)

      return {
        success: false,
        error: {
          code: SubtitleErrorCode.NETWORK_ERROR,
          message: error instanceof Error ? error.message : 'Network error',
          originalError: error,
          retryable: true,
        },
        fromCache: false,
        fetchTime: Date.now() - startTime,
        responseSize: 0,
      }
    }
  }

  /**
   * Parse fetched content
   */
  private async parseContent(
    content: string,
    request: SubtitleFetchRequest,
    requestId: string,
  ): Promise<SubtitleFetchResult> {
    try {
      this.log('debug', `[${requestId}] Parsing content`)

      // Parse content with automatic format detection
      const parseConfig: ParserConfig = {
        format: request.format || SubtitleFormat.PLAIN_TEXT, // Parser will auto-detect
        strict: false,
        mergeSegments: this.config.enableMerging,
        preserveFormatting: true,
        encoding: 'utf-8',
        maxSegmentGap: 2.0,
      }

      const parseResult = MultiFormatSubtitleParser.parse(content, parseConfig)

      if (!parseResult.success || !parseResult.segments) {
        return {
          success: false,
          error: {
            code: SubtitleErrorCode.PARSE_ERROR,
            message: parseResult.errors?.[0]?.message || 'Failed to parse subtitle content',
            retryable: false,
          },
          fromCache: false,
          fetchTime: 0,
          responseSize: content.length,
        }
      }

      // Get detected format
      const detectedFormat = parseResult.metadata?.detectedFormat || SubtitleFormat.PLAIN_TEXT
      this.log('debug', `[${requestId}] Parsed with format: ${detectedFormat}`)

      // Apply segment merging if enabled
      let segments = parseResult.segments
      if (this.config.enableMerging && segments.length > 1) {
        this.log('debug', `[${requestId}] Merging ${segments.length} segments`)

        const mergeResult = await this.segmentMerger.mergeSegments(segments)
        if (mergeResult.success) {
          segments = mergeResult.segments
          this.log('debug', `[${requestId}] Merged to ${segments.length} segments`)
        }
      }

      // Create subtitle file
      const subtitleFile: SubtitleFile = {
        id: this.generateFileId(request.url),
        segments,
        metadata: {
          ...parseResult.metadata,
          language: request.language || parseResult.metadata?.language || 'unknown',
          languageCode: this.extractLanguageCode(
            request.language || parseResult.metadata?.language || 'unknown',
          ),
          segmentCount: segments.length,
          source: {
            type: 'youtube',
            url: request.url,
            isAutoGenerated: this.isAutoGenerated(request.url),
            fetchedAt: Date.now(),
          },
        },
        format: detectedFormat,
        cacheInfo: request.cacheKey
          ? {
              cacheKey: request.cacheKey,
              cachedAt: Date.now(),
              expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
              size: content.length,
            }
          : undefined,
      }

      this.log('info', `[${requestId}] Successfully parsed ${segments.length} segments`)

      return {
        success: true,
        subtitleFile,
        fromCache: false,
        fetchTime: 0,
        responseSize: content.length,
      }
    } catch (error) {
      this.log('error', `[${requestId}] Parse failed:`, error)

      return {
        success: false,
        error: {
          code: SubtitleErrorCode.PARSE_ERROR,
          message: error instanceof Error ? error.message : 'Parse error',
          originalError: error,
          retryable: false,
        },
        fromCache: false,
        fetchTime: 0,
        responseSize: content.length,
      }
    }
  }

  // ========================================
  // Cache Operations
  // ========================================

  /**
   * Try to get result from cache
   */
  private async tryGetFromCache(
    request: SubtitleFetchRequest,
    requestId: string,
  ): Promise<SubtitleFetchResult | null> {
    try {
      const cacheKey = request.cacheKey || this.generateCacheKey(request.url)
      this.log('debug', `[${requestId}] Checking cache: ${cacheKey}`)

      const cached = await this.cacheService.get(cacheKey)

      if (cached) {
        this.log('info', `[${requestId}] Cache hit`)
        this.metrics.cacheHits++

        return {
          success: true,
          subtitleFile: cached.data,
          fromCache: true,
          fetchTime: 0,
          responseSize: cached.metadata.size,
        }
      }

      this.log('debug', `[${requestId}] Cache miss`)
      this.metrics.cacheMisses++
      return null
    } catch (error) {
      this.log('warn', `[${requestId}] Cache check failed:`, error)
      return null
    }
  }

  /**
   * Try to cache successful result
   */
  private async tryCacheResult(
    request: SubtitleFetchRequest,
    subtitleFile: SubtitleFile,
    requestId: string,
  ): Promise<void> {
    try {
      const cacheKey = request.cacheKey || this.generateCacheKey(request.url)
      this.log('debug', `[${requestId}] Caching result: ${cacheKey}`)

      await this.cacheService.set(cacheKey, subtitleFile)
      this.log('debug', `[${requestId}] Cached successfully`)
    } catch (error) {
      this.log('warn', `[${requestId}] Cache storage failed:`, error)
    }
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Validate request
   */
  private validateRequest(request: SubtitleFetchRequest): SubtitleFetchError | null {
    if (!request.url) {
      return {
        code: SubtitleErrorCode.INVALID_URL,
        message: 'URL is required',
        retryable: false,
      }
    }

    try {
      new URL(request.url)
    } catch {
      return {
        code: SubtitleErrorCode.INVALID_URL,
        message: 'Invalid URL format',
        retryable: false,
      }
    }

    if (request.timeout && request.timeout < 1000) {
      return {
        code: SubtitleErrorCode.CONFIG_ERROR,
        message: 'Timeout must be at least 1000ms',
        retryable: false,
      }
    }

    return null
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Generate file ID
   */
  private generateFileId(url: string): string {
    const hash = this.simpleHash(url)
    return `subtitle_${hash}_${Date.now()}`
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(url: string): string {
    return `subtitle_${this.simpleHash(url)}`
  }

  /**
   * Simple hash function
   */
  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Extract language code
   */
  private extractLanguageCode(language: string): string {
    // Simple language code extraction
    const match = language.match(/^([a-z]{2})/i)
    return match ? match[1].toLowerCase() : 'en'
  }

  /**
   * Check if subtitles are auto-generated
   */
  private isAutoGenerated(url: string): boolean {
    return url.includes('kind=asr') || url.includes('auto')
  }

  /**
   * Calculate retry delay
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = this.config.retryConfig.baseDelay
    const maxDelay = this.config.retryConfig.maxDelay

    if (this.config.retryConfig.exponentialBackoff) {
      return Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
    } else {
      return Math.min(baseDelay * attempt, maxDelay)
    }
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Create error result
   */
  private createErrorResult(error: SubtitleFetchError, startTime: number): SubtitleFetchResult {
    this.metrics.failedRequests++
    this.updateErrorMetrics(error)

    return {
      success: false,
      error,
      fromCache: false,
      fetchTime: Date.now() - startTime,
      responseSize: 0,
    }
  }

  /**
   * Finalize timing for result
   */
  private finalizeTiming(result: SubtitleFetchResult, startTime: number): SubtitleFetchResult {
    const totalTime = Date.now() - startTime

    if (this.config.enableMetrics) {
      this.requestTimes.push(totalTime)

      // Keep only last 100 request times for average calculation
      if (this.requestTimes.length > 100) {
        this.requestTimes.shift()
      }
    }

    return {
      ...result,
      fetchTime: totalTime,
    }
  }

  /**
   * Update error metrics
   */
  private updateErrorMetrics(error: SubtitleFetchError): void {
    if (this.config.enableMetrics) {
      this.metrics.errorBreakdown[error.code] = (this.metrics.errorBreakdown[error.code] || 0) + 1
    }
  }

  /**
   * Update format metrics
   */
  private updateFormatMetrics(format: SubtitleFormat): void {
    if (this.config.enableMetrics) {
      this.metrics.formatBreakdown[format] = (this.metrics.formatBreakdown[format] || 0) + 1
    }
  }

  /**
   * Logging utility
   */
  private log(level: 'error' | 'warn' | 'info' | 'debug', message: string, ...args: any[]): void {
    if (this.shouldLog(level)) {
      const timestamp = new Date().toISOString()
      console[level](`[${timestamp}] [SubtitleService] ${message}`, ...args)
    }
  }

  /**
   * Check if should log for level
   */
  private shouldLog(level: 'error' | 'warn' | 'info' | 'debug'): boolean {
    const levels = ['none', 'error', 'warn', 'info', 'debug']
    const currentLevel = levels.indexOf(this.config.logLevel)
    const messageLevel = levels.indexOf(level)

    return messageLevel <= currentLevel
  }
}

// ========================================
// Factory Functions and Utilities
// ========================================

/**
 * Create subtitle fetching service with default configuration
 */
export function createSubtitleFetchingService(
  config?: Partial<SubtitleServiceConfig>,
): SubtitleFetchingService {
  return new SubtitleFetchingService(config)
}

/**
 * Create service optimized for production
 */
export function createProductionService(): SubtitleFetchingService {
  return new SubtitleFetchingService({
    enableCache: true,
    enableRetry: true,
    enableMerging: true,
    enableCors: true,
    enableMetrics: true,
    logLevel: 'warn',
    defaultTimeout: 15000,
    maxFileSize: 5 * 1024 * 1024, // 5MB
  })
}

/**
 * Create service optimized for development
 */
export function createDevelopmentService(): SubtitleFetchingService {
  return new SubtitleFetchingService({
    enableCache: false,
    enableRetry: true,
    enableMerging: true,
    enableCors: true,
    enableMetrics: true,
    logLevel: 'debug',
    defaultTimeout: 30000,
    maxFileSize: 10 * 1024 * 1024, // 10MB
  })
}

/**
 * Quick fetch function for simple use cases
 */
export async function fetchSubtitles(
  url: string,
  options?: Partial<SubtitleFetchRequest>,
): Promise<SubtitleFile> {
  const service = createSubtitleFetchingService()
  const result = await service.fetchSubtitles({ url, ...options })

  if (result.success && result.subtitleFile) {
    return result.subtitleFile
  }

  throw result.error || new Error('Subtitle fetch failed')
}

/**
 * Default service instance
 */
export const subtitleService = createProductionService()
