// ========================================
// Error Recovery Service for Automatic Error Recovery
// ========================================

import {
  LogLevel,
  LogEntry,
  ComponentType,
  ErrorType,
  ErrorSeverity,
  LoggerConfig,
  isProduction,
} from './types'

/**
 * Recovery strategy types
 */
export enum RecoveryStrategyType {
  RETRY = 'retry',                    // Simple retry with backoff
  STATE_RESET = 'state_reset',        // Reset component state
  SERVICE_RESTART = 'service_restart', // Restart service/component
  PERMISSION_REQUEST = 'permission_request', // Request missing permissions
  CACHE_CLEAR = 'cache_clear',        // Clear cache and retry
  STORAGE_REPAIR = 'storage_repair',  // Repair storage issues
  NETWORK_RETRY = 'network_retry',    // Network-specific retry logic
  API_FALLBACK = 'api_fallback',      // Switch to fallback API
  RESOURCE_CLEANUP = 'resource_cleanup', // Clean up resources and retry
  CONFIGURATION_RESET = 'configuration_reset', // Reset configuration to defaults
}

/**
 * Recovery result status
 */
export enum RecoveryResult {
  SUCCESS = 'success',                // Recovery succeeded
  PARTIAL_SUCCESS = 'partial_success', // Partial recovery achieved
  FAILED = 'failed',                  // Recovery failed
  NOT_APPLICABLE = 'not_applicable',   // Recovery strategy not applicable
  REQUIRES_USER_ACTION = 'requires_user_action', // User intervention needed
}

/**
 * Recovery attempt information
 */
export interface RecoveryAttempt {
  readonly id: string
  readonly timestamp: number
  readonly component: ComponentType
  readonly errorType: ErrorType
  readonly strategy: RecoveryStrategyType
  readonly result: RecoveryResult
  readonly duration: number
  readonly error?: Error
  readonly details?: Record<string, any>
  readonly nextAttemptTime?: number
}

/**
 * Recovery strategy configuration
 */
export interface RecoveryStrategy {
  readonly type: RecoveryStrategyType
  readonly component: ComponentType
  readonly errorTypes: ErrorType[]
  readonly maxAttempts: number
  readonly initialDelay: number
  readonly maxDelay: number
  readonly backoffMultiplier: number
  readonly timeoutMs: number
  readonly prerequisites?: (() => Promise<boolean>)[]
  readonly implementation: (error: Error, attempt: number, context: RecoveryContext) => Promise<RecoveryResult>
  readonly onSuccess?: (context: RecoveryContext) => Promise<void>
  readonly onFailure?: (context: RecoveryContext, finalError: Error) => Promise<void>
}

/**
 * Recovery context information
 */
export interface RecoveryContext {
  readonly originalError: Error
  readonly component: ComponentType
  readonly errorType: ErrorType
  readonly severity: ErrorSeverity
  readonly attempt: number
  readonly maxAttempts: number
  readonly startTime: number
  readonly metadata?: Record<string, any>
}

/**
 * Recovery statistics
 */
export interface RecoveryStats {
  readonly totalAttempts: number
  readonly successfulRecoveries: number
  readonly failedRecoveries: number
  readonly partialRecoveries: number
  readonly successRate: number
  readonly averageRecoveryTime: number
  readonly strategiesUsed: Record<RecoveryStrategyType, number>
  readonly componentStats: Record<ComponentType, {
    attempts: number
    successes: number
    failures: number
    averageTime: number
  }>
  readonly errorTypeStats: Record<ErrorType, {
    attempts: number
    successes: number
    failures: number
  }>
  readonly recentAttempts: RecoveryAttempt[]
}

/**
 * Internal mutable recovery statistics
 */
interface MutableRecoveryStats {
  totalAttempts: number
  successfulRecoveries: number
  failedRecoveries: number
  partialRecoveries: number
  successRate: number
  averageRecoveryTime: number
  strategiesUsed: Record<RecoveryStrategyType, number>
  componentStats: Record<ComponentType, {
    attempts: number
    successes: number
    failures: number
    averageTime: number
  }>
  errorTypeStats: Record<ErrorType, {
    attempts: number
    successes: number
    failures: number
  }>
  recentAttempts: RecoveryAttempt[]
}

/**
 * Recovery configuration
 */
export interface RecoveryConfig {
  readonly enabled: boolean
  readonly globalTimeout: number
  readonly maxConcurrentRecoveries: number
  readonly cleanupInterval: number
  readonly historyRetention: number
  readonly enablePreemptiveRecovery: boolean
  readonly enableStatisticsTracking: boolean
  readonly logLevel: LogLevel
}

/**
 * Error Recovery Service
 */
export class ErrorRecoveryService {
  private static instance: ErrorRecoveryService | null = null
  private readonly config: RecoveryConfig
  private readonly strategies: Map<string, RecoveryStrategy> = new Map()
  private readonly activeRecoveries: Map<string, Promise<RecoveryResult>> = new Map()
  private readonly recoveryHistory: RecoveryAttempt[] = []
  private readonly componentStates: Map<ComponentType, any> = new Map()
  
  // Cleanup and maintenance
  private cleanupTimer: number | null = null
  private statsTimer: number | null = null
  
  // Statistics tracking
  private stats: MutableRecoveryStats = this.initializeStats()

  private constructor(config: Partial<RecoveryConfig> = {}) {
    this.config = {
      enabled: true,
      globalTimeout: 30000, // 30 seconds
      maxConcurrentRecoveries: 5,
      cleanupInterval: 300000, // 5 minutes
      historyRetention: 1000, // Keep last 1000 attempts
      enablePreemptiveRecovery: true,
      enableStatisticsTracking: true,
      logLevel: isProduction() ? LogLevel.WARN : LogLevel.DEBUG,
      ...config,
    }

    this.initializeStrategies()
    this.startMaintenanceTasks()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<RecoveryConfig>): ErrorRecoveryService {
    if (!ErrorRecoveryService.instance) {
      ErrorRecoveryService.instance = new ErrorRecoveryService(config)
    }
    return ErrorRecoveryService.instance
  }

  /**
   * Initialize default recovery strategies
   */
  private initializeStrategies(): void {
    // Network error recovery
    this.registerStrategy({
      type: RecoveryStrategyType.NETWORK_RETRY,
      component: ComponentType.TRANSLATION_SERVICE,
      errorTypes: [ErrorType.NETWORK, ErrorType.API],
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
      timeoutMs: 15000,
      implementation: async (error, attempt, context) => {
        return this.performNetworkRetry(error, attempt, context)
      },
    })

    // Storage error recovery
    this.registerStrategy({
      type: RecoveryStrategyType.STORAGE_REPAIR,
      component: ComponentType.STORAGE_SERVICE,
      errorTypes: [ErrorType.STORAGE],
      maxAttempts: 2,
      initialDelay: 500,
      maxDelay: 2000,
      backoffMultiplier: 2,
      timeoutMs: 5000,
      implementation: async (error, attempt, context) => {
        return this.performStorageRepair(error, attempt, context)
      },
    })

    // Permission error recovery
    this.registerStrategy({
      type: RecoveryStrategyType.PERMISSION_REQUEST,
      component: ComponentType.TTS_SERVICE,
      errorTypes: [ErrorType.PERMISSION],
      maxAttempts: 1,
      initialDelay: 0,
      maxDelay: 0,
      backoffMultiplier: 1,
      timeoutMs: 10000,
      implementation: async (error, attempt, context) => {
        return this.performPermissionRequest(error, attempt, context)
      },
    })

    // Cache clear recovery
    this.registerStrategy({
      type: RecoveryStrategyType.CACHE_CLEAR,
      component: ComponentType.TRANSLATION_SERVICE,
      errorTypes: [ErrorType.STORAGE, ErrorType.VALIDATION],
      maxAttempts: 1,
      initialDelay: 100,
      maxDelay: 100,
      backoffMultiplier: 1,
      timeoutMs: 5000,
      implementation: async (error, attempt, context) => {
        return this.performCacheClear(error, attempt, context)
      },
    })

    // State reset recovery
    this.registerStrategy({
      type: RecoveryStrategyType.STATE_RESET,
      component: ComponentType.YOUTUBE_INTEGRATION,
      errorTypes: [ErrorType.UI, ErrorType.PERFORMANCE],
      maxAttempts: 2,
      initialDelay: 1000,
      maxDelay: 5000,
      backoffMultiplier: 2,
      timeoutMs: 8000,
      implementation: async (error, attempt, context) => {
        return this.performStateReset(error, attempt, context)
      },
    })

    // Service restart recovery
    this.registerStrategy({
      type: RecoveryStrategyType.SERVICE_RESTART,
      component: ComponentType.SUBTITLE_MANAGER,
      errorTypes: [ErrorType.PERFORMANCE, ErrorType.UNKNOWN],
      maxAttempts: 1,
      initialDelay: 2000,
      maxDelay: 2000,
      backoffMultiplier: 1,
      timeoutMs: 10000,
      implementation: async (error, attempt, context) => {
        return this.performServiceRestart(error, attempt, context)
      },
    })

    // Configuration reset recovery
    this.registerStrategy({
      type: RecoveryStrategyType.CONFIGURATION_RESET,
      component: ComponentType.ERROR_HANDLER,
      errorTypes: [ErrorType.VALIDATION, ErrorType.UNKNOWN],
      maxAttempts: 1,
      initialDelay: 500,
      maxDelay: 500,
      backoffMultiplier: 1,
      timeoutMs: 3000,
      implementation: async (error, attempt, context) => {
        return this.performConfigurationReset(error, attempt, context)
      },
    })

    // Resource cleanup recovery
    this.registerStrategy({
      type: RecoveryStrategyType.RESOURCE_CLEANUP,
      component: ComponentType.BACKGROUND,
      errorTypes: [ErrorType.PERFORMANCE],
      maxAttempts: 1,
      initialDelay: 1000,
      maxDelay: 1000,
      backoffMultiplier: 1,
      timeoutMs: 5000,
      implementation: async (error, attempt, context) => {
        return this.performResourceCleanup(error, attempt, context)
      },
    })
  }

  /**
   * Register a new recovery strategy
   */
  public registerStrategy(strategy: RecoveryStrategy): void {
    const key = this.getStrategyKey(strategy.component, strategy.type)
    this.strategies.set(key, strategy)
    this.log(LogLevel.DEBUG, `Registered recovery strategy: ${strategy.type} for ${strategy.component}`)
  }

  /**
   * Attempt to recover from an error
   */
  public async attemptRecovery(
    error: Error, 
    component: ComponentType, 
    errorType: ErrorType, 
    severity: ErrorSeverity,
    metadata?: Record<string, any>
  ): Promise<RecoveryResult> {
    if (!this.config.enabled) {
      return RecoveryResult.NOT_APPLICABLE
    }

    // Check if already recovering for this component
    const recoveryKey = `${component}-${errorType}-${Date.now()}`
    if (this.activeRecoveries.size >= this.config.maxConcurrentRecoveries) {
      this.log(LogLevel.WARN, `Recovery limit reached, skipping recovery for ${component}`)
      return RecoveryResult.FAILED
    }

    // Find applicable recovery strategies
    const applicableStrategies = this.findApplicableStrategies(component, errorType)
    if (applicableStrategies.length === 0) {
      this.log(LogLevel.DEBUG, `No recovery strategies found for ${component}:${errorType}`)
      return RecoveryResult.NOT_APPLICABLE
    }

    // Try each strategy in order of priority
    for (const strategy of applicableStrategies) {
      try {
        const result = await this.executeStrategy(strategy, error, component, errorType, severity, metadata)
        
        if (result === RecoveryResult.SUCCESS || result === RecoveryResult.PARTIAL_SUCCESS) {
          this.log(LogLevel.INFO, `Recovery successful using ${strategy.type} for ${component}`)
          return result
        }
      } catch (recoveryError) {
        this.log(LogLevel.ERROR, `Recovery strategy ${strategy.type} failed:`, recoveryError)
      }
    }

    this.log(LogLevel.WARN, `All recovery strategies failed for ${component}:${errorType}`)
    return RecoveryResult.FAILED
  }

  /**
   * Execute a specific recovery strategy
   */
  private async executeStrategy(
    strategy: RecoveryStrategy,
    error: Error,
    component: ComponentType,
    errorType: ErrorType,
    severity: ErrorSeverity,
    metadata?: Record<string, any>
  ): Promise<RecoveryResult> {
    const startTime = Date.now()
    let attempt = 1

    while (attempt <= strategy.maxAttempts) {
      const attemptId = `${component}-${strategy.type}-${startTime}-${attempt}`
      
      try {
        // Check prerequisites if any
        if (strategy.prerequisites) {
          for (const prerequisite of strategy.prerequisites) {
            const prerequisiteMet = await prerequisite()
            if (!prerequisiteMet) {
              this.recordAttempt(attemptId, startTime, component, errorType, strategy.type, 
                               RecoveryResult.NOT_APPLICABLE, Date.now() - startTime, 
                               new Error('Prerequisites not met'))
              return RecoveryResult.NOT_APPLICABLE
            }
          }
        }

        const context: RecoveryContext = {
          originalError: error,
          component,
          errorType,
          severity,
          attempt,
          maxAttempts: strategy.maxAttempts,
          startTime,
          metadata,
        }

        // Execute the recovery strategy with timeout
        const result = await this.withTimeout(
          strategy.implementation(error, attempt, context),
          strategy.timeoutMs
        )

        const duration = Date.now() - startTime
        this.recordAttempt(attemptId, startTime, component, errorType, strategy.type, result, duration)

        if (result === RecoveryResult.SUCCESS) {
          if (strategy.onSuccess) {
            await strategy.onSuccess(context)
          }
          this.updateStats(result, duration, strategy.type, component, errorType)
          return result
        } else if (result === RecoveryResult.PARTIAL_SUCCESS) {
          this.updateStats(result, duration, strategy.type, component, errorType)
          return result
        } else if (result === RecoveryResult.REQUIRES_USER_ACTION) {
          return result
        }

        // If failed and we have more attempts, wait before retrying
        if (attempt < strategy.maxAttempts) {
          const delay = this.calculateDelay(attempt, strategy)
          await this.sleep(delay)
        }

        attempt++
      } catch (strategyError) {
        const duration = Date.now() - startTime
        const errorToRecord = strategyError instanceof Error ? strategyError : new Error(String(strategyError))
        this.recordAttempt(attemptId, startTime, component, errorType, strategy.type, 
                         RecoveryResult.FAILED, duration, errorToRecord)
        
        if (attempt >= strategy.maxAttempts) {
          if (strategy.onFailure) {
            await strategy.onFailure({
              originalError: error,
              component,
              errorType,
              severity,
              attempt,
              maxAttempts: strategy.maxAttempts,
              startTime,
              metadata,
            }, errorToRecord)
          }
          this.updateStats(RecoveryResult.FAILED, duration, strategy.type, component, errorType)
          break
        }

        attempt++
      }
    }

    return RecoveryResult.FAILED
  }

  /**
   * Find applicable recovery strategies for component and error type
   */
  private findApplicableStrategies(component: ComponentType, errorType: ErrorType): RecoveryStrategy[] {
    const strategies: RecoveryStrategy[] = []

    for (const strategy of this.strategies.values()) {
      if (strategy.component === component && strategy.errorTypes.includes(errorType)) {
        strategies.push(strategy)
      }
    }

    // Sort by priority (network retries first, then state resets, etc.)
    const priorityOrder = [
      RecoveryStrategyType.NETWORK_RETRY,
      RecoveryStrategyType.CACHE_CLEAR,
      RecoveryStrategyType.PERMISSION_REQUEST,
      RecoveryStrategyType.STATE_RESET,
      RecoveryStrategyType.STORAGE_REPAIR,
      RecoveryStrategyType.RESOURCE_CLEANUP,
      RecoveryStrategyType.CONFIGURATION_RESET,
      RecoveryStrategyType.SERVICE_RESTART,
      RecoveryStrategyType.API_FALLBACK,
    ]

    return strategies.sort((a, b) => {
      const aPriority = priorityOrder.indexOf(a.type)
      const bPriority = priorityOrder.indexOf(b.type)
      return aPriority - bPriority
    })
  }

  // Strategy implementations

  /**
   * Network retry recovery implementation
   */
  private async performNetworkRetry(error: Error, attempt: number, context: RecoveryContext): Promise<RecoveryResult> {
    this.log(LogLevel.DEBUG, `Attempting network retry (attempt ${attempt}) for ${context.component}`)

    try {
      // Test network connectivity
      if (!navigator.onLine) {
        return RecoveryResult.NOT_APPLICABLE
      }

      // For translation service, try a simple API health check
      if (context.component === ComponentType.TRANSLATION_SERVICE) {
        // This would test the translation API connectivity
        await this.testTranslationApiConnectivity()
        return RecoveryResult.SUCCESS
      }

      // For subtitle manager, test subtitle URL accessibility
      if (context.component === ComponentType.SUBTITLE_MANAGER) {
        await this.testSubtitleConnectivity()
        return RecoveryResult.SUCCESS
      }

      return RecoveryResult.SUCCESS
    } catch (retryError) {
      this.log(LogLevel.DEBUG, `Network retry failed:`, retryError)
      return RecoveryResult.FAILED
    }
  }

  /**
   * Storage repair recovery implementation
   */
  private async performStorageRepair(error: Error, attempt: number, context: RecoveryContext): Promise<RecoveryResult> {
    this.log(LogLevel.DEBUG, `Attempting storage repair (attempt ${attempt})`)

    try {
      // Test basic storage functionality
      const testKey = 'recovery-test'
      const testValue = { timestamp: Date.now() }

      // Try to write and read a test value
      await chrome.storage.local.set({ [testKey]: testValue })
      const result = await chrome.storage.local.get(testKey)
      
      if (result[testKey]?.timestamp === testValue.timestamp) {
        // Clean up test data
        await chrome.storage.local.remove(testKey)
        return RecoveryResult.SUCCESS
      }

      return RecoveryResult.FAILED
    } catch (storageError) {
      this.log(LogLevel.DEBUG, `Storage repair failed:`, storageError)
      
      // Try alternative storage if available
      try {
        sessionStorage.setItem('recovery-test', JSON.stringify({ timestamp: Date.now() }))
        sessionStorage.removeItem('recovery-test')
        return RecoveryResult.PARTIAL_SUCCESS
      } catch {
        return RecoveryResult.FAILED
      }
    }
  }

  /**
   * Permission request recovery implementation
   */
  private async performPermissionRequest(error: Error, attempt: number, context: RecoveryContext): Promise<RecoveryResult> {
    this.log(LogLevel.DEBUG, `Attempting permission request for ${context.component}`)

    try {
      if (context.component === ComponentType.TTS_SERVICE) {
        // Check if audio permissions are available
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(track => track.stop())
        return RecoveryResult.SUCCESS
      }

      return RecoveryResult.NOT_APPLICABLE
    } catch (permissionError) {
      return RecoveryResult.REQUIRES_USER_ACTION
    }
  }

  /**
   * Cache clear recovery implementation
   */
  private async performCacheClear(error: Error, attempt: number, context: RecoveryContext): Promise<RecoveryResult> {
    this.log(LogLevel.DEBUG, `Attempting cache clear for ${context.component}`)

    try {
      if (context.component === ComponentType.TRANSLATION_SERVICE) {
        // Clear translation cache
        await this.clearTranslationCache()
        return RecoveryResult.SUCCESS
      }

      if (context.component === ComponentType.SUBTITLE_MANAGER) {
        // Clear subtitle cache
        await this.clearSubtitleCache()
        return RecoveryResult.SUCCESS
      }

      return RecoveryResult.NOT_APPLICABLE
    } catch (cacheError) {
      this.log(LogLevel.DEBUG, `Cache clear failed:`, cacheError)
      return RecoveryResult.FAILED
    }
  }

  /**
   * State reset recovery implementation
   */
  private async performStateReset(error: Error, attempt: number, context: RecoveryContext): Promise<RecoveryResult> {
    this.log(LogLevel.DEBUG, `Attempting state reset for ${context.component}`)

    try {
      // Reset component state
      const currentState = this.componentStates.get(context.component)
      if (currentState) {
        // Reset to initial state
        this.componentStates.set(context.component, this.getInitialComponentState(context.component))
      }

      if (context.component === ComponentType.YOUTUBE_INTEGRATION) {
        // Reset YouTube player state
        await this.resetYouTubePlayerState()
        return RecoveryResult.SUCCESS
      }

      return RecoveryResult.SUCCESS
    } catch (resetError) {
      this.log(LogLevel.DEBUG, `State reset failed:`, resetError)
      return RecoveryResult.FAILED
    }
  }

  /**
   * Service restart recovery implementation
   */
  private async performServiceRestart(error: Error, attempt: number, context: RecoveryContext): Promise<RecoveryResult> {
    this.log(LogLevel.DEBUG, `Attempting service restart for ${context.component}`)

    try {
      if (context.component === ComponentType.SUBTITLE_MANAGER) {
        // Simulate subtitle manager restart
        await this.restartSubtitleManager()
        return RecoveryResult.SUCCESS
      }

      return RecoveryResult.NOT_APPLICABLE
    } catch (restartError) {
      this.log(LogLevel.DEBUG, `Service restart failed:`, restartError)
      return RecoveryResult.FAILED
    }
  }

  /**
   * Configuration reset recovery implementation
   */
  private async performConfigurationReset(error: Error, attempt: number, context: RecoveryContext): Promise<RecoveryResult> {
    this.log(LogLevel.DEBUG, `Attempting configuration reset for ${context.component}`)

    try {
      // Reset component configuration to defaults
      await this.resetComponentConfiguration(context.component)
      return RecoveryResult.SUCCESS
    } catch (configError) {
      this.log(LogLevel.DEBUG, `Configuration reset failed:`, configError)
      return RecoveryResult.FAILED
    }
  }

  /**
   * Resource cleanup recovery implementation
   */
  private async performResourceCleanup(error: Error, attempt: number, context: RecoveryContext): Promise<RecoveryResult> {
    this.log(LogLevel.DEBUG, `Attempting resource cleanup for ${context.component}`)

    try {
      // Clean up memory and resources
      if (typeof gc === 'function') {
        gc() // Force garbage collection if available
      }

      // Clean up event listeners and timers
      await this.cleanupResources(context.component)
      return RecoveryResult.SUCCESS
    } catch (cleanupError) {
      this.log(LogLevel.DEBUG, `Resource cleanup failed:`, cleanupError)
      return RecoveryResult.FAILED
    }
  }

  // Helper methods for strategy implementations

  private async testTranslationApiConnectivity(): Promise<void> {
    // Placeholder for translation API health check
    // In real implementation, this would test the translation service
    await this.sleep(100) // Simulate API call
  }

  private async testSubtitleConnectivity(): Promise<void> {
    // Placeholder for subtitle connectivity test
    await this.sleep(100) // Simulate connectivity check
  }

  private async clearTranslationCache(): Promise<void> {
    // Clear translation-related cache entries
    const keys = await chrome.storage.local.get(null)
    const translationKeys = Object.keys(keys).filter(key => key.startsWith('translation-'))
    if (translationKeys.length > 0) {
      await chrome.storage.local.remove(translationKeys)
    }
  }

  private async clearSubtitleCache(): Promise<void> {
    // Clear subtitle-related cache entries
    const keys = await chrome.storage.local.get(null)
    const subtitleKeys = Object.keys(keys).filter(key => key.startsWith('subtitle-'))
    if (subtitleKeys.length > 0) {
      await chrome.storage.local.remove(subtitleKeys)
    }
  }

  private async resetYouTubePlayerState(): Promise<void> {
    // Reset YouTube player integration state
    // This would interact with the YouTube player service
    const video = document.querySelector('video')
    if (video) {
      // Reset video element state if needed
    }
  }

  private async restartSubtitleManager(): Promise<void> {
    // Restart subtitle manager service
    // This would reinitialize the subtitle management components
  }

  private async resetComponentConfiguration(component: ComponentType): Promise<void> {
    // Reset component configuration to defaults
    const defaultConfig = this.getDefaultComponentConfiguration(component)
    this.componentStates.set(component, defaultConfig)
  }

  private async cleanupResources(component: ComponentType): Promise<void> {
    // Clean up component-specific resources
    // This would clean up event listeners, timers, etc.
  }

  private getInitialComponentState(component: ComponentType): any {
    // Return initial state for component
    return {}
  }

  private getDefaultComponentConfiguration(component: ComponentType): any {
    // Return default configuration for component
    return {}
  }

  // Utility methods

  private getStrategyKey(component: ComponentType, type: RecoveryStrategyType): string {
    return `${component}-${type}`
  }

  private calculateDelay(attempt: number, strategy: RecoveryStrategy): number {
    const delay = strategy.initialDelay * Math.pow(strategy.backoffMultiplier, attempt - 1)
    return Math.min(delay, strategy.maxDelay)
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Recovery timeout')), timeoutMs)
      )
    ])
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private recordAttempt(
    id: string,
    timestamp: number,
    component: ComponentType,
    errorType: ErrorType,
    strategy: RecoveryStrategyType,
    result: RecoveryResult,
    duration: number,
    error?: Error,
    details?: Record<string, any>
  ): void {
    const attempt: RecoveryAttempt = {
      id,
      timestamp,
      component,
      errorType,
      strategy,
      result,
      duration,
      error,
      details,
    }

    this.recoveryHistory.push(attempt)

    // Keep history within limits
    if (this.recoveryHistory.length > this.config.historyRetention) {
      this.recoveryHistory.shift()
    }
  }

  private updateStats(
    result: RecoveryResult,
    duration: number,
    strategy: RecoveryStrategyType,
    component: ComponentType,
    errorType: ErrorType
  ): void {
    if (!this.config.enableStatisticsTracking) return

    this.stats.totalAttempts++

    switch (result) {
      case RecoveryResult.SUCCESS:
        this.stats.successfulRecoveries++
        break
      case RecoveryResult.PARTIAL_SUCCESS:
        this.stats.partialRecoveries++
        break
      case RecoveryResult.FAILED:
        this.stats.failedRecoveries++
        break
    }

    // Update strategy stats
    this.stats.strategiesUsed[strategy] = (this.stats.strategiesUsed[strategy] || 0) + 1

    // Update component stats
    if (!this.stats.componentStats[component]) {
      this.stats.componentStats[component] = { attempts: 0, successes: 0, failures: 0, averageTime: 0 }
    }
    const componentStat = this.stats.componentStats[component]
    componentStat.attempts++
    if (result === RecoveryResult.SUCCESS || result === RecoveryResult.PARTIAL_SUCCESS) {
      componentStat.successes++
    } else {
      componentStat.failures++
    }
    componentStat.averageTime = (componentStat.averageTime + duration) / 2

    // Update error type stats
    if (!this.stats.errorTypeStats[errorType]) {
      this.stats.errorTypeStats[errorType] = { attempts: 0, successes: 0, failures: 0 }
    }
    const errorStat = this.stats.errorTypeStats[errorType]
    errorStat.attempts++
    if (result === RecoveryResult.SUCCESS || result === RecoveryResult.PARTIAL_SUCCESS) {
      errorStat.successes++
    } else {
      errorStat.failures++
    }

    // Update overall statistics
    this.stats.successRate = this.stats.successfulRecoveries / this.stats.totalAttempts
    this.stats.averageRecoveryTime = (this.stats.averageRecoveryTime + duration) / 2
  }

  private initializeStats(): MutableRecoveryStats {
    return {
      totalAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      partialRecoveries: 0,
      successRate: 0,
      averageRecoveryTime: 0,
      strategiesUsed: {} as Record<RecoveryStrategyType, number>,
      componentStats: {} as Record<ComponentType, any>,
      errorTypeStats: {} as Record<ErrorType, any>,
      recentAttempts: [],
    }
  }

  private startMaintenanceTasks(): void {
    // Cleanup old history entries
    this.cleanupTimer = window.setInterval(() => {
      const cutoff = Date.now() - (24 * 60 * 60 * 1000) // 24 hours
      this.recoveryHistory.splice(0, this.recoveryHistory.findIndex(attempt => attempt.timestamp > cutoff))
      
      // Update recent attempts in stats
      this.stats.recentAttempts = this.recoveryHistory.slice(-50) // Last 50 attempts
    }, this.config.cleanupInterval)

    // Update statistics periodically
    if (this.config.enableStatisticsTracking) {
      this.statsTimer = window.setInterval(() => {
        this.calculateAdvancedStats()
      }, 60000) // Every minute
    }
  }

  private calculateAdvancedStats(): void {
    // Calculate more detailed statistics
    const recentAttempts = this.recoveryHistory.filter(
      attempt => attempt.timestamp > Date.now() - (60 * 60 * 1000) // Last hour
    )

    // Update success rate for recent attempts
    if (recentAttempts.length > 0) {
      const recentSuccesses = recentAttempts.filter(
        attempt => attempt.result === RecoveryResult.SUCCESS || attempt.result === RecoveryResult.PARTIAL_SUCCESS
      ).length
      
      // Update rolling statistics
    }
  }

  private log(level: LogLevel, message: string, ...args: any[]): void {
    if (this.shouldLog(level)) {
      const logMethod = level === LogLevel.ERROR ? console.error :
                      level === LogLevel.WARN ? console.warn :
                      level === LogLevel.DEBUG ? console.debug : console.log
      
      logMethod(`[ErrorRecovery] ${message}`, ...args)
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levelPriority = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3,
      [LogLevel.CRITICAL]: 4,
    }

    return levelPriority[level] >= levelPriority[this.config.logLevel]
  }

  /**
   * Get current recovery statistics
   */
  public getStats(): RecoveryStats {
    return { ...this.stats }
  }

  /**
   * Get recovery history
   */
  public getHistory(component?: ComponentType, limit: number = 100): RecoveryAttempt[] {
    let history = [...this.recoveryHistory]
    
    if (component) {
      history = history.filter(attempt => attempt.component === component)
    }

    return history
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  /**
   * Check if a component is currently being recovered
   */
  public isRecovering(component: ComponentType): boolean {
    for (const key of this.activeRecoveries.keys()) {
      if (key.startsWith(component)) {
        return true
      }
    }
    return false
  }

  /**
   * Update recovery configuration
   */
  public updateConfig(updates: Partial<RecoveryConfig>): void {
    Object.assign(this.config, updates)
  }

  /**
   * Destroy the service and clean up resources
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    if (this.statsTimer) {
      clearInterval(this.statsTimer)
      this.statsTimer = null
    }

    this.strategies.clear()
    this.activeRecoveries.clear()
    this.componentStates.clear()

    ErrorRecoveryService.instance = null
  }
} 