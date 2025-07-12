// Comprehensive error handling and fallback service for Microsoft Translator API
// Provides centralized error management, circuit breaker patterns, and fallback strategies

import { TranslationErrorCode, ServiceMetrics } from './types'
import { configService } from './ConfigService'
import { translationApiService, TranslationErrorImpl } from './TranslationApiService'
import { rateLimitService } from './RateLimitService'
import { translationCacheService } from './TranslationCacheService'
import { batchQueueService } from './BatchQueueService'

// ============================================================================
// Error Handling Types
// ============================================================================

export enum ServiceHealth {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  CRITICAL = 'critical',
}

export enum CircuitBreakerState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Failing, requests rejected
  HALF_OPEN = 'half_open', // Testing if service recovered
}

export enum FallbackStrategy {
  RETRY_WITH_BACKOFF = 'retry_with_backoff',
  USE_CACHE_ONLY = 'use_cache_only',
  GRACEFUL_DEGRADATION = 'graceful_degradation',
  FAIL_FAST = 'fail_fast',
}

export interface ErrorRecord {
  timestamp: number
  errorCode: TranslationErrorCode
  message: string
  service: string
  context?: any
}

export interface HealthStatus {
  service: string
  status: ServiceHealth
  lastCheck: number
  responseTime: number
  errorRate: number
  consecutiveFailures: number
  circuitBreakerState: CircuitBreakerState
}

export interface SystemHealth {
  overall: ServiceHealth
  services: Record<string, HealthStatus>
  lastUpdate: number
  activeErrors: ErrorRecord[]
  recommendations: string[]
}

// ============================================================================
// Error Handling Service
// ============================================================================

export class ErrorHandlingService {
  private errorHistory: ErrorRecord[] = []
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map()
  private circuitBreakerMetrics: Map<
    string,
    {
      failures: number
      lastFailure: number
      lastTest: number
    }
  > = new Map()
  private healthStatus: Map<string, HealthStatus> = new Map()
  private healthCheckTimer: number | null = null
  private metrics: ServiceMetrics = this.initializeMetrics()

  // Configuration constants
  private readonly MAX_RETRY_ATTEMPTS = 3
  private readonly BASE_RETRY_DELAY = 1000
  private readonly MAX_RETRY_DELAY = 30000
  private readonly RETRY_MULTIPLIER = 2
  private readonly FAILURE_THRESHOLD = 5
  private readonly RECOVERY_TIMEOUT = 30000
  private readonly HEALTH_CHECK_INTERVAL = 30000
  private readonly ERROR_HISTORY_LIMIT = 1000

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the error handling service
   */
  async initialize(): Promise<void> {
    try {
      this.initializeCircuitBreakers()
      this.initializeHealthMonitoring()
      this.startHealthChecking()
    } catch (error) {
      throw new TranslationErrorImpl(
        'Failed to initialize error handling service',
        TranslationErrorCode.UNKNOWN_ERROR,
        { originalError: error },
      )
    }
  }

  /**
   * Initialize circuit breakers
   */
  private initializeCircuitBreakers(): void {
    const services = ['translation', 'rateLimit', 'cache', 'batch']
    for (const service of services) {
      this.circuitBreakers.set(service, CircuitBreakerState.CLOSED)
      this.circuitBreakerMetrics.set(service, {
        failures: 0,
        lastFailure: 0,
        lastTest: 0,
      })
    }
  }

  /**
   * Initialize health monitoring
   */
  private initializeHealthMonitoring(): void {
    const services = ['translation', 'rateLimit', 'cache', 'batch']
    for (const service of services) {
      this.healthStatus.set(service, {
        service,
        status: ServiceHealth.HEALTHY,
        lastCheck: Date.now(),
        responseTime: 0,
        errorRate: 0,
        consecutiveFailures: 0,
        circuitBreakerState: CircuitBreakerState.CLOSED,
      })
    }
  }

  // --------------------------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------------------------

  /**
   * Handle an error with appropriate fallback strategy
   */
  async handleError(
    error: Error,
    context: {
      service: string
      operation: string
      originalRequest?: any
      retryCount?: number
    },
  ): Promise<{ strategy: FallbackStrategy; recovered: boolean; result?: any }> {
    const translationError = this.normalizeError(error, context.service)

    // Record the error
    this.recordError(translationError, context.service, context)

    // Update circuit breaker
    this.updateCircuitBreaker(context.service, false)

    // Update health status
    await this.updateHealthStatus(context.service)

    // Determine fallback strategy
    const strategy = this.determineFallbackStrategy(translationError, context)

    try {
      // Execute fallback strategy
      const result = await this.executeFallbackStrategy(strategy, translationError, context)
      return { strategy, recovered: true, result }
    } catch (fallbackError) {
      // Fallback failed
      console.error(`Fallback strategy ${strategy} failed:`, fallbackError)
      return { strategy, recovered: false }
    }
  }

  /**
   * Normalize error to TranslationError
   */
  private normalizeError(error: Error, service: string): TranslationErrorImpl {
    if (error instanceof TranslationErrorImpl) {
      return error
    }

    // Map common error patterns
    let errorCode = TranslationErrorCode.UNKNOWN_ERROR

    if (error.message.includes('timeout')) {
      errorCode = TranslationErrorCode.TIMEOUT
    } else if (error.message.includes('network')) {
      errorCode = TranslationErrorCode.NETWORK_ERROR
    } else if (error.message.includes('rate limit')) {
      errorCode = TranslationErrorCode.RATE_LIMIT_EXCEEDED
    } else if (error.message.includes('quota')) {
      errorCode = TranslationErrorCode.QUOTA_EXCEEDED
    }

    return new TranslationErrorImpl(error.message, errorCode, { originalError: error, service })
  }

  /**
   * Record error in history
   */
  private recordError(error: TranslationErrorImpl, service: string, context: any): void {
    const errorRecord: ErrorRecord = {
      timestamp: Date.now(),
      errorCode: error.code,
      message: error.message,
      service,
      context,
    }

    this.errorHistory.unshift(errorRecord)

    // Limit history size
    if (this.errorHistory.length > this.ERROR_HISTORY_LIMIT) {
      this.errorHistory = this.errorHistory.slice(0, this.ERROR_HISTORY_LIMIT)
    }

    // Update metrics
    this.metrics.errorCount++
    this.metrics.lastRequestTime = Date.now()

    console.error(`[${service}] ${error.code}: ${error.message}`, context)
  }

  /**
   * Determine appropriate fallback strategy
   */
  private determineFallbackStrategy(
    error: TranslationErrorImpl,
    context: { service: string; operation: string; retryCount?: number },
  ): FallbackStrategy {
    const retryCount = context.retryCount || 0

    // Check circuit breaker state
    const circuitState = this.circuitBreakers.get(context.service)
    if (circuitState === CircuitBreakerState.OPEN) {
      return FallbackStrategy.USE_CACHE_ONLY
    }

    // Determine strategy based on error type and retry count
    switch (error.code) {
      case TranslationErrorCode.RATE_LIMIT_EXCEEDED:
        return retryCount < this.MAX_RETRY_ATTEMPTS
          ? FallbackStrategy.RETRY_WITH_BACKOFF
          : FallbackStrategy.USE_CACHE_ONLY

      case TranslationErrorCode.QUOTA_EXCEEDED:
        return FallbackStrategy.USE_CACHE_ONLY

      case TranslationErrorCode.NETWORK_ERROR:
      case TranslationErrorCode.TIMEOUT:
      case TranslationErrorCode.SERVICE_UNAVAILABLE:
        return retryCount < this.MAX_RETRY_ATTEMPTS
          ? FallbackStrategy.RETRY_WITH_BACKOFF
          : FallbackStrategy.USE_CACHE_ONLY

      case TranslationErrorCode.UNAUTHORIZED:
      case TranslationErrorCode.FORBIDDEN:
        return FallbackStrategy.USE_CACHE_ONLY

      case TranslationErrorCode.INVALID_REQUEST:
      case TranslationErrorCode.TEXT_TOO_LONG:
        return FallbackStrategy.GRACEFUL_DEGRADATION

      default:
        return retryCount < this.MAX_RETRY_ATTEMPTS
          ? FallbackStrategy.RETRY_WITH_BACKOFF
          : FallbackStrategy.FAIL_FAST
    }
  }

  /**
   * Execute fallback strategy
   */
  private async executeFallbackStrategy(
    strategy: FallbackStrategy,
    error: TranslationErrorImpl,
    context: any,
  ): Promise<any> {
    switch (strategy) {
      case FallbackStrategy.RETRY_WITH_BACKOFF:
        return this.retryWithBackoff(context)

      case FallbackStrategy.USE_CACHE_ONLY:
        return this.useCacheOnly(context.originalRequest)

      case FallbackStrategy.GRACEFUL_DEGRADATION:
        return this.gracefulDegradation(context.originalRequest)

      case FallbackStrategy.FAIL_FAST:
        throw error

      default:
        throw new TranslationErrorImpl(
          `Unknown fallback strategy: ${strategy}`,
          TranslationErrorCode.UNKNOWN_ERROR,
        )
    }
  }

  /**
   * Retry with exponential backoff
   */
  private async retryWithBackoff(context: any): Promise<any> {
    const retryCount = (context.retryCount || 0) + 1
    const delay = Math.min(
      this.BASE_RETRY_DELAY * Math.pow(this.RETRY_MULTIPLIER, retryCount - 1),
      this.MAX_RETRY_DELAY,
    )

    // Wait before retry
    await new Promise((resolve) => setTimeout(resolve, delay))

    // Check circuit breaker state before retry
    const circuitState = this.circuitBreakers.get(context.service)
    if (circuitState === CircuitBreakerState.OPEN) {
      throw new TranslationErrorImpl(
        'Circuit breaker open, retry not allowed',
        TranslationErrorCode.SERVICE_UNAVAILABLE,
      )
    }

    // Update context for retry
    const retryContext = { ...context, retryCount }

    // Retry based on service
    try {
      const request = context.originalRequest
      const result = await translationApiService.translateText(request)

      // Update circuit breaker on success
      this.updateCircuitBreaker(context.service, true)
      this.metrics.successCount++

      return result
    } catch (error) {
      // Propagate error for further handling
      throw this.normalizeError(error as Error, context.service)
    }
  }

  /**
   * Use cache only fallback
   */
  private async useCacheOnly(request: any): Promise<string> {
    if (!request?.text || !request?.toLanguage) {
      throw new TranslationErrorImpl(
        'Invalid request for cache fallback',
        TranslationErrorCode.INVALID_REQUEST,
      )
    }

    const cached = await translationCacheService.get(
      request.text,
      request.fromLanguage || 'auto',
      request.toLanguage,
    )

    if (!cached) {
      throw new TranslationErrorImpl(
        'No cached translation available',
        TranslationErrorCode.CACHE_ERROR,
      )
    }

    return cached
  }

  /**
   * Graceful degradation fallback
   */
  private async gracefulDegradation(request: any): Promise<string> {
    // For text too long, try to split and translate parts
    if (request?.text && request.text.length > 5000) {
      const chunks = this.splitText(request.text, 1000)
      const translations = []

      for (const chunk of chunks) {
        try {
          const translation = await this.useCacheOnly({
            ...request,
            text: chunk,
          })
          translations.push(translation)
        } catch (error) {
          // If chunk translation fails, use original text
          translations.push(chunk)
        }
      }

      return translations.join(' ')
    }

    // For other cases, return original text with indication
    return `[Translation unavailable] ${request?.text || ''}`
  }

  // --------------------------------------------------------------------------
  // Circuit Breaker
  // --------------------------------------------------------------------------

  /**
   * Update circuit breaker state
   */
  private updateCircuitBreaker(service: string, success: boolean): void {
    const metrics = this.circuitBreakerMetrics.get(service)
    const currentState = this.circuitBreakers.get(service)

    if (!metrics || !currentState) {
      return
    }

    const now = Date.now()

    if (success) {
      // Reset failure count on success
      metrics.failures = 0

      // If circuit was open or half-open, close it
      if (currentState !== CircuitBreakerState.CLOSED) {
        this.circuitBreakers.set(service, CircuitBreakerState.CLOSED)
        console.log(`Circuit breaker closed for ${service}`)
      }
    } else {
      // Increment failure count
      metrics.failures++
      metrics.lastFailure = now

      // Check if we should open the circuit
      if (
        currentState === CircuitBreakerState.CLOSED &&
        metrics.failures >= this.FAILURE_THRESHOLD
      ) {
        this.circuitBreakers.set(service, CircuitBreakerState.OPEN)
        console.log(`Circuit breaker opened for ${service}`)
      }
    }

    // Check if circuit should transition from open to half-open
    if (
      currentState === CircuitBreakerState.OPEN &&
      now - metrics.lastFailure > this.RECOVERY_TIMEOUT
    ) {
      this.circuitBreakers.set(service, CircuitBreakerState.HALF_OPEN)
      console.log(`Circuit breaker half-open for ${service}`)
    }

    // Update health status circuit breaker state
    const health = this.healthStatus.get(service)
    if (health) {
      health.circuitBreakerState = this.circuitBreakers.get(service)!
    }
  }

  /**
   * Check if service is available via circuit breaker
   */
  isServiceAvailable(service: string): boolean {
    const state = this.circuitBreakers.get(service)
    return state !== CircuitBreakerState.OPEN
  }

  // --------------------------------------------------------------------------
  // Health Monitoring
  // --------------------------------------------------------------------------

  /**
   * Start health checking
   */
  private startHealthChecking(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
    }

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks()
    }, this.HEALTH_CHECK_INTERVAL) as any

    // Perform initial health check
    this.performHealthChecks()
  }

  /**
   * Perform health checks on all services
   */
  private async performHealthChecks(): Promise<void> {
    const services = ['translation', 'rateLimit', 'cache', 'batch']

    for (const service of services) {
      await this.updateHealthStatus(service)
    }
  }

  /**
   * Update health status for a service
   */
  private async updateHealthStatus(service: string): Promise<void> {
    const health = this.healthStatus.get(service)
    if (!health) return

    const startTime = Date.now()
    let status = ServiceHealth.HEALTHY

    try {
      // Perform health check based on service
      switch (service) {
        case 'translation':
          await this.checkTranslationHealth()
          break
        case 'rateLimit':
          await this.checkRateLimitHealth()
          break
        case 'cache':
          await this.checkCacheHealth()
          break
        case 'batch':
          await this.checkBatchHealth()
          break
      }

      health.consecutiveFailures = 0
    } catch (error) {
      health.consecutiveFailures++

      // Determine health status based on consecutive failures
      if (health.consecutiveFailures >= 5) {
        status = ServiceHealth.CRITICAL
      } else if (health.consecutiveFailures >= 3) {
        status = ServiceHealth.UNHEALTHY
      } else {
        status = ServiceHealth.DEGRADED
      }
    }

    // Calculate error rate (last 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
    const recentErrors = this.errorHistory.filter(
      (e) => e.service === service && e.timestamp > fiveMinutesAgo,
    )

    const errorRate = recentErrors.length / 300 // errors per second over 5 minutes

    // Update health status
    health.status = status
    health.lastCheck = Date.now()
    health.responseTime = Date.now() - startTime
    health.errorRate = errorRate
    health.circuitBreakerState = this.circuitBreakers.get(service)!
  }

  /**
   * Check translation service health
   */
  private async checkTranslationHealth(): Promise<void> {
    const config = await configService.getConfig()
    if (!config.apiKey) {
      throw new Error('Translation service not configured')
    }
  }

  /**
   * Check rate limit service health
   */
  private async checkRateLimitHealth(): Promise<void> {
    const status = await rateLimitService.checkRateLimit(0)
    if (!status.allowed && status.quotaExceeded) {
      throw new Error('Rate limit quota exceeded')
    }
  }

  /**
   * Check cache service health
   */
  private async checkCacheHealth(): Promise<void> {
    await translationCacheService.getStats()
    // Cache is healthy if it's responding
  }

  /**
   * Check batch service health
   */
  private async checkBatchHealth(): Promise<void> {
    const metrics = await batchQueueService.getQueueMetrics()
    // Check if queue is not backing up excessively
    if (metrics.pendingRequests > 1000) {
      throw new Error('Batch queue backed up')
    }
  }

  /**
   * Get system health status
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const services = Object.fromEntries(this.healthStatus.entries())

    // Determine overall health
    const healthValues = Object.values(services).map((s) => s.status)
    let overall = ServiceHealth.HEALTHY

    if (healthValues.some((h) => h === ServiceHealth.CRITICAL)) {
      overall = ServiceHealth.CRITICAL
    } else if (healthValues.some((h) => h === ServiceHealth.UNHEALTHY)) {
      overall = ServiceHealth.UNHEALTHY
    } else if (healthValues.some((h) => h === ServiceHealth.DEGRADED)) {
      overall = ServiceHealth.DEGRADED
    }

    // Get active errors (last 10 minutes)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000
    const activeErrors = this.errorHistory.filter((e) => e.timestamp > tenMinutesAgo).slice(0, 50) // Limit to recent 50 errors

    // Generate recommendations
    const recommendations = this.generateRecommendations(services, activeErrors)

    return {
      overall,
      services,
      lastUpdate: Date.now(),
      activeErrors,
      recommendations,
    }
  }

  /**
   * Generate health recommendations
   */
  private generateRecommendations(
    services: Record<string, HealthStatus>,
    activeErrors: ErrorRecord[],
  ): string[] {
    const recommendations: string[] = []

    // Check for circuit breaker issues
    Object.values(services).forEach((service) => {
      if (service.circuitBreakerState === CircuitBreakerState.OPEN) {
        recommendations.push(
          `Circuit breaker is open for ${service.service}. Wait for automatic recovery or investigate the underlying issue.`,
        )
      }
    })

    // Check for high error rates
    Object.values(services).forEach((service) => {
      if (service.errorRate > 0.1) {
        // More than 0.1 errors per second
        recommendations.push(
          `High error rate detected for ${service.service}. Check service configuration and logs.`,
        )
      }
    })

    // Check for quota issues
    const quotaErrors = activeErrors.filter(
      (e) => e.errorCode === TranslationErrorCode.QUOTA_EXCEEDED,
    )
    if (quotaErrors.length > 0) {
      recommendations.push(
        'Translation quota exceeded. Consider upgrading your plan or optimizing translation usage.',
      )
    }

    // Check for rate limiting
    const rateLimitErrors = activeErrors.filter(
      (e) => e.errorCode === TranslationErrorCode.RATE_LIMIT_EXCEEDED,
    )
    if (rateLimitErrors.length > 5) {
      recommendations.push(
        'Frequent rate limiting detected. Consider implementing request throttling or upgrading your plan.',
      )
    }

    return recommendations
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Split text into chunks
   */
  private splitText(text: string, maxLength: number): string[] {
    const chunks: string[] = []
    const sentences = text.split(/[.!?]+/)
    let currentChunk = ''

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length <= maxLength) {
        currentChunk += sentence + '.'
      } else {
        if (currentChunk) {
          chunks.push(currentChunk.trim())
        }
        currentChunk = sentence + '.'
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim())
    }

    return chunks
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): ServiceMetrics {
    return {
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      totalCharacters: 0,
      averageResponseTime: 0,
      cacheHitRate: 0,
      lastRequestTime: 0,
      uptime: Date.now(),
    }
  }

  /**
   * Get service metrics
   */
  getMetrics(): ServiceMetrics {
    return { ...this.metrics }
  }

  /**
   * Get error history
   */
  getErrorHistory(limit?: number): ErrorRecord[] {
    return this.errorHistory.slice(0, limit || 100)
  }

  /**
   * Clear error history
   */
  clearErrorHistory(): void {
    this.errorHistory = []
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

// Export a singleton instance for use throughout the application
export const errorHandlingService = new ErrorHandlingService()
