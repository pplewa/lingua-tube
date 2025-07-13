// ========================================
// Graceful Degradation Service for System-Wide Fallback Management
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
 * Feature availability states
 */
export enum FeatureState {
  AVAILABLE = 'available',           // Feature working normally
  DEGRADED = 'degraded',            // Feature working with limitations
  FALLBACK = 'fallback',            // Using fallback implementation
  UNAVAILABLE = 'unavailable',      // Feature completely disabled
}

/**
 * System degradation levels
 */
export enum DegradationLevel {
  NONE = 'none',                    // All features working normally
  MINOR = 'minor',                  // Some non-critical features degraded
  MODERATE = 'moderate',            // Multiple features using fallbacks
  SEVERE = 'severe',                // Only core features working
  CRITICAL = 'critical',            // System barely functional
}

/**
 * Feature configuration for graceful degradation
 */
export interface FeatureConfig {
  readonly name: string
  readonly component: ComponentType
  readonly priority: 'critical' | 'high' | 'medium' | 'low'
  readonly dependencies: string[]
  readonly fallbackOptions: FallbackOption[]
  readonly recoveryStrategy: RecoveryStrategy
  readonly healthCheckInterval: number
  readonly maxDegradationTime: number
}

/**
 * Fallback option configuration
 */
export interface FallbackOption {
  readonly name: string
  readonly type: 'cache' | 'offline' | 'limited' | 'disabled' | 'alternative'
  readonly implementation: () => Promise<boolean>
  readonly userMessage?: string
  readonly limitations?: string[]
  readonly performanceImpact: 'none' | 'low' | 'medium' | 'high'
}

/**
 * Recovery strategy configuration
 */
export interface RecoveryStrategy {
  readonly type: 'automatic' | 'manual' | 'scheduled' | 'conditional'
  readonly interval?: number
  readonly conditions?: (() => Promise<boolean>)[]
  readonly maxAttempts?: number
  readonly backoffMultiplier?: number
}

/**
 * Feature status information
 */
export interface FeatureStatus {
  readonly name: string
  readonly state: FeatureState
  readonly activeFallback?: string
  readonly degradedSince?: number
  readonly lastHealthCheck: number
  readonly healthCheckResults: HealthCheckResult[]
  readonly recoveryAttempts: number
  readonly userNotified: boolean
  readonly performanceImpact: number // 0-100 scale
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  readonly timestamp: number
  readonly success: boolean
  readonly responseTime?: number
  readonly error?: string
  readonly details?: Record<string, any>
}

/**
 * System health overview
 */
export interface SystemHealth {
  readonly overallLevel: DegradationLevel
  readonly availableFeatures: number
  readonly degradedFeatures: number
  readonly unavailableFeatures: number
  readonly estimatedPerformance: number // 0-100 scale
  readonly userExperienceImpact: 'none' | 'minor' | 'moderate' | 'significant' | 'severe'
  readonly recommendedActions: string[]
}

/**
 * Degradation event for monitoring
 */
export interface DegradationEvent {
  readonly timestamp: number
  readonly feature: string
  readonly previousState: FeatureState
  readonly newState: FeatureState
  readonly reason: string
  readonly fallbackUsed?: string
  readonly expectedDuration?: number
  readonly userImpact: 'none' | 'low' | 'medium' | 'high' | 'critical'
}

/**
 * User notification configuration
 */
export interface UserNotificationConfig {
  readonly enabled: boolean
  readonly notifyOnDegradation: boolean
  readonly notifyOnRecovery: boolean
  readonly aggregateNotifications: boolean
  readonly maxNotificationsPerMinute: number
  readonly showPerformanceImpact: boolean
  readonly showRecommendations: boolean
}

/**
 * Graceful Degradation Service
 */
export class GracefulDegradationService {
  private static instance: GracefulDegradationService | null = null
  private readonly features: Map<string, FeatureConfig> = new Map()
  private readonly featureStatus: Map<string, FeatureStatus> = new Map()
  private readonly healthCheckTimers: Map<string, number> = new Map()
  private readonly recoveryTimers: Map<string, number> = new Map()
  private readonly degradationHistory: DegradationEvent[] = []
  private readonly notificationConfig: UserNotificationConfig
  private notificationRateLimit: { count: number; resetTime: number } = { count: 0, resetTime: 0 }

  // System monitoring
  private systemHealthCheckTimer: number | null = null
  private lastSystemHealthCheck: number = 0
  private currentDegradationLevel: DegradationLevel = DegradationLevel.NONE

  // Performance tracking
  private performanceBaseline: Map<string, number> = new Map()
  private currentPerformance: Map<string, number> = new Map()

  private constructor(config: { notifications?: Partial<UserNotificationConfig> } = {}) {
    this.notificationConfig = {
      enabled: true,
      notifyOnDegradation: true,
      notifyOnRecovery: true,
      aggregateNotifications: true,
      maxNotificationsPerMinute: 5,
      showPerformanceImpact: true,
      showRecommendations: true,
      ...config.notifications,
    }

    this.initializeDefaultFeatures()
    this.startSystemHealthMonitoring()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: { notifications?: Partial<UserNotificationConfig> }): GracefulDegradationService {
    if (!GracefulDegradationService.instance) {
      GracefulDegradationService.instance = new GracefulDegradationService(config)
    }
    return GracefulDegradationService.instance
  }

  /**
   * Initialize default features for the extension
   */
  private initializeDefaultFeatures(): void {
    // Translation Service
    this.registerFeature({
      name: 'translation',
      component: ComponentType.TRANSLATION_SERVICE,
      priority: 'critical',
      dependencies: [],
      fallbackOptions: [
        {
          name: 'cache-only',
          type: 'cache',
          implementation: async () => this.enableCacheOnlyTranslation(),
          userMessage: 'Using cached translations only',
          limitations: ['New translations unavailable', 'Limited to previously seen text'],
          performanceImpact: 'none',
        },
        {
          name: 'disabled',
          type: 'disabled',
          implementation: async () => this.disableTranslation(),
          userMessage: 'Translation temporarily unavailable',
          limitations: ['No translation functionality'],
          performanceImpact: 'none',
        },
      ],
      recoveryStrategy: {
        type: 'automatic',
        interval: 30000, // 30 seconds
        maxAttempts: 10,
        backoffMultiplier: 1.5,
      },
      healthCheckInterval: 60000, // 1 minute
      maxDegradationTime: 300000, // 5 minutes
    })

    // Subtitle Fetching
    this.registerFeature({
      name: 'subtitles',
      component: ComponentType.SUBTITLE_MANAGER,
      priority: 'critical',
      dependencies: [],
      fallbackOptions: [
        {
          name: 'youtube-auto-captions',
          type: 'alternative',
          implementation: async () => this.useYouTubeAutoCaptions(),
          userMessage: 'Using YouTube automatic captions',
          limitations: ['Auto-generated captions may be less accurate'],
          performanceImpact: 'low',
        },
        {
          name: 'disabled',
          type: 'disabled',
          implementation: async () => this.disableSubtitles(),
          userMessage: 'Subtitle fetching unavailable',
          limitations: ['No subtitle display'],
          performanceImpact: 'none',
        },
      ],
      recoveryStrategy: {
        type: 'automatic',
        interval: 45000, // 45 seconds
        maxAttempts: 8,
        backoffMultiplier: 1.2,
      },
      healthCheckInterval: 90000, // 1.5 minutes
      maxDegradationTime: 600000, // 10 minutes
    })

    // Dictionary Service
    this.registerFeature({
      name: 'dictionary',
      component: ComponentType.DICTIONARY_SERVICE,
      priority: 'medium',
      dependencies: [],
      fallbackOptions: [
        {
          name: 'basic-translation',
          type: 'limited',
          implementation: async () => this.useBasicTranslationOnly(),
          userMessage: 'Using basic translation without definitions',
          limitations: ['No detailed word definitions', 'No pronunciation guides'],
          performanceImpact: 'low',
        },
        {
          name: 'disabled',
          type: 'disabled',
          implementation: async () => this.disableDictionary(),
          userMessage: 'Dictionary lookup unavailable',
          limitations: ['No word definitions'],
          performanceImpact: 'none',
        },
      ],
      recoveryStrategy: {
        type: 'automatic',
        interval: 120000, // 2 minutes
        maxAttempts: 5,
        backoffMultiplier: 2.0,
      },
      healthCheckInterval: 180000, // 3 minutes
      maxDegradationTime: 900000, // 15 minutes
    })

    // Text-to-Speech Service
    this.registerFeature({
      name: 'tts',
      component: ComponentType.TTS_SERVICE,
      priority: 'low',
      dependencies: [],
      fallbackOptions: [
        {
          name: 'browser-tts',
          type: 'alternative',
          implementation: async () => this.useBrowserTTS(),
          userMessage: 'Using browser text-to-speech',
          limitations: ['Limited voice options', 'May not support all languages'],
          performanceImpact: 'medium',
        },
        {
          name: 'disabled',
          type: 'disabled',
          implementation: async () => this.disableTTS(),
          userMessage: 'Text-to-speech unavailable',
          limitations: ['No audio pronunciation'],
          performanceImpact: 'none',
        },
      ],
      recoveryStrategy: {
        type: 'conditional',
        conditions: [async () => this.checkAudioPermissions()],
        maxAttempts: 3,
      },
      healthCheckInterval: 300000, // 5 minutes
      maxDegradationTime: 1800000, // 30 minutes
    })

    // Storage Service
    this.registerFeature({
      name: 'storage',
      component: ComponentType.STORAGE_SERVICE,
      priority: 'high',
      dependencies: [],
      fallbackOptions: [
        {
          name: 'session-only',
          type: 'limited',
          implementation: async () => this.useSessionStorage(),
          userMessage: 'Using temporary storage only',
          limitations: ['Data lost when browser closes', 'Limited storage capacity'],
          performanceImpact: 'low',
        },
        {
          name: 'memory-only',
          type: 'limited',
          implementation: async () => this.useMemoryStorage(),
          userMessage: 'Using memory storage only',
          limitations: ['Data lost on page refresh', 'Very limited capacity'],
          performanceImpact: 'medium',
        },
      ],
      recoveryStrategy: {
        type: 'automatic',
        interval: 60000, // 1 minute
        maxAttempts: 15,
        backoffMultiplier: 1.3,
      },
      healthCheckInterval: 120000, // 2 minutes
      maxDegradationTime: 1800000, // 30 minutes
    })

    // YouTube Integration
    this.registerFeature({
      name: 'youtube',
      component: ComponentType.YOUTUBE_INTEGRATION,
      priority: 'critical',
      dependencies: [],
      fallbackOptions: [
        {
          name: 'limited-integration',
          type: 'limited',
          implementation: async () => this.useLimitedYouTubeIntegration(),
          userMessage: 'Limited YouTube integration',
          limitations: ['Reduced playback controls', 'May not detect all video changes'],
          performanceImpact: 'medium',
        },
        {
          name: 'disabled',
          type: 'disabled',
          implementation: async () => this.disableYouTubeIntegration(),
          userMessage: 'YouTube integration unavailable',
          limitations: ['No video control integration'],
          performanceImpact: 'none',
        },
      ],
      recoveryStrategy: {
        type: 'automatic',
        interval: 30000, // 30 seconds
        maxAttempts: 12,
        backoffMultiplier: 1.4,
      },
      healthCheckInterval: 45000, // 45 seconds
      maxDegradationTime: 300000, // 5 minutes
    })
  }

  /**
   * Register a new feature for monitoring and degradation
   */
  public registerFeature(config: FeatureConfig): void {
    this.features.set(config.name, config)
    this.featureStatus.set(config.name, {
      name: config.name,
      state: FeatureState.AVAILABLE,
      lastHealthCheck: Date.now(),
      healthCheckResults: [],
      recoveryAttempts: 0,
      userNotified: false,
      performanceImpact: 0,
    })

    // Start health checking for this feature
    this.startFeatureHealthCheck(config.name)
  }

  /**
   * Report feature failure and trigger degradation
   */
  public async reportFeatureFailure(
    featureName: string, 
    error: Error, 
    context?: {
      severity?: ErrorSeverity
      expectedRecoveryTime?: number
      userImpact?: 'none' | 'low' | 'medium' | 'high' | 'critical'
    }
  ): Promise<void> {
    const feature = this.features.get(featureName)
    const status = this.featureStatus.get(featureName)

    if (!feature || !status) {
      console.warn(`[GracefulDegradation] Unknown feature reported failure: ${featureName}`)
      return
    }

    const previousState = status.state
    const userImpact = context?.userImpact || this.assessUserImpact(feature, error)
    
    // Determine appropriate degradation response
    const degradationResponse = await this.determineDegradationResponse(feature, error, context)
    
    // Apply degradation
    const success = await this.applyDegradation(featureName, degradationResponse)
    
    if (success) {
      // Update status
      this.updateFeatureStatus(featureName, {
        state: degradationResponse.newState,
        activeFallback: degradationResponse.fallbackUsed,
        degradedSince: Date.now(),
        performanceImpact: degradationResponse.performanceImpact,
      })

      // Record degradation event
      this.recordDegradationEvent({
        timestamp: Date.now(),
        feature: featureName,
        previousState,
        newState: degradationResponse.newState,
        reason: error.message,
        fallbackUsed: degradationResponse.fallbackUsed,
        expectedDuration: context?.expectedRecoveryTime,
        userImpact,
      })

      // Notify user if appropriate
      if (this.shouldNotifyUser(feature, degradationResponse)) {
        await this.notifyUserOfDegradation(feature, degradationResponse, userImpact)
      }

      // Start recovery attempts if applicable
      if (degradationResponse.triggerRecovery) {
        this.startRecoveryAttempts(featureName)
      }

      // Update system-wide degradation level
      this.updateSystemDegradationLevel()
    }
  }

  /**
   * Attempt feature recovery
   */
  public async attemptFeatureRecovery(featureName: string): Promise<boolean> {
    const feature = this.features.get(featureName)
    const status = this.featureStatus.get(featureName)

    if (!feature || !status || status.state === FeatureState.AVAILABLE) {
      return true
    }

    try {
      // Perform feature health check
      const healthResult = await this.performHealthCheck(feature)
      
      if (healthResult.success) {
        // Recovery successful
        const previousState = status.state
        
        this.updateFeatureStatus(featureName, {
          state: FeatureState.AVAILABLE,
          activeFallback: undefined,
          degradedSince: undefined,
          recoveryAttempts: 0,
          performanceImpact: 0,
        })

        // Record recovery event
        this.recordDegradationEvent({
          timestamp: Date.now(),
          feature: featureName,
          previousState,
          newState: FeatureState.AVAILABLE,
          reason: 'Automatic recovery successful',
          userImpact: 'none',
        })

        // Notify user of recovery
        if (status.userNotified && this.notificationConfig.notifyOnRecovery) {
          await this.notifyUserOfRecovery(feature)
        }

        // Update system-wide degradation level
        this.updateSystemDegradationLevel()

        return true
      } else {
        // Recovery failed, increment attempt counter
        this.updateFeatureStatus(featureName, {
          recoveryAttempts: status.recoveryAttempts + 1,
        })

        return false
      }
    } catch (error) {
      console.error(`[GracefulDegradation] Recovery attempt failed for ${featureName}:`, error)
      return false
    }
  }

  /**
   * Get current system health overview
   */
  public getSystemHealth(): SystemHealth {
    const features = Array.from(this.featureStatus.values())
    const availableFeatures = features.filter(f => f.state === FeatureState.AVAILABLE).length
    const degradedFeatures = features.filter(f => f.state === FeatureState.DEGRADED || f.state === FeatureState.FALLBACK).length
    const unavailableFeatures = features.filter(f => f.state === FeatureState.UNAVAILABLE).length

    // Calculate estimated performance
    const totalFeatures = features.length
    const performanceScore = features.reduce((score, feature) => {
      switch (feature.state) {
        case FeatureState.AVAILABLE:
          return score + 100
        case FeatureState.DEGRADED:
          return score + 70
        case FeatureState.FALLBACK:
          return score + 50
        case FeatureState.UNAVAILABLE:
          return score + 0
        default:
          return score + 50
      }
    }, 0) / totalFeatures

    // Determine user experience impact
    let userExperienceImpact: SystemHealth['userExperienceImpact'] = 'none'
    if (unavailableFeatures > 0 || this.currentDegradationLevel === DegradationLevel.CRITICAL) {
      userExperienceImpact = 'severe'
    } else if (degradedFeatures > 2 || this.currentDegradationLevel === DegradationLevel.SEVERE) {
      userExperienceImpact = 'significant'
    } else if (degradedFeatures > 1 || this.currentDegradationLevel === DegradationLevel.MODERATE) {
      userExperienceImpact = 'moderate'
    } else if (degradedFeatures > 0 || this.currentDegradationLevel === DegradationLevel.MINOR) {
      userExperienceImpact = 'minor'
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations(features)

    return {
      overallLevel: this.currentDegradationLevel,
      availableFeatures,
      degradedFeatures,
      unavailableFeatures,
      estimatedPerformance: Math.round(performanceScore),
      userExperienceImpact,
      recommendedActions: recommendations,
    }
  }

  /**
   * Get detailed feature status
   */
  public getFeatureStatus(featureName?: string): FeatureStatus | FeatureStatus[] {
    if (featureName) {
      const status = this.featureStatus.get(featureName)
      if (!status) {
        throw new Error(`Feature not found: ${featureName}`)
      }
      return status
    }

    return Array.from(this.featureStatus.values())
  }

  /**
   * Get degradation history
   */
  public getDegradationHistory(featureName?: string, limit: number = 50): DegradationEvent[] {
    let events = this.degradationHistory
    
    if (featureName) {
      events = events.filter(event => event.feature === featureName)
    }

    return events
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  /**
   * Force feature state change (for testing or manual intervention)
   */
  public async forceFeatureState(featureName: string, state: FeatureState, fallbackName?: string): Promise<boolean> {
    const feature = this.features.get(featureName)
    if (!feature) {
      return false
    }

    const status = this.featureStatus.get(featureName)
    if (!status) {
      return false
    }

    const previousState = status.state
    
    // Apply the forced state
    if (state !== FeatureState.AVAILABLE && fallbackName) {
      const fallback = feature.fallbackOptions.find(f => f.name === fallbackName)
      if (fallback) {
        try {
          await fallback.implementation()
        } catch (error) {
          console.error(`[GracefulDegradation] Failed to apply forced fallback ${fallbackName}:`, error)
          return false
        }
      }
    }

    this.updateFeatureStatus(featureName, {
      state,
      activeFallback: fallbackName,
      degradedSince: state !== FeatureState.AVAILABLE ? Date.now() : undefined,
    })

    // Record the forced change
    this.recordDegradationEvent({
      timestamp: Date.now(),
      feature: featureName,
      previousState,
      newState: state,
      reason: 'Manual override',
      fallbackUsed: fallbackName,
      userImpact: 'none',
    })

    this.updateSystemDegradationLevel()
    return true
  }

  /**
   * Update system-wide degradation level
   */
  private updateSystemDegradationLevel(): void {
    const features = Array.from(this.featureStatus.values())
    const criticalFeatures = features.filter(f => {
      const config = this.features.get(f.name)
      return config?.priority === 'critical'
    })

    const highFeatures = features.filter(f => {
      const config = this.features.get(f.name)
      return config?.priority === 'high'
    })

    // Count degraded/unavailable features by priority
    const criticalDegraded = criticalFeatures.filter(f => f.state !== FeatureState.AVAILABLE).length
    const highDegraded = highFeatures.filter(f => f.state !== FeatureState.AVAILABLE).length
    const totalDegraded = features.filter(f => f.state !== FeatureState.AVAILABLE).length

    // Determine degradation level
    let newLevel: DegradationLevel = DegradationLevel.NONE

    if (criticalDegraded >= criticalFeatures.length) {
      newLevel = DegradationLevel.CRITICAL
    } else if (criticalDegraded > 0 || highDegraded >= highFeatures.length) {
      newLevel = DegradationLevel.SEVERE
    } else if (highDegraded > 0 || totalDegraded >= features.length * 0.5) {
      newLevel = DegradationLevel.MODERATE
    } else if (totalDegraded > 0) {
      newLevel = DegradationLevel.MINOR
    }

    const previousLevel = this.currentDegradationLevel
    this.currentDegradationLevel = newLevel

    // Log level changes
    if (newLevel !== previousLevel) {
      console.log(`[GracefulDegradation] System degradation level changed: ${previousLevel} → ${newLevel}`)
    }
  }

  // Helper methods for fallback implementations
  private async enableCacheOnlyTranslation(): Promise<boolean> {
    // Implementation would integrate with translation service to enable cache-only mode
    console.log('[GracefulDegradation] Enabled cache-only translation mode')
    return true
  }

  private async disableTranslation(): Promise<boolean> {
    console.log('[GracefulDegradation] Disabled translation service')
    return true
  }

  private async useYouTubeAutoCaptions(): Promise<boolean> {
    console.log('[GracefulDegradation] Switched to YouTube auto-captions')
    return true
  }

  private async disableSubtitles(): Promise<boolean> {
    console.log('[GracefulDegradation] Disabled subtitle fetching')
    return true
  }

  private async useBasicTranslationOnly(): Promise<boolean> {
    console.log('[GracefulDegradation] Using basic translation without dictionary')
    return true
  }

  private async disableDictionary(): Promise<boolean> {
    console.log('[GracefulDegradation] Disabled dictionary service')
    return true
  }

  private async useBrowserTTS(): Promise<boolean> {
    console.log('[GracefulDegradation] Switched to browser TTS')
    return true
  }

  private async disableTTS(): Promise<boolean> {
    console.log('[GracefulDegradation] Disabled TTS service')
    return true
  }

  private async useSessionStorage(): Promise<boolean> {
    console.log('[GracefulDegradation] Switched to session storage')
    return true
  }

  private async useMemoryStorage(): Promise<boolean> {
    console.log('[GracefulDegradation] Switched to memory storage')
    return true
  }

  private async useLimitedYouTubeIntegration(): Promise<boolean> {
    console.log('[GracefulDegradation] Using limited YouTube integration')
    return true
  }

  private async disableYouTubeIntegration(): Promise<boolean> {
    console.log('[GracefulDegradation] Disabled YouTube integration')
    return true
  }

  private async checkAudioPermissions(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(track => track.stop())
      return true
    } catch {
      return false
    }
  }

  // Additional helper methods would continue here...
  // (Implementing health checks, user notifications, recovery logic, etc.)

  /**
   * Start system health monitoring
   */
  private startSystemHealthMonitoring(): void {
    this.systemHealthCheckTimer = window.setInterval(() => {
      this.performSystemHealthCheck()
    }, 30000) // Every 30 seconds
  }

  /**
   * Perform system-wide health check
   */
  private async performSystemHealthCheck(): Promise<void> {
    this.lastSystemHealthCheck = Date.now()
    
    // Check overall system performance
    const systemHealth = this.getSystemHealth()
    
    // Log health status if degraded
    if (systemHealth.overallLevel !== DegradationLevel.NONE) {
      console.log(`[GracefulDegradation] System health check: ${systemHealth.overallLevel} degradation`, {
        available: systemHealth.availableFeatures,
        degraded: systemHealth.degradedFeatures,
        unavailable: systemHealth.unavailableFeatures,
        performance: systemHealth.estimatedPerformance,
      })
    }
  }

  /**
   * Start health checking for a specific feature
   */
  private startFeatureHealthCheck(featureName: string): void {
    const feature = this.features.get(featureName)
    if (!feature) return

    const timer = window.setInterval(async () => {
      const healthResult = await this.performHealthCheck(feature)
      this.updateHealthCheckResult(featureName, healthResult)
      
      // Trigger recovery if feature is degraded but health check passes
      const status = this.featureStatus.get(featureName)
      if (status?.state !== FeatureState.AVAILABLE && healthResult.success) {
        await this.attemptFeatureRecovery(featureName)
      }
    }, feature.healthCheckInterval)

    this.healthCheckTimers.set(featureName, timer)
  }

  /**
   * Perform health check for a specific feature
   */
  private async performHealthCheck(feature: FeatureConfig): Promise<HealthCheckResult> {
    const startTime = performance.now()
    
    try {
      // Basic health check implementation
      // In a real implementation, this would test feature-specific functionality
      const success = await this.testFeatureHealth(feature.name)
      const responseTime = performance.now() - startTime
      
      return {
        timestamp: Date.now(),
        success,
        responseTime,
      }
    } catch (error) {
      return {
        timestamp: Date.now(),
        success: false,
        error: error instanceof Error ? error.message : String(error),
        responseTime: performance.now() - startTime,
      }
    }
  }

  /**
   * Test feature health (to be implemented per feature)
   */
  private async testFeatureHealth(featureName: string): Promise<boolean> {
    // Placeholder implementation
    // Real implementation would test feature-specific functionality
    switch (featureName) {
      case 'translation':
        return this.testTranslationHealth()
      case 'subtitles':
        return this.testSubtitleHealth()
      case 'dictionary':
        return this.testDictionaryHealth()
      case 'tts':
        return this.testTTSHealth()
      case 'storage':
        return this.testStorageHealth()
      case 'youtube':
        return this.testYouTubeHealth()
      default:
        return true
    }
  }

  // Feature-specific health test methods
  private async testTranslationHealth(): Promise<boolean> {
    // Test translation service availability
    return true // Placeholder
  }

  private async testSubtitleHealth(): Promise<boolean> {
    // Test subtitle fetching capability
    return true // Placeholder
  }

  private async testDictionaryHealth(): Promise<boolean> {
    // Test dictionary service
    return true // Placeholder
  }

  private async testTTSHealth(): Promise<boolean> {
    // Test TTS service
    return true // Placeholder
  }

  private async testStorageHealth(): Promise<boolean> {
    // Test storage accessibility
    try {
      await chrome.storage.local.set({ 'health-check': Date.now() })
      await chrome.storage.local.remove('health-check')
      return true
    } catch {
      return false
    }
  }

  private async testYouTubeHealth(): Promise<boolean> {
    // Test YouTube integration
    return document.querySelector('video') !== null
  }

  /**
   * Update health check result for a feature
   */
  private updateHealthCheckResult(featureName: string, result: HealthCheckResult): void {
    const status = this.featureStatus.get(featureName)
    if (!status) return

    const updatedResults = [...status.healthCheckResults, result].slice(-10) // Keep last 10 results
    
    this.updateFeatureStatus(featureName, {
      lastHealthCheck: result.timestamp,
      healthCheckResults: updatedResults,
    })
  }

  /**
   * Update feature status
   */
  private updateFeatureStatus(featureName: string, updates: Partial<FeatureStatus>): void {
    const current = this.featureStatus.get(featureName)
    if (!current) return

    this.featureStatus.set(featureName, {
      ...current,
      ...updates,
    })
  }

  // Placeholder methods for remaining functionality
  private assessUserImpact(feature: FeatureConfig, error: Error): 'none' | 'low' | 'medium' | 'high' | 'critical' {
    // Assess impact based on feature priority and error type
    switch (feature.priority) {
      case 'critical': return 'high'
      case 'high': return 'medium'
      case 'medium': return 'low'
      case 'low': return 'none'
      default: return 'low'
    }
  }

  private async determineDegradationResponse(feature: FeatureConfig, error: Error, context?: any): Promise<{
    newState: FeatureState
    fallbackUsed?: string
    performanceImpact: number
    triggerRecovery: boolean
  }> {
    // Determine best fallback option
    const fallback = feature.fallbackOptions[0] // Use first fallback for now
    
    return {
      newState: FeatureState.FALLBACK,
      fallbackUsed: fallback?.name,
      performanceImpact: this.calculatePerformanceImpact(fallback?.performanceImpact || 'none'),
      triggerRecovery: true,
    }
  }

  private calculatePerformanceImpact(impact: 'none' | 'low' | 'medium' | 'high'): number {
    switch (impact) {
      case 'none': return 0
      case 'low': return 10
      case 'medium': return 25
      case 'high': return 50
      default: return 0
    }
  }

  private async applyDegradation(featureName: string, response: any): Promise<boolean> {
    // Apply the degradation response
    return true // Placeholder
  }

  private shouldNotifyUser(feature: FeatureConfig, response: any): boolean {
    return this.notificationConfig.enabled && this.notificationConfig.notifyOnDegradation
  }

  private async notifyUserOfDegradation(feature: FeatureConfig, response: any, userImpact: string): Promise<void> {
    // Send user notification about degradation
    console.log(`[GracefulDegradation] User notification: ${feature.name} degraded`)
  }

  private async notifyUserOfRecovery(feature: FeatureConfig): Promise<void> {
    // Send user notification about recovery
    console.log(`[GracefulDegradation] User notification: ${feature.name} recovered`)
  }

  private startRecoveryAttempts(featureName: string): void {
    // Start recovery timer
    const feature = this.features.get(featureName)
    if (!feature) return

    const interval = feature.recoveryStrategy.interval || 60000
    const timer = window.setInterval(async () => {
      const success = await this.attemptFeatureRecovery(featureName)
      if (success) {
        clearInterval(timer)
        this.recoveryTimers.delete(featureName)
      }
    }, interval)

    this.recoveryTimers.set(featureName, timer)
  }

  private recordDegradationEvent(event: DegradationEvent): void {
    this.degradationHistory.push(event)
    
    // Keep only last 1000 events
    if (this.degradationHistory.length > 1000) {
      this.degradationHistory.shift()
    }
  }

  private generateRecommendations(features: FeatureStatus[]): string[] {
    const recommendations: string[] = []
    
    const degradedFeatures = features.filter(f => f.state !== FeatureState.AVAILABLE)
    
    if (degradedFeatures.length > 0) {
      recommendations.push('Some features are experiencing issues')
      
      if (degradedFeatures.some(f => f.name === 'translation')) {
        recommendations.push('Try refreshing the page to restore translation')
      }
      
      if (degradedFeatures.some(f => f.name === 'subtitles')) {
        recommendations.push('Check your internet connection for subtitle loading')
      }
      
      if (degradedFeatures.length > 2) {
        recommendations.push('Consider disabling other browser extensions temporarily')
      }
    }
    
    return recommendations
  }

  /**
   * Destroy the service and clean up resources
   */
  public destroy(): void {
    // Clear all timers
    if (this.systemHealthCheckTimer) {
      clearInterval(this.systemHealthCheckTimer)
    }

    for (const timer of this.healthCheckTimers.values()) {
      clearInterval(timer)
    }

    for (const timer of this.recoveryTimers.values()) {
      clearInterval(timer)
    }

    // Clear maps
    this.features.clear()
    this.featureStatus.clear()
    this.healthCheckTimers.clear()
    this.recoveryTimers.clear()

    GracefulDegradationService.instance = null
  }
} 