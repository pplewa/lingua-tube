/**
 * YouTube Player Interaction Service
 * Provides direct interaction with the YouTube HTML5 video player for playback control,
 * state monitoring, and subtitle synchronization.
 */

import { YouTubePageContext, SubtitleDiscoveryEvent } from './types'

// ========================================
// Player Interaction Types
// ========================================

/**
 * Player state enumeration
 */
export enum PlayerState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5,
  UNKNOWN = 999,
}

/**
 * Player event types that can be listened to
 */
export enum PlayerEvent {
  PLAY = 'play',
  PAUSE = 'pause',
  ENDED = 'ended',
  TIME_UPDATE = 'timeupdate',
  DURATION_CHANGE = 'durationchange',
  RATE_CHANGE = 'ratechange',
  SEEKING = 'seeking',
  SEEKED = 'seeked',
  WAITING = 'waiting',
  PLAYING = 'playing',
  LOADED_DATA = 'loadeddata',
  LOADED_METADATA = 'loadedmetadata',
  CAN_PLAY = 'canplay',
  CAN_PLAY_THROUGH = 'canplaythrough',
  ERROR = 'error',
  STALLED = 'stalled',
  VOLUME_CHANGE = 'volumechange',
}

/**
 * Error types specific to player interaction
 */
export enum PlayerErrorCode {
  VIDEO_ELEMENT_NOT_FOUND = 'VIDEO_ELEMENT_NOT_FOUND',
  VIDEO_ELEMENT_UNAVAILABLE = 'VIDEO_ELEMENT_UNAVAILABLE',
  INVALID_TIME_VALUE = 'INVALID_TIME_VALUE',
  INVALID_RATE_VALUE = 'INVALID_RATE_VALUE',
  PLAYBACK_FAILED = 'PLAYBACK_FAILED',
  SEEK_FAILED = 'SEEK_FAILED',
  PLAYER_NOT_READY = 'PLAYER_NOT_READY',
  LISTENER_REGISTRATION_FAILED = 'LISTENER_REGISTRATION_FAILED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  // New comprehensive error codes
  OBSERVER_FAILURE = 'OBSERVER_FAILURE',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  BROWSER_COMPATIBILITY = 'BROWSER_COMPATIBILITY',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  OPERATION_TIMEOUT = 'OPERATION_TIMEOUT',
  INVALID_CONFIGURATION = 'INVALID_CONFIGURATION',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  FEATURE_NOT_SUPPORTED = 'FEATURE_NOT_SUPPORTED',
}

/**
 * Enhanced player error interface with severity and recovery info
 */
export interface PlayerError {
  readonly code: PlayerErrorCode
  readonly message: string
  readonly details?: Record<string, unknown>
  readonly timestamp: number
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
  readonly recoverable: boolean
  readonly retryable: boolean
  readonly context?: string // Operation context when error occurred
}

/**
 * Player metadata interface
 */
export interface PlayerMetadata {
  readonly currentTime: number
  readonly duration: number
  readonly playbackRate: number
  readonly volume: number
  readonly muted: boolean
  readonly paused: boolean
  readonly ended: boolean
  readonly readyState: number
  readonly buffered: TimeRanges
  readonly seekable: TimeRanges
  readonly videoWidth: number
  readonly videoHeight: number
}

/**
 * Player state information
 */
export interface PlayerStateInfo {
  readonly state: PlayerState
  readonly metadata: PlayerMetadata
  readonly timestamp: number
}

/**
 * Configuration for player interaction
 */
export interface PlayerInteractionConfig {
  readonly videoElementSelectors: string[]
  readonly observerTimeout: number
  readonly retryAttempts: number
  readonly retryDelay: number
  readonly enableStateTracking: boolean
  readonly throttleEventInterval: number
}

/**
 * Default configuration
 */
export const DEFAULT_PLAYER_CONFIG: PlayerInteractionConfig = {
  videoElementSelectors: [
    'video[data-layer="0"]', // Primary YouTube video element
    '.html5-video-player video', // Fallback selector
    '#movie_player video', // Alternative selector
    'video', // Last resort
  ],
  observerTimeout: 10000,
  retryAttempts: 3,
  retryDelay: 1000,
  enableStateTracking: true,
  throttleEventInterval: 100,
}

/**
 * Configuration for enhanced state tracking
 */
export interface StateTrackingConfig {
  readonly enableStateHistory: boolean
  readonly maxHistoryEntries: number
  readonly stateChangeThreshold: number // Minimum time difference to consider as a significant change
  readonly trackTimeUpdates: boolean
  readonly trackVolumeChanges: boolean
  readonly trackDimensionChanges: boolean
}

/**
 * Default state tracking configuration
 */
export const DEFAULT_STATE_TRACKING_CONFIG: StateTrackingConfig = {
  enableStateHistory: true,
  maxHistoryEntries: 50,
  stateChangeThreshold: 0.1, // 100ms
  trackTimeUpdates: true,
  trackVolumeChanges: true,
  trackDimensionChanges: false,
}

/**
 * Event listener callback interface
 */
export type PlayerEventCallback = (event: Event, playerState?: PlayerStateInfo) => void

/**
 * Player change callback interface
 */
export type PlayerChangeCallback = (
  videoElement: HTMLVideoElement | null,
  error?: PlayerError,
) => void

/**
 * Player state change callback interface
 */
export type PlayerStateChangeCallback = (
  newState: PlayerStateInfo,
  previousState: PlayerStateInfo | null,
  changes: PlayerStateChanges,
) => void

/**
 * State change information
 */
export interface PlayerStateChanges {
  readonly stateChanged: boolean
  readonly timeChanged: boolean
  readonly durationChanged: boolean
  readonly rateChanged: boolean
  readonly volumeChanged: boolean
  readonly muteChanged: boolean
  readonly dimensionsChanged: boolean
  readonly readyStateChanged: boolean
}

/**
 * State history entry
 */
export interface PlayerStateHistoryEntry {
  readonly state: PlayerStateInfo
  readonly changes: PlayerStateChanges
  readonly transition: PlayerStateTransition
}

/**
 * State transition information
 */
export interface PlayerStateTransition {
  readonly from: PlayerState
  readonly to: PlayerState
  readonly duration: number // Time spent in previous state
  readonly trigger?: string // What triggered the transition
}

// ========================================
// Subtitle Synchronization Types
// ========================================

/**
 * Subtitle cue structure
 */
export interface SubtitleCue {
  readonly id: string
  readonly startTime: number // In seconds
  readonly endTime: number // In seconds
  readonly text: string
  readonly nativeText?: string
  readonly language?: string
  readonly confidence?: number // Auto-generated subtitle confidence (0-1)
  readonly position?: SubtitlePosition // Display position
  readonly styling?: SubtitleStyling // Text styling
}

/**
 * Subtitle position configuration
 */
export interface SubtitlePosition {
  readonly line?: number // Line position
  readonly position?: number // Horizontal position (0-100)
  readonly align?: 'start' | 'center' | 'end'
  readonly vertical?: 'rl' | 'lr'
}

/**
 * Subtitle styling configuration
 */
export interface SubtitleStyling {
  readonly color?: string
  readonly backgroundColor?: string
  readonly fontSize?: string
  readonly fontFamily?: string
  readonly fontWeight?: string
  readonly textDecoration?: string
}

/**
 * Subtitle track information
 */
export interface SubtitleTrack {
  readonly id: string
  readonly language: string
  readonly label: string
  readonly kind: 'subtitles' | 'captions' | 'descriptions'
  readonly isDefault: boolean
  readonly isAutoGenerated: boolean
  readonly cues: SubtitleCue[]
  readonly source: 'youtube' | 'external' | 'manual'
}

/**
 * Subtitle synchronization configuration
 */
export interface SubtitleSyncConfig {
  readonly enabled: boolean
  readonly timeOffset: number // Global offset in seconds (can be negative)
  readonly lookAheadTime: number // How far ahead to pre-load cues (seconds)
  readonly lookBehindTime: number // How far behind to keep cues active (seconds)
  readonly timingTolerance: number // Acceptable timing drift (seconds)
  readonly autoCorrectTiming: boolean // Automatically adjust for timing drift
  readonly enableSmoothing: boolean // Smooth timing adjustments
  readonly maxConcurrentCues: number // Maximum cues to display simultaneously
}

/**
 * Active subtitle cue with timing information
 */
export interface ActiveSubtitleCue extends SubtitleCue {
  readonly isActive: boolean
  readonly timeRemaining: number // Seconds until cue ends
  readonly displayOrder: number // Order for multiple simultaneous cues
  readonly adjustedStartTime: number // Start time with sync adjustments
  readonly adjustedEndTime: number // End time with sync adjustments
}

/**
 * Subtitle synchronization event
 */
export interface SubtitleSyncEvent {
  readonly type: 'cue_start' | 'cue_end' | 'cue_update' | 'track_change' | 'sync_error'
  readonly cue?: ActiveSubtitleCue
  readonly track?: SubtitleTrack
  readonly currentTime: number
  readonly activeCues: ActiveSubtitleCue[]
  readonly error?: SubtitleSyncError
  readonly timestamp: number
}

/**
 * Subtitle synchronization error
 */
export interface SubtitleSyncError {
  readonly code: SubtitleSyncErrorCode
  readonly message: string
  readonly cueId?: string
  readonly trackId?: string
  readonly details?: Record<string, unknown>
}

/**
 * Subtitle synchronization error codes
 */
export enum SubtitleSyncErrorCode {
  TRACK_NOT_FOUND = 'TRACK_NOT_FOUND',
  CUE_TIMING_ERROR = 'CUE_TIMING_ERROR',
  SYNC_DRIFT_DETECTED = 'SYNC_DRIFT_DETECTED',
  PARSING_ERROR = 'PARSING_ERROR',
  TRACK_LOAD_FAILED = 'TRACK_LOAD_FAILED',
  TIMING_ADJUSTMENT_FAILED = 'TIMING_ADJUSTMENT_FAILED',
  INVALID_CUE_DATA = 'INVALID_CUE_DATA',
  SYNC_SERVICE_ERROR = 'SYNC_SERVICE_ERROR',
}

/**
 * Subtitle sync callback types
 */
export type SubtitleSyncCallback = (event: SubtitleSyncEvent) => void

/**
 * YouTube-specific subtitle data structure
 */
export interface YouTubeSubtitleData {
  readonly events: Array<{
    tStartMs: number
    dDurationMs: number
    segs?: Array<{
      utf8: string
      tOffsetMs?: number
    }>
  }>
  readonly wireMagic?: string
}

/**
 * Default subtitle synchronization configuration
 */
export const DEFAULT_SUBTITLE_SYNC_CONFIG: SubtitleSyncConfig = {
  enabled: true,
  timeOffset: 0,
  lookAheadTime: 2.0, // 2 seconds ahead
  lookBehindTime: 1.0, // 1 second behind
  timingTolerance: 0.2, // 200ms tolerance
  autoCorrectTiming: true,
  enableSmoothing: true,
  maxConcurrentCues: 3,
}

// ========================================
// Segment Looping Types
// ========================================

/**
 * Segment loop configuration
 */
export interface SegmentLoop {
  readonly id: string
  readonly startTime: number // Start time in seconds
  readonly endTime: number // End time in seconds
  readonly enabled: boolean
  readonly loopCount?: number // Optional limit on loop iterations
  readonly title?: string // Optional descriptive title
  readonly metadata?: Record<string, unknown> // Optional custom metadata
}

/**
 * Active segment loop with runtime state
 */
export interface ActiveSegmentLoop extends SegmentLoop {
  readonly currentIteration: number // Current loop iteration count
  readonly totalIterations: number // Total iterations completed
  readonly isActive: boolean // Currently within loop timeframe
  readonly timeInLoop: number // Time elapsed in current loop iteration
  readonly timeRemaining: number // Time remaining in current loop
  readonly createdAt: number // Creation timestamp
  readonly lastTriggeredAt: number // Last time loop was triggered
}

/**
 * Segment loop event
 */
export interface SegmentLoopEvent {
  readonly type:
    | 'loop_start'
    | 'loop_iteration'
    | 'loop_end'
    | 'loop_disabled'
    | 'loop_seek_outside'
  readonly loop: ActiveSegmentLoop
  readonly currentTime: number
  readonly iteration?: number // Specific to loop_iteration events
  readonly seekTarget?: number // Specific to seek events
  readonly timestamp: number
}

/**
 * Segment loop configuration
 */
export interface SegmentLoopConfig {
  readonly enabled: boolean
  readonly allowUserSeekOutside: boolean // Allow user to seek outside loop bounds
  readonly resumeAfterSeekOutside: boolean // Resume loop after user seeks outside
  readonly fadeInDuration: number // Fade in duration when loop restarts (seconds)
  readonly fadeOutDuration: number // Fade out duration before loop restarts (seconds)
  readonly delayBeforeLoop: number // Delay before restarting loop (seconds)
  readonly maxConsecutiveLoops: number // Max loops before auto-disable
  readonly enableLoopNotifications: boolean // Show notifications on loop events
  readonly seekBackOffset: number // Offset when seeking back to start (seconds)
}

/**
 * Loop seeking behavior
 */
export enum LoopSeekBehavior {
  IMMEDIATE = 'immediate', // Seek immediately when end is reached
  SMOOTH = 'smooth', // Smooth transition with fade
  DELAYED = 'delayed', // Wait before seeking back
  USER_CONTROLLED = 'user_controlled', // Only seek when user confirms
}

/**
 * Segment loop callback type
 */
export type SegmentLoopCallback = (event: SegmentLoopEvent) => void

/**
 * Default segment loop configuration
 */
export const DEFAULT_SEGMENT_LOOP_CONFIG: SegmentLoopConfig = {
  enabled: true,
  allowUserSeekOutside: true,
  resumeAfterSeekOutside: false,
  fadeInDuration: 0.5,
  fadeOutDuration: 0.5,
  delayBeforeLoop: 0.2,
  maxConsecutiveLoops: 10,
  enableLoopNotifications: true,
  seekBackOffset: 0.1,
}

// ========================================
// Error Recovery and Aggregation
// ========================================

/**
 * Error recovery configuration
 */
export interface ErrorRecoveryConfig {
  readonly enableRetry: boolean
  readonly maxRetries: number
  readonly retryDelayMs: number
  readonly retryBackoffFactor: number
  readonly enableCircuitBreaker: boolean
  readonly circuitBreakerThreshold: number
  readonly circuitBreakerTimeoutMs: number
}

/**
 * Default error recovery configuration
 */
export const DEFAULT_ERROR_RECOVERY_CONFIG: ErrorRecoveryConfig = {
  enableRetry: true,
  maxRetries: 3,
  retryDelayMs: 1000,
  retryBackoffFactor: 2,
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeoutMs: 30000,
}

/**
 * Error aggregation entry
 */
export interface ErrorAggregationEntry {
  readonly error: PlayerError
  readonly count: number
  readonly firstSeen: number
  readonly lastSeen: number
  readonly context: string[]
}

/**
 * Error monitoring metrics
 */
export interface ErrorMetrics {
  readonly totalErrors: number
  readonly errorsByCode: Record<PlayerErrorCode, number>
  readonly errorsBySeverity: Record<string, number>
  readonly averageErrorsPerMinute: number
  readonly lastErrorTime: number
  readonly uptime: number
}

/**
 * Browser compatibility info
 */
export interface BrowserCompatibility {
  readonly userAgent: string
  readonly features: {
    readonly videoApi: boolean
    readonly mutationObserver: boolean
    readonly webkitFullscreen: boolean
    readonly requestVideoFrameCallback: boolean
    readonly mediasession: boolean
  }
  readonly compatibility: 'full' | 'partial' | 'limited' | 'unsupported'
  readonly warnings: string[]
  readonly recommendations: string[]
}

/**
 * Error collector for aggregation and analysis
 */
export class ErrorCollector {
  private errors: Map<string, ErrorAggregationEntry> = new Map()
  private readonly maxAggregationTime: number
  private readonly maxUniqueErrors: number

  constructor(maxAggregationTime: number = 300000, maxUniqueErrors: number = 100) {
    this.maxAggregationTime = maxAggregationTime
    this.maxUniqueErrors = maxUniqueErrors
  }

  /**
   * Add error to aggregation collection
   */
  public addError(error: PlayerError, context: string = 'unknown'): void {
    const key = `${error.code}-${error.message}`
    const now = Date.now()

    const existing = this.errors.get(key)
    if (existing) {
      this.errors.set(key, {
        ...existing,
        count: existing.count + 1,
        lastSeen: now,
        context: [...new Set([...existing.context, context])],
      })
    } else {
      // Cleanup old errors if we exceed max unique errors
      if (this.errors.size >= this.maxUniqueErrors) {
        this.cleanupOldErrors()
      }

      this.errors.set(key, {
        error,
        count: 1,
        firstSeen: now,
        lastSeen: now,
        context: [context],
      })
    }
  }

  /**
   * Get aggregated errors within time window
   */
  public getAggregatedErrors(timeWindow?: number): ErrorAggregationEntry[] {
    const cutoff = Date.now() - (timeWindow || this.maxAggregationTime)
    return Array.from(this.errors.values())
      .filter((entry) => entry.lastSeen >= cutoff)
      .sort((a, b) => b.count - a.count)
  }

  /**
   * Clear aggregated errors
   */
  public clearErrors(): void {
    this.errors.clear()
  }

  /**
   * Get error statistics
   */
  public getErrorStatistics(): {
    totalUniqueErrors: number
    totalErrorCount: number
    mostFrequentError: ErrorAggregationEntry | null
    errorsByContext: Record<string, number>
  } {
    const entries = Array.from(this.errors.values())
    const totalErrorCount = entries.reduce((sum, entry) => sum + entry.count, 0)
    const mostFrequentError =
      entries.length > 0
        ? entries.reduce((max, entry) => (entry.count > max.count ? entry : max))
        : null

    const errorsByContext: Record<string, number> = {}
    entries.forEach((entry) => {
      entry.context.forEach((ctx) => {
        errorsByContext[ctx] = (errorsByContext[ctx] || 0) + entry.count
      })
    })

    return {
      totalUniqueErrors: this.errors.size,
      totalErrorCount,
      mostFrequentError,
      errorsByContext,
    }
  }

  private cleanupOldErrors(): void {
    const cutoff = Date.now() - this.maxAggregationTime
    const toDelete: string[] = []

    this.errors.forEach((entry, key) => {
      if (entry.lastSeen < cutoff) {
        toDelete.push(key)
      }
    })

    toDelete.forEach((key) => this.errors.delete(key))
  }
}

// ========================================
// Custom Error Classes
// ========================================

/**
 * Base class for player operation errors
 */
export class PlayerOperationError extends Error {
  public readonly code: PlayerErrorCode
  public readonly severity: 'low' | 'medium' | 'high' | 'critical'
  public readonly recoverable: boolean
  public readonly retryable: boolean
  public readonly context?: string
  public readonly details?: Record<string, unknown>
  public readonly timestamp: number

  constructor(
    code: PlayerErrorCode,
    message: string,
    options: {
      severity?: 'low' | 'medium' | 'high' | 'critical'
      recoverable?: boolean
      retryable?: boolean
      context?: string
      details?: Record<string, unknown>
    } = {},
  ) {
    super(message)
    this.name = 'PlayerOperationError'
    this.code = code
    this.severity = options.severity || 'medium'
    this.recoverable = options.recoverable || false
    this.retryable = options.retryable || false
    this.context = options.context
    this.details = options.details
    this.timestamp = Date.now()
  }

  toPlayerError(): PlayerError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      severity: this.severity,
      recoverable: this.recoverable,
      retryable: this.retryable,
      context: this.context,
    }
  }
}

/**
 * Error class for validation failures
 */
export class ValidationError extends PlayerOperationError {
  public readonly field: string
  public readonly value: unknown

  constructor(
    field: string,
    value: unknown,
    message: string,
    code: PlayerErrorCode = PlayerErrorCode.INVALID_CONFIGURATION,
  ) {
    super(code, message, {
      severity: 'medium',
      recoverable: true,
      retryable: false,
      context: 'validation',
      details: { field, value },
    })
    this.name = 'ValidationError'
    this.field = field
    this.value = value
  }
}

/**
 * Error class for browser compatibility issues
 */
export class BrowserCompatibilityError extends PlayerOperationError {
  public readonly feature: string
  public readonly userAgent: string
  public readonly fallbackAvailable: boolean

  constructor(feature: string, fallbackAvailable: boolean = false, customMessage?: string) {
    const message = customMessage || `Browser does not support feature: ${feature}`
    super(PlayerErrorCode.BROWSER_COMPATIBILITY, message, {
      severity: fallbackAvailable ? 'medium' : 'high',
      recoverable: fallbackAvailable,
      retryable: false,
      context: 'browser_compatibility',
      details: { feature, fallbackAvailable, userAgent: navigator.userAgent },
    })
    this.name = 'BrowserCompatibilityError'
    this.feature = feature
    this.userAgent = navigator.userAgent
    this.fallbackAvailable = fallbackAvailable
  }
}

/**
 * Error class for network-related issues
 */
export class NetworkError extends PlayerOperationError {
  public readonly operation: string
  public readonly retryCount: number
  public readonly maxRetries: number

  constructor(
    operation: string,
    retryCount: number = 0,
    maxRetries: number = 3,
    customMessage?: string,
  ) {
    const message = customMessage || `Network operation failed: ${operation}`
    super(PlayerErrorCode.NETWORK_TIMEOUT, message, {
      severity: retryCount >= maxRetries ? 'high' : 'medium',
      recoverable: true,
      retryable: retryCount < maxRetries,
      context: 'network',
      details: { operation, retryCount, maxRetries },
    })
    this.name = 'NetworkError'
    this.operation = operation
    this.retryCount = retryCount
    this.maxRetries = maxRetries
  }
}

// ========================================
// HTMLMediaElement Abstraction Layer
// ========================================

/**
 * Configuration for the MediaElementProxy
 */
export interface MediaElementProxyConfig {
  readonly enableStrictValidation: boolean
  readonly fallbackValues: MediaElementFallbackValues
  readonly operationTimeoutMs: number
  readonly enableLogging: boolean
  readonly gracefulDegradation: boolean
}

/**
 * Fallback values when the media element is unavailable
 */
export interface MediaElementFallbackValues {
  readonly currentTime: number
  readonly duration: number
  readonly playbackRate: number
  readonly volume: number
  readonly muted: boolean
  readonly paused: boolean
  readonly ended: boolean
  readonly readyState: number
  readonly videoWidth: number
  readonly videoHeight: number
}

/**
 * Result of a media element operation
 */
export interface MediaElementOperationResult<T = void> {
  readonly success: boolean
  readonly value?: T
  readonly error?: PlayerOperationError
  readonly fallbackUsed: boolean
  readonly operationTime: number
}

/**
 * YouTube-specific media element quirks and behaviors
 */
export interface YouTubeMediaElementQuirks {
  readonly requiresUserGesture: boolean
  readonly supportsPlaybackRateRange: { min: number; max: number }
  readonly hasCustomVolumeHandling: boolean
  readonly seekingBehavior: 'standard' | 'custom' | 'restricted'
  readonly eventTimingIssues: string[]
  readonly domReplacementBehavior: 'frequent' | 'occasional' | 'rare'
}

/**
 * Default configuration for the MediaElementProxy
 */
// ========================================
// SPA Navigation and Dynamic Player Handling
// ========================================

/**
 * Navigation detection configuration
 */
export interface NavigationDetectionConfig {
  readonly enableUrlTracking: boolean
  readonly enableYouTubeEvents: boolean
  readonly enableHistoryTracking: boolean
  readonly debounceDelay: number
  readonly statePreservationTimeout: number
  readonly maxNavigationHistory: number
}

/**
 * Navigation event information
 */
export interface NavigationEvent {
  readonly type: 'url_change' | 'yt_navigate' | 'history_change' | 'dom_replace'
  readonly fromUrl?: string
  readonly toUrl?: string
  readonly videoId?: string
  readonly timestamp: number
  readonly preserveState?: boolean
  readonly metadata?: Record<string, unknown>
}

/**
 * Preserved player state during navigation
 */
export interface PreservedPlayerState {
  readonly currentTime: number
  readonly playbackRate: number
  readonly volume: number
  readonly muted: boolean
  readonly wasPlaying: boolean
  readonly subtitleTrack?: SubtitleTrack
  readonly activeLoop?: ActiveSegmentLoop
  readonly preservedAt: number
  readonly videoId?: string
}

/**
 * Navigation history entry
 */
export interface NavigationHistoryEntry {
  readonly event: NavigationEvent
  readonly playerState?: PreservedPlayerState
  readonly elementId?: string
  readonly recoveryAttempts: number
  readonly successful: boolean
}

/**
 * Navigation event callback type
 */
export type NavigationEventCallback = (event: NavigationEvent) => void

const DEFAULT_NAVIGATION_CONFIG: NavigationDetectionConfig = {
  enableUrlTracking: true,
  enableYouTubeEvents: true,
  enableHistoryTracking: true,
  debounceDelay: 300,
  statePreservationTimeout: 5000,
  maxNavigationHistory: 50,
}

// ========================================
// Default Configurations
// ========================================

export const DEFAULT_MEDIA_PROXY_CONFIG: MediaElementProxyConfig = {
  enableStrictValidation: true,
  fallbackValues: {
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    volume: 1,
    muted: false,
    paused: true,
    ended: false,
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
  },
  operationTimeoutMs: 5000,
  enableLogging: true,
  gracefulDegradation: true,
}

/**
 * Comprehensive abstraction layer for HTMLMediaElement interactions
 * Provides fallback mechanisms and YouTube-specific handling
 */
export class MediaElementProxy {
  private element: HTMLVideoElement | null = null
  private config: MediaElementProxyConfig
  private quirks: YouTubeMediaElementQuirks
  private operationCount: number = 0
  private lastOperationTime: number = 0
  private cachedProperties: Partial<MediaElementFallbackValues> = {}
  private cacheTimestamp: number = 0
  private readonly CACHE_DURATION_MS: number = 100 // Cache properties for 100ms

  constructor(config: MediaElementProxyConfig = DEFAULT_MEDIA_PROXY_CONFIG) {
    this.config = { ...config }
    this.quirks = this.detectYouTubeQuirks()
  }

  /**
   * Set the HTMLVideoElement to proxy
   */
  public setElement(element: HTMLVideoElement | null): void {
    this.element = element
    this.clearCache()

    if (this.config.enableLogging) {
      console.log('[MediaElementProxy] Element updated:', {
        hasElement: !!element,
        elementType: element?.tagName,
        readyState: element?.readyState,
        quirks: this.quirks,
      })
    }
  }

  /**
   * Get the current HTMLVideoElement
   */
  public getElement(): HTMLVideoElement | null {
    return this.element
  }

  /**
   * Check if the element is available and functional
   */
  public isElementReady(): boolean {
    return !!(
      this.element &&
      typeof this.element.play === 'function' &&
      typeof this.element.pause === 'function' &&
      !this.element.src.includes('blob:') // Avoid blob URLs that might be stale
    )
  }

  /**
   * Execute a media element operation with comprehensive error handling
   */
  public async executeOperation<T>(
    operation: () => T | Promise<T>,
    operationName: string,
    fallbackValue?: T,
  ): Promise<MediaElementOperationResult<T>> {
    const startTime = performance.now()
    this.operationCount++
    this.lastOperationTime = Date.now()

    try {
      // Check element availability
      if (!this.isElementReady()) {
        if (this.config.gracefulDegradation && fallbackValue !== undefined) {
          return {
            success: false,
            value: fallbackValue,
            error: new PlayerOperationError(
              PlayerErrorCode.VIDEO_ELEMENT_UNAVAILABLE,
              `Element unavailable for operation: ${operationName}`,
              { severity: 'medium', recoverable: true, context: 'media_proxy' },
            ),
            fallbackUsed: true,
            operationTime: performance.now() - startTime,
          }
        }

        throw new PlayerOperationError(
          PlayerErrorCode.VIDEO_ELEMENT_UNAVAILABLE,
          `No video element available for operation: ${operationName}`,
          { severity: 'high', recoverable: true, context: 'media_proxy' },
        )
      }

      // Execute operation with timeout
      const result = await this.withTimeout(operation(), this.config.operationTimeoutMs)

      if (this.config.enableLogging) {
        console.log(`[MediaElementProxy] Operation "${operationName}" succeeded:`, result)
      }

      return {
        success: true,
        value: result,
        fallbackUsed: false,
        operationTime: performance.now() - startTime,
      }
    } catch (error) {
      const operationError =
        error instanceof PlayerOperationError
          ? error
          : new PlayerOperationError(
              PlayerErrorCode.PLAYBACK_FAILED,
              `Operation failed: ${operationName} - ${error instanceof Error ? error.message : String(error)}`,
              {
                severity: 'medium',
                recoverable: true,
                context: 'media_proxy',
                details: { operationName, originalError: error },
              },
            )

      if (this.config.enableLogging) {
        console.error(`[MediaElementProxy] Operation "${operationName}" failed:`, operationError)
      }

      // Try fallback if available
      if (this.config.gracefulDegradation && fallbackValue !== undefined) {
        return {
          success: false,
          value: fallbackValue,
          error: operationError,
          fallbackUsed: true,
          operationTime: performance.now() - startTime,
        }
      }

      return {
        success: false,
        error: operationError,
        fallbackUsed: false,
        operationTime: performance.now() - startTime,
      }
    }
  }

  /**
   * Get a property value with caching and fallback
   */
  public getProperty<K extends keyof MediaElementFallbackValues>(
    property: K,
    allowCached: boolean = true,
  ): MediaElementOperationResult<MediaElementFallbackValues[K]> {
    const startTime = performance.now()

    // Check cache first
    if (allowCached && this.isCacheValid() && this.cachedProperties[property] !== undefined) {
      return {
        success: true,
        value: this.cachedProperties[property] as MediaElementFallbackValues[K],
        fallbackUsed: false,
        operationTime: performance.now() - startTime,
      }
    }

    try {
      if (!this.isElementReady()) {
        const fallbackValue = this.config.fallbackValues[property]
        return {
          success: false,
          value: fallbackValue,
          error: new PlayerOperationError(
            PlayerErrorCode.VIDEO_ELEMENT_UNAVAILABLE,
            `Element unavailable for property: ${property}`,
            { severity: 'low', recoverable: true, context: 'media_proxy' },
          ),
          fallbackUsed: true,
          operationTime: performance.now() - startTime,
        }
      }

      const value = this.getElementProperty(property)

      // Cache the value
      this.cacheProperty(property, value)

      return {
        success: true,
        value,
        fallbackUsed: false,
        operationTime: performance.now() - startTime,
      }
    } catch (error) {
      const fallbackValue = this.config.fallbackValues[property]
      const operationError = new PlayerOperationError(
        PlayerErrorCode.UNKNOWN_ERROR,
        `Failed to get property ${property}: ${error instanceof Error ? error.message : String(error)}`,
        { severity: 'low', recoverable: true, context: 'media_proxy' },
      )

      return {
        success: false,
        value: fallbackValue,
        error: operationError,
        fallbackUsed: true,
        operationTime: performance.now() - startTime,
      }
    }
  }

  /**
   * Set a property value with validation and error handling
   */
  public setProperty<
    K extends keyof Pick<
      MediaElementFallbackValues,
      'currentTime' | 'playbackRate' | 'volume' | 'muted'
    >,
  >(property: K, value: MediaElementFallbackValues[K]): MediaElementOperationResult<void> {
    const startTime = performance.now()

    try {
      if (!this.isElementReady()) {
        throw new PlayerOperationError(
          PlayerErrorCode.VIDEO_ELEMENT_UNAVAILABLE,
          `Element unavailable for setting property: ${property}`,
          { severity: 'medium', recoverable: true, context: 'media_proxy' },
        )
      }

      this.setElementProperty(property, value)

      // Update cache
      this.cacheProperty(property, value)

      if (this.config.enableLogging) {
        console.log(`[MediaElementProxy] Set property "${property}" to:`, value)
      }

      return {
        success: true,
        fallbackUsed: false,
        operationTime: performance.now() - startTime,
      }
    } catch (error) {
      const operationError =
        error instanceof PlayerOperationError
          ? error
          : new PlayerOperationError(
              PlayerErrorCode.UNKNOWN_ERROR,
              `Failed to set property ${property}: ${error instanceof Error ? error.message : String(error)}`,
              { severity: 'medium', recoverable: true, context: 'media_proxy' },
            )

      return {
        success: false,
        error: operationError,
        fallbackUsed: false,
        operationTime: performance.now() - startTime,
      }
    }
  }

  /**
   * Add event listener with error handling
   */
  public async addEventListener(
    eventType: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): Promise<MediaElementOperationResult<void>> {
    return this.executeOperation(
      () => {
        if (!this.element) {
          throw new Error('No element available')
        }
        this.element.addEventListener(eventType, listener, options)
      },
      `addEventListener(${eventType})`,
      undefined,
    )
  }

  /**
   * Remove event listener with error handling
   */
  public async removeEventListener(
    eventType: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ): Promise<MediaElementOperationResult<void>> {
    return this.executeOperation(
      () => {
        if (!this.element) {
          throw new Error('No element available')
        }
        this.element.removeEventListener(eventType, listener, options)
      },
      `removeEventListener(${eventType})`,
      undefined,
    )
  }

  /**
   * Get operation statistics
   */
  public getOperationStats(): {
    totalOperations: number
    lastOperationTime: number
    elementReady: boolean
    cacheStats: {
      isValid: boolean
      properties: string[]
      timestamp: number
    }
    quirks: YouTubeMediaElementQuirks
  } {
    return {
      totalOperations: this.operationCount,
      lastOperationTime: this.lastOperationTime,
      elementReady: this.isElementReady(),
      cacheStats: {
        isValid: this.isCacheValid(),
        properties: Object.keys(this.cachedProperties),
        timestamp: this.cacheTimestamp,
      },
      quirks: this.quirks,
    }
  }

  /**
   * Clear the property cache
   */
  public clearCache(): void {
    this.cachedProperties = {}
    this.cacheTimestamp = 0
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<MediaElementProxyConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private async withTimeout<T>(promise: Promise<T> | T, timeoutMs: number): Promise<T> {
    if (!(promise instanceof Promise)) {
      return promise
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new PlayerOperationError(
            PlayerErrorCode.OPERATION_TIMEOUT,
            `Operation timed out after ${timeoutMs}ms`,
            { severity: 'medium', recoverable: true, context: 'media_proxy' },
          ),
        )
      }, timeoutMs)

      promise
        .then((result) => {
          clearTimeout(timeoutId)
          resolve(result)
        })
        .catch((error) => {
          clearTimeout(timeoutId)
          reject(error)
        })
    })
  }

  private getElementProperty<K extends keyof MediaElementFallbackValues>(
    property: K,
  ): MediaElementFallbackValues[K] {
    if (!this.element) {
      throw new Error('No element available')
    }

    switch (property) {
      case 'currentTime':
        return (this.element.currentTime || 0) as MediaElementFallbackValues[K]
      case 'duration':
        return (this.element.duration || 0) as MediaElementFallbackValues[K]
      case 'playbackRate':
        return (this.element.playbackRate || 1) as MediaElementFallbackValues[K]
      case 'volume':
        return (this.element.volume || 0) as MediaElementFallbackValues[K]
      case 'muted':
        return (this.element.muted || false) as MediaElementFallbackValues[K]
      case 'paused':
        return (this.element.paused || true) as MediaElementFallbackValues[K]
      case 'ended':
        return (this.element.ended || false) as MediaElementFallbackValues[K]
      case 'readyState':
        return (this.element.readyState || 0) as MediaElementFallbackValues[K]
      case 'videoWidth':
        return (this.element.videoWidth || 0) as MediaElementFallbackValues[K]
      case 'videoHeight':
        return (this.element.videoHeight || 0) as MediaElementFallbackValues[K]
      default:
        throw new Error(`Unknown property: ${property}`)
    }
  }

  private setElementProperty<
    K extends keyof Pick<
      MediaElementFallbackValues,
      'currentTime' | 'playbackRate' | 'volume' | 'muted'
    >,
  >(property: K, value: MediaElementFallbackValues[K]): void {
    if (!this.element) {
      throw new Error('No element available')
    }

    switch (property) {
      case 'currentTime':
        this.element.currentTime = value as number
        break
      case 'playbackRate':
        this.element.playbackRate = value as number
        break
      case 'volume':
        this.element.volume = value as number
        break
      case 'muted':
        this.element.muted = value as boolean
        break
      default:
        throw new Error(`Cannot set property: ${property}`)
    }
  }

  private cacheProperty<K extends keyof MediaElementFallbackValues>(
    property: K,
    value: MediaElementFallbackValues[K],
  ): void {
    this.cachedProperties[property] = value
    this.cacheTimestamp = Date.now()
  }

  private isCacheValid(): boolean {
    return this.cacheTimestamp > 0 && Date.now() - this.cacheTimestamp < this.CACHE_DURATION_MS
  }

  private detectYouTubeQuirks(): YouTubeMediaElementQuirks {
    return {
      requiresUserGesture: true, // YouTube requires user interaction for play
      supportsPlaybackRateRange: { min: 0.25, max: 2.0 }, // YouTube's supported range
      hasCustomVolumeHandling: true, // YouTube has its own volume controls
      seekingBehavior: 'custom', // YouTube may have custom seeking behavior
      eventTimingIssues: [
        'timeupdate events may be throttled',
        'seeking/seeked events may fire inconsistently',
        'loadeddata event timing varies',
      ],
      domReplacementBehavior: 'frequent', // YouTube replaces video elements during navigation
    }
  }
}

/**
 * Comprehensive SPA Navigation Handler for YouTube
 * Handles all forms of navigation in YouTube's Single Page Application,
 * including URL changes, YouTube-specific navigation events, and DOM replacement scenarios
 */
export class NavigationHandler {
  private config: NavigationDetectionConfig
  private callbacks: Set<NavigationEventCallback> = new Set()
  private navigationHistory: NavigationHistoryEntry[] = []
  private currentUrl: string = window.location.href
  private currentVideoId: string | null = null
  private preservedStates: Map<string, PreservedPlayerState> = new Map()
  private debounceTimeout: number | null = null
  private isInitialized: boolean = false
  private cleanupFunctions: Array<() => void> = []

  // URL and history tracking
  private originalPushState: typeof history.pushState
  private originalReplaceState: typeof history.replaceState
  private urlObserver: MutationObserver | null = null

  // YouTube-specific event listeners
  private youTubeEventListeners: Map<string, EventListener> = new Map()

  constructor(config: NavigationDetectionConfig = DEFAULT_NAVIGATION_CONFIG) {
    this.config = { ...config }
    this.originalPushState = history.pushState.bind(history)
    this.originalReplaceState = history.replaceState.bind(history)
  }

  /**
   * Initialize navigation tracking
   */
  public initialize(): void {
    if (this.isInitialized) {
      console.warn('[NavigationHandler] Already initialized')
      return
    }

    console.log('[NavigationHandler] Initializing navigation detection')

    try {
      if (this.config.enableUrlTracking) {
        this.setupUrlTracking()
      }

      if (this.config.enableYouTubeEvents) {
        this.setupYouTubeEventTracking()
      }

      if (this.config.enableHistoryTracking) {
        this.setupHistoryTracking()
      }

      this.setupDOMObserver()
      this.currentVideoId = this.extractVideoId(this.currentUrl)
      this.isInitialized = true

      console.log('[NavigationHandler] Navigation detection initialized successfully')
    } catch (error) {
      console.error('[NavigationHandler] Initialization failed:', error)
      throw new PlayerOperationError(
        PlayerErrorCode.OBSERVER_FAILURE,
        'Failed to initialize navigation handler',
        { severity: 'high', recoverable: true, context: 'navigation_init', details: { error } },
      )
    }
  }

  /**
   * Shutdown navigation tracking and cleanup resources
   */
  public shutdown(): void {
    console.log('[NavigationHandler] Shutting down navigation detection')

    // Clear debounce timeout
    if (this.debounceTimeout !== null) {
      window.clearTimeout(this.debounceTimeout)
      this.debounceTimeout = null
    }

    // Restore original history methods
    if (this.config.enableHistoryTracking) {
      history.pushState = this.originalPushState
      history.replaceState = this.originalReplaceState
    }

    // Remove YouTube event listeners
    this.youTubeEventListeners.forEach((listener, event) => {
      window.removeEventListener(event, listener)
    })
    this.youTubeEventListeners.clear()

    // Disconnect DOM observer
    if (this.urlObserver) {
      this.urlObserver.disconnect()
      this.urlObserver = null
    }

    // Execute cleanup functions
    this.cleanupFunctions.forEach((cleanup) => {
      try {
        cleanup()
      } catch (error) {
        console.warn('[NavigationHandler] Cleanup function failed:', error)
      }
    })
    this.cleanupFunctions = []

    // Clear state
    this.callbacks.clear()
    this.navigationHistory = []
    this.preservedStates.clear()
    this.isInitialized = false

    console.log('[NavigationHandler] Navigation detection shut down successfully')
  }

  /**
   * Add navigation event callback
   */
  public addNavigationListener(callback: NavigationEventCallback): void {
    this.callbacks.add(callback)
  }

  /**
   * Remove navigation event callback
   */
  public removeNavigationListener(callback: NavigationEventCallback): void {
    this.callbacks.delete(callback)
  }

  /**
   * Get navigation history
   */
  public getNavigationHistory(): NavigationHistoryEntry[] {
    return [...this.navigationHistory]
  }

  /**
   * Preserve player state for navigation
   */
  public preservePlayerState(state: PreservedPlayerState): void {
    const videoId = state.videoId || this.currentVideoId
    if (videoId) {
      this.preservedStates.set(videoId, state)

      // Clean up old preserved states
      setTimeout(() => {
        if (this.preservedStates.has(videoId)) {
          const preservedState = this.preservedStates.get(videoId)!
          if (Date.now() - preservedState.preservedAt > this.config.statePreservationTimeout) {
            this.preservedStates.delete(videoId)
          }
        }
      }, this.config.statePreservationTimeout)
    }
  }

  /**
   * Get preserved player state for a video
   */
  public getPreservedPlayerState(videoId: string): PreservedPlayerState | null {
    return this.preservedStates.get(videoId) || null
  }

  /**
   * Clear preserved state for a video
   */
  public clearPreservedPlayerState(videoId: string): void {
    this.preservedStates.delete(videoId)
  }

  /**
   * Get current video ID
   */
  public getCurrentVideoId(): string | null {
    return this.currentVideoId
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<NavigationDetectionConfig>): void {
    const requiresReinitialization =
      (newConfig.enableUrlTracking !== undefined &&
        newConfig.enableUrlTracking !== this.config.enableUrlTracking) ||
      (newConfig.enableYouTubeEvents !== undefined &&
        newConfig.enableYouTubeEvents !== this.config.enableYouTubeEvents) ||
      (newConfig.enableHistoryTracking !== undefined &&
        newConfig.enableHistoryTracking !== this.config.enableHistoryTracking)

    this.config = { ...this.config, ...newConfig }

    if (requiresReinitialization && this.isInitialized) {
      console.log('[NavigationHandler] Configuration changed, reinitializing...')
      this.shutdown()
      this.initialize()
    }
  }

  /**
   * Force detection of navigation change
   */
  public detectNavigationChange(): void {
    const newUrl = window.location.href
    if (newUrl !== this.currentUrl) {
      this.handleUrlChange(this.currentUrl, newUrl)
    }
  }

  /**
   * Setup URL tracking via multiple methods
   */
  private setupUrlTracking(): void {
    // Track via mutation observer on document title and URL bar
    this.urlObserver = new MutationObserver(() => {
      this.debouncedUrlCheck()
    })

    this.urlObserver.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['href', 'src'],
    })

    // Track via periodic checking
    const urlCheckInterval = setInterval(() => {
      this.debouncedUrlCheck()
    }, 1000)

    this.cleanupFunctions.push(() => {
      clearInterval(urlCheckInterval)
    })
  }

  /**
   * Setup YouTube-specific event tracking
   */
  private setupYouTubeEventTracking(): void {
    // YouTube navigation events
    const youtubeEvents = [
      'yt-navigate-start',
      'yt-navigate-finish',
      'yt-page-data-updated',
      'yt-navigate-redirect',
      'spfdone', // Legacy SPFJS navigation
      'yt-spf-done',
    ]

    youtubeEvents.forEach((eventType) => {
      const listener = (event: Event) => {
        this.handleYouTubeNavigationEvent(eventType, event)
      }

      window.addEventListener(eventType, listener)
      this.youTubeEventListeners.set(eventType, listener)
    })

    // YouTube player state events that might indicate navigation
    const playerEvents = ['yt-player-updated', 'yt-load-start', 'video-data-change']

    playerEvents.forEach((eventType) => {
      const listener = (event: Event) => {
        this.debouncedNavigationCheck(() => {
          this.handleYouTubePlayerEvent(eventType, event)
        })
      }

      window.addEventListener(eventType, listener)
      this.youTubeEventListeners.set(eventType, listener)
    })
  }

  /**
   * Setup browser history API tracking
   */
  private setupHistoryTracking(): void {
    // Override history methods
    history.pushState = (...args) => {
      const result = this.originalPushState.apply(history, args)
      this.debouncedUrlCheck()
      return result
    }

    history.replaceState = (...args) => {
      const result = this.originalReplaceState.apply(history, args)
      this.debouncedUrlCheck()
      return result
    }

    // Listen for popstate events
    const popstateListener = () => {
      this.debouncedUrlCheck()
    }

    window.addEventListener('popstate', popstateListener)
    this.cleanupFunctions.push(() => {
      window.removeEventListener('popstate', popstateListener)
    })
  }

  /**
   * Setup DOM observer for element replacement detection
   */
  private setupDOMObserver(): void {
    const observer = new MutationObserver((mutations) => {
      let hasSignificantChange = false

      for (const mutation of mutations) {
        // Check for video element removal/addition
        if (mutation.type === 'childList') {
          const removedNodes = Array.from(mutation.removedNodes)
          const addedNodes = Array.from(mutation.addedNodes)

          const hasVideoChange = [
            ...removedNodes.filter((node) => node.nodeType === Node.ELEMENT_NODE),
            ...addedNodes.filter((node) => node.nodeType === Node.ELEMENT_NODE),
          ].some((element) => {
            return (
              (element as Element).tagName === 'VIDEO' ||
              (element as Element).querySelector?.('video') !== null
            )
          })

          if (hasVideoChange) {
            hasSignificantChange = true
            break
          }
        }
      }

      if (hasSignificantChange) {
        this.debouncedNavigationCheck(() => {
          this.emitNavigationEvent({
            type: 'dom_replace',
            fromUrl: this.currentUrl,
            toUrl: window.location.href,
            videoId: this.extractVideoId(window.location.href) || undefined,
            timestamp: Date.now(),
            preserveState: true,
            metadata: { trigger: 'dom_mutation' },
          })
        })
      }
    })

    // Observe the main container for video content
    const targetNode =
      document.getElementById('page-manager') || document.getElementById('content') || document.body

    observer.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: false,
    })

    this.cleanupFunctions.push(() => {
      observer.disconnect()
    })
  }

  /**
   * Debounced URL change detection
   */
  private debouncedUrlCheck(): void {
    if (this.debounceTimeout !== null) {
      window.clearTimeout(this.debounceTimeout)
    }

    this.debounceTimeout = window.setTimeout(() => {
      const newUrl = window.location.href
      if (newUrl !== this.currentUrl) {
        this.handleUrlChange(this.currentUrl, newUrl)
      }
      this.debounceTimeout = null
    }, this.config.debounceDelay)
  }

  /**
   * Debounced navigation check with custom callback
   */
  private debouncedNavigationCheck(callback: () => void): void {
    if (this.debounceTimeout !== null) {
      window.clearTimeout(this.debounceTimeout)
    }

    this.debounceTimeout = window.setTimeout(() => {
      callback()
      this.debounceTimeout = null
    }, this.config.debounceDelay)
  }

  /**
   * Handle URL changes
   */
  private handleUrlChange(fromUrl: string, toUrl: string): void {
    const fromVideoId = this.extractVideoId(fromUrl)
    const toVideoId = this.extractVideoId(toUrl)

    this.currentUrl = toUrl
    this.currentVideoId = toVideoId

    this.emitNavigationEvent({
      type: 'url_change',
      fromUrl,
      toUrl,
      videoId: toVideoId || undefined,
      timestamp: Date.now(),
      preserveState: fromVideoId !== toVideoId,
      metadata: {
        fromVideoId,
        toVideoId,
        sameVideo: fromVideoId === toVideoId,
      },
    })
  }

  /**
   * Handle YouTube-specific navigation events
   */
  private handleYouTubeNavigationEvent(eventType: string, event: Event): void {
    this.debouncedNavigationCheck(() => {
      const videoId = this.extractVideoId(window.location.href)

      this.emitNavigationEvent({
        type: 'yt_navigate',
        fromUrl: this.currentUrl,
        toUrl: window.location.href,
        videoId: videoId || undefined,
        timestamp: Date.now(),
        preserveState: this.currentVideoId !== videoId,
        metadata: {
          eventType,
          eventDetails: event,
          previousVideoId: this.currentVideoId,
        },
      })

      this.currentUrl = window.location.href
      this.currentVideoId = videoId
    })
  }

  /**
   * Handle YouTube player events that might indicate navigation
   */
  private handleYouTubePlayerEvent(eventType: string, event: Event): void {
    const videoId = this.extractVideoId(window.location.href)

    if (videoId && videoId !== this.currentVideoId) {
      this.emitNavigationEvent({
        type: 'yt_navigate',
        fromUrl: this.currentUrl,
        toUrl: window.location.href,
        videoId,
        timestamp: Date.now(),
        preserveState: true,
        metadata: {
          eventType,
          eventDetails: event,
          trigger: 'player_event',
        },
      })

      this.currentUrl = window.location.href
      this.currentVideoId = videoId
    }
  }

  /**
   * Emit navigation event to all listeners
   */
  private emitNavigationEvent(event: NavigationEvent): void {
    let callbackSuccess = true

    // Notify all callbacks
    this.callbacks.forEach((callback) => {
      try {
        callback(event)
      } catch (error) {
        console.error('[NavigationHandler] Navigation callback failed:', error)
        callbackSuccess = false
      }
    })

    // Add to history with final success status
    const historyEntry: NavigationHistoryEntry = {
      event,
      recoveryAttempts: 0,
      successful: callbackSuccess,
    }

    this.navigationHistory.push(historyEntry)

    // Limit history size
    if (this.navigationHistory.length > this.config.maxNavigationHistory) {
      this.navigationHistory = this.navigationHistory.slice(-this.config.maxNavigationHistory)
    }

    console.log('[NavigationHandler] Navigation event emitted:', {
      type: event.type,
      fromUrl: event.fromUrl?.substring(0, 100),
      toUrl: event.toUrl?.substring(0, 100),
      videoId: event.videoId,
      preserveState: event.preserveState,
    })
  }

  /**
   * Extract video ID from YouTube URL
   */
  private extractVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url)

      // Standard watch URL: youtube.com/watch?v=VIDEO_ID
      if (urlObj.pathname === '/watch') {
        return urlObj.searchParams.get('v')
      }

      // Short URL: youtu.be/VIDEO_ID
      if (urlObj.hostname === 'youtu.be') {
        return urlObj.pathname.substring(1)
      }

      // Embed URL: youtube.com/embed/VIDEO_ID
      if (urlObj.pathname.startsWith('/embed/')) {
        return urlObj.pathname.substring(7)
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Get statistics about navigation handling
   */
  public getNavigationStats(): {
    totalNavigations: number
    navigationsByType: Record<string, number>
    preservedStateCount: number
    averageNavigationsPerMinute: number
    lastNavigationTime: number
  } {
    const now = Date.now()
    const navigationsByType: Record<string, number> = {}
    let lastNavigationTime = 0

    this.navigationHistory.forEach((entry) => {
      const type = entry.event.type
      navigationsByType[type] = (navigationsByType[type] || 0) + 1
      lastNavigationTime = Math.max(lastNavigationTime, entry.event.timestamp)
    })

    const oldestNavigation = this.navigationHistory[0]?.event.timestamp || now
    const timeSpanMinutes = (now - oldestNavigation) / (1000 * 60)
    const averageNavigationsPerMinute =
      timeSpanMinutes > 0 ? this.navigationHistory.length / timeSpanMinutes : 0

    return {
      totalNavigations: this.navigationHistory.length,
      navigationsByType,
      preservedStateCount: this.preservedStates.size,
      averageNavigationsPerMinute,
      lastNavigationTime,
    }
  }
}

// ========================================
// Player Interaction Service Implementation
// ========================================

/**
 * YouTube Player Interaction Service
 * Handles all direct interactions with the YouTube HTML5 video player
 */
export class PlayerInteractionService {
  private static instance: PlayerInteractionService | null = null

  private videoElement: HTMLVideoElement | null = null
  private mutationObserver: MutationObserver | null = null
  private eventListeners: Map<string, Set<PlayerEventCallback>> = new Map()
  private playerChangeListeners: Set<PlayerChangeCallback> = new Set()
  private stateChangeListeners: Set<PlayerStateChangeCallback> = new Set()
  private config: PlayerInteractionConfig
  private stateTrackingConfig: StateTrackingConfig
  private isInitialized: boolean = false
  private lastKnownState: PlayerStateInfo | null = null
  private previousState: PlayerStateInfo | null = null
  private stateHistory: PlayerStateHistoryEntry[] = []
  private stateTransitionStartTime: number = 0
  private retryTimeoutId: number | null = null
  private stateUpdateThrottleId: number | null = null

  // Subtitle synchronization properties
  private subtitleSyncConfig: SubtitleSyncConfig
  private currentSubtitleTrack: SubtitleTrack | null = null
  private activeCues: ActiveSubtitleCue[] = []
  private subtitleSyncListeners: Set<SubtitleSyncCallback> = new Set()
  private lastSyncTime: number = 0
  private syncUpdateIntervalId: number | null = null
  private timingAdjustmentHistory: Array<{ time: number; adjustment: number }> = []

  // Segment looping properties
  private segmentLoopConfig: SegmentLoopConfig
  private activeLoop: ActiveSegmentLoop | null = null
  private segmentLoopListeners: Set<SegmentLoopCallback> = new Set()
  private loopMonitorIntervalId: number | null = null
  private userSeekDetected: boolean = false
  private lastLoopSeekTime: number = 0
  private loopSeekTimeoutId: number | null = null

  // Enhanced error handling properties
  private errorRecoveryConfig: ErrorRecoveryConfig
  private errorCollector: ErrorCollector
  private errorMetrics: ErrorMetrics
  private browserCompatibility: BrowserCompatibility
  private circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed'
  private circuitBreakerFailureCount: number = 0
  private circuitBreakerLastFailureTime: number = 0
  private retryQueues: Map<string, Array<{ operation: () => Promise<any>; retryCount: number }>> =
    new Map()
  private operationTimeouts: Map<string, number> = new Map()
  private startTime: number = Date.now()

  // HTMLMediaElement abstraction layer
  private mediaProxy: MediaElementProxy

  private constructor(
    config: PlayerInteractionConfig = DEFAULT_PLAYER_CONFIG,
    stateTrackingConfig: StateTrackingConfig = DEFAULT_STATE_TRACKING_CONFIG,
    subtitleSyncConfig: SubtitleSyncConfig = DEFAULT_SUBTITLE_SYNC_CONFIG,
    segmentLoopConfig: SegmentLoopConfig = DEFAULT_SEGMENT_LOOP_CONFIG,
  ) {
    this.config = { ...config }
    this.stateTrackingConfig = { ...stateTrackingConfig }
    this.subtitleSyncConfig = { ...subtitleSyncConfig }
    this.segmentLoopConfig = { ...segmentLoopConfig }

    // Initialize error handling
    this.errorRecoveryConfig = { ...DEFAULT_ERROR_RECOVERY_CONFIG }
    this.errorCollector = new ErrorCollector()
    this.errorMetrics = {
      totalErrors: 0,
      errorsByCode: {} as Record<PlayerErrorCode, number>,
      errorsBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
      averageErrorsPerMinute: 0,
      lastErrorTime: 0,
      uptime: Date.now() - this.startTime,
    }
    this.browserCompatibility = this.detectBrowserCompatibility()

    this.setupMutationObserver()
    this.mediaProxy = new MediaElementProxy()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(
    config?: PlayerInteractionConfig,
    stateTrackingConfig?: StateTrackingConfig,
    subtitleSyncConfig?: SubtitleSyncConfig,
    segmentLoopConfig?: SegmentLoopConfig,
  ): PlayerInteractionService {
    if (!PlayerInteractionService.instance) {
      PlayerInteractionService.instance = new PlayerInteractionService(
        config,
        stateTrackingConfig,
        subtitleSyncConfig,
        segmentLoopConfig,
      )
    }
    return PlayerInteractionService.instance
  }

  /**
   * Initialize the service and start monitoring for video elements
   */
  public async initialize(): Promise<boolean> {
    try {
      console.log('[PlayerInteractionService] Initializing...')

      this.isInitialized = true

      // Start observing DOM changes
      this.startObserving()

      // Try to find existing video element
      const foundElement = await this.findVideoElement()
      if (foundElement) {
        await this.setVideoElement(foundElement)
        return true
      }

      // If not found, wait for it to appear
      return this.waitForVideoElement()
    } catch (error) {
      console.error('[PlayerInteractionService] Initialization failed:', error)
      this.notifyError(PlayerErrorCode.UNKNOWN_ERROR, 'Failed to initialize player service', {
        error,
      })
      return false
    }
  }

  /**
   * Shutdown the service and clean up resources
   */
  public async shutdown(): Promise<void> {
    console.log('[PlayerInteractionService] Shutting down...')

    this.isInitialized = false

    // Clear retry timeout
    if (this.retryTimeoutId !== null) {
      window.clearTimeout(this.retryTimeoutId)
      this.retryTimeoutId = null
    }

    // Clear state update throttle
    if (this.stateUpdateThrottleId !== null) {
      window.clearTimeout(this.stateUpdateThrottleId)
      this.stateUpdateThrottleId = null
    }

    // Clear subtitle sync interval
    if (this.syncUpdateIntervalId !== null) {
      window.clearInterval(this.syncUpdateIntervalId)
      this.syncUpdateIntervalId = null
    }

    // Clear segment loop monitoring
    if (this.loopMonitorIntervalId !== null) {
      window.clearInterval(this.loopMonitorIntervalId)
      this.loopMonitorIntervalId = null
    }

    // Clear loop seek timeout
    if (this.loopSeekTimeoutId !== null) {
      window.clearTimeout(this.loopSeekTimeoutId)
      this.loopSeekTimeoutId = null
    }

    // Stop observing
    this.stopObserving()

    // Remove all event listeners
    this.removeAllEventListeners()

    // Clear video element reference
    await this.setVideoElement(null)

    // Clear listeners
    this.eventListeners.clear()
    this.playerChangeListeners.clear()
    this.stateChangeListeners.clear()
    this.subtitleSyncListeners.clear()
    this.segmentLoopListeners.clear()

    // Clear state tracking
    this.lastKnownState = null
    this.previousState = null
    this.stateHistory = []
    this.stateTransitionStartTime = 0

    // Clear subtitle synchronization
    this.currentSubtitleTrack = null
    this.activeCues = []
    this.lastSyncTime = 0
    this.timingAdjustmentHistory = []

    // Clear segment looping
    this.activeLoop = null
    this.userSeekDetected = false
    this.lastLoopSeekTime = 0
  }

  // ========================================
  // Video Element Detection and Management
  // ========================================

  /**
   * Find the YouTube video element using configured selectors
   */
  private async findVideoElement(): Promise<HTMLVideoElement | null> {
    for (const selector of this.config.videoElementSelectors) {
      try {
        const element = document.querySelector(selector) as HTMLVideoElement
        if (element && this.isValidVideoElement(element)) {
          console.log(`[PlayerInteractionService] Found video element with selector: ${selector}`)
          return element
        }
      } catch (error) {
        console.warn(`[PlayerInteractionService] Error with selector "${selector}":`, error)
      }
    }

    return null
  }

  /**
   * Validate that an element is a proper video element
   */
  private isValidVideoElement(element: HTMLVideoElement): boolean {
    return (
      element instanceof HTMLVideoElement &&
      element.tagName.toLowerCase() === 'video' &&
      typeof element.play === 'function' &&
      typeof element.pause === 'function' &&
      !isNaN(element.duration) &&
      element.duration > 0
    )
  }

  /**
   * Wait for video element to appear with retry logic
   */
  private async waitForVideoElement(): Promise<boolean> {
    return new Promise((resolve) => {
      let attempts = 0

      const tryFind = async () => {
        attempts++
        console.log(
          `[PlayerInteractionService] Attempt ${attempts}/${this.config.retryAttempts} to find video element`,
        )

        const element = await this.findVideoElement()
        if (element) {
          await this.setVideoElement(element)
          resolve(true)
          return
        }

        if (attempts >= this.config.retryAttempts) {
          console.warn('[PlayerInteractionService] Max retry attempts reached')
          this.notifyError(
            PlayerErrorCode.VIDEO_ELEMENT_NOT_FOUND,
            'Video element not found after maximum retry attempts',
            { attempts },
          )
          resolve(false)
          return
        }

        // Schedule next attempt
        this.retryTimeoutId = window.setTimeout(tryFind, this.config.retryDelay)
      }

      // Start first attempt
      tryFind()
    })
  }

  /**
   * Set the current video element and manage event listeners
   */
  private async setVideoElement(element: HTMLVideoElement | null): Promise<void> {
    // Remove listeners from old element
    if (this.videoElement) {
      await this.removeVideoElementListeners()
    }

    const previousElement = this.videoElement
    this.videoElement = element

    // Update the media proxy with the new element
    this.mediaProxy.setElement(element)

    // Add listeners to new element
    if (this.videoElement) {
      await this.addVideoElementListeners()
      this.updatePlayerState()
      console.log('[PlayerInteractionService] Video element set and ready, proxy updated')
    } else {
      this.lastKnownState = null
      console.log('[PlayerInteractionService] Video element cleared, proxy cleared')
    }

    // Notify listeners of change
    this.notifyPlayerChange(element)
  }

  // ========================================
  // MutationObserver Setup
  // ========================================

  /**
   * Setup MutationObserver to detect DOM changes
   */
  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      this.handleMutations(mutations)
    })
  }

  /**
   * Start observing DOM changes
   */
  private startObserving(): void {
    if (!this.mutationObserver || !this.isInitialized) return

    try {
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
        attributeOldValue: false,
        characterData: false,
        characterDataOldValue: false,
      })

      console.log('[PlayerInteractionService] Started observing DOM changes')
    } catch (error) {
      console.error('[PlayerInteractionService] Failed to start observing:', error)
    }
  }

  /**
   * Stop observing DOM changes
   */
  private stopObserving(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      console.log('[PlayerInteractionService] Stopped observing DOM changes')
    }
  }

  /**
   * Handle mutation observer changes
   */
  private handleMutations(mutations: MutationRecord[]): void {
    let shouldCheckForVideoElement = false

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        // Check if video-related nodes were added or removed
        const addedNodes = Array.from(mutation.addedNodes)
        const removedNodes = Array.from(mutation.removedNodes)

        const hasVideoNodes = [...addedNodes, ...removedNodes].some(
          (node) =>
            node.nodeType === Node.ELEMENT_NODE &&
            ((node as Element).tagName?.toLowerCase() === 'video' ||
              (node as Element).querySelector?.('video') ||
              (node as Element).closest?.('#movie_player, .html5-video-player')),
        )

        if (hasVideoNodes) {
          shouldCheckForVideoElement = true
          break
        }
      }
    }

    if (shouldCheckForVideoElement) {
      // Debounce rapid changes
      clearTimeout(this.retryTimeoutId || 0)
      this.retryTimeoutId = window.setTimeout(() => {
        this.recheckVideoElement()
      }, 100)
    }
  }

  /**
   * Recheck for video element after DOM changes
   */
  private async recheckVideoElement(): Promise<void> {
    if (!this.isInitialized) return

    console.log('[PlayerInteractionService] Rechecking video element due to DOM changes')

    const currentElement = await this.findVideoElement()

    // If we found a different element or lost the current one
    if (currentElement !== this.videoElement) {
      if (currentElement && !this.videoElement) {
        console.log('[PlayerInteractionService] Video element appeared')
        await this.setVideoElement(currentElement)
      } else if (!currentElement && this.videoElement) {
        console.log('[PlayerInteractionService] Video element disappeared')
        await this.setVideoElement(null)
      } else if (currentElement && this.videoElement && currentElement !== this.videoElement) {
        console.log('[PlayerInteractionService] Video element replaced')
        await this.setVideoElement(currentElement)
      }
    }
  }

  // ========================================
  // Event Management
  // ========================================

  /**
   * Add event listeners to the current video element via MediaElementProxy
   */
  private async addVideoElementListeners(): Promise<void> {
    if (!this.videoElement || !this.mediaProxy.isElementReady()) return

    // Add listeners for all registered events using proxy
    for (const [eventType, callbacks] of this.eventListeners) {
      const result = await this.mediaProxy.addEventListener(
        eventType,
        this.createEventHandler(eventType),
      )
      if (!result.success && result.error) {
        console.warn(
          `[PlayerInteractionService] Failed to add listener for ${eventType}:`,
          result.error.message,
        )
      }
    }

    // Add state tracking listeners if enabled
    if (this.config.enableStateTracking) {
      const stateEvents = [
        PlayerEvent.TIME_UPDATE,
        PlayerEvent.DURATION_CHANGE,
        PlayerEvent.RATE_CHANGE,
        PlayerEvent.VOLUME_CHANGE,
        PlayerEvent.PLAY,
        PlayerEvent.PAUSE,
        PlayerEvent.ENDED,
        PlayerEvent.SEEKING,
        PlayerEvent.SEEKED,
        PlayerEvent.WAITING,
        PlayerEvent.PLAYING,
        PlayerEvent.LOADED_DATA,
        PlayerEvent.LOADED_METADATA,
        PlayerEvent.CAN_PLAY,
        PlayerEvent.CAN_PLAY_THROUGH,
      ]

      for (const eventType of stateEvents) {
        const stateListener = () => {
          // Use throttled updates for high-frequency events like timeupdate
          if (eventType === PlayerEvent.TIME_UPDATE && this.stateTrackingConfig.trackTimeUpdates) {
            this.throttledUpdatePlayerState(eventType)
          } else {
            this.updatePlayerState(eventType)
          }
        }

        const result = await this.mediaProxy.addEventListener(eventType, stateListener)
        if (!result.success && result.error) {
          console.warn(
            `[PlayerInteractionService] Failed to add state listener for ${eventType}:`,
            result.error.message,
          )
        }
      }
    }
  }

  /**
   * Remove event listeners from the current video element via MediaElementProxy
   */
  private async removeVideoElementListeners(): Promise<void> {
    if (!this.videoElement) return

    // Remove all event listeners using proxy
    for (const eventType of this.eventListeners.keys()) {
      const result = await this.mediaProxy.removeEventListener(
        eventType,
        this.createEventHandler(eventType),
      )
      if (!result.success && result.error) {
        console.warn(
          `[PlayerInteractionService] Failed to remove listener for ${eventType}:`,
          result.error.message,
        )
      }
    }
  }

  /**
   * Create an event handler for a specific event type
   */
  private createEventHandler(eventType: string) {
    return (event: Event) => {
      const callbacks = this.eventListeners.get(eventType)
      if (!callbacks) return

      const playerState = this.lastKnownState

      // Call all registered callbacks
      callbacks.forEach((callback) => {
        try {
          callback(event, playerState || undefined)
        } catch (error) {
          console.error(
            `[PlayerInteractionService] Error in event callback for ${eventType}:`,
            error,
          )
        }
      })
    }
  }

  /**
   * Remove all event listeners
   */
  private removeAllEventListeners(): void {
    if (this.videoElement) {
      this.removeVideoElementListeners()
    }
  }

  /**
   * Update cached player state with change detection
   */
  private updatePlayerState(trigger?: string): void {
    if (!this.videoElement) {
      this.lastKnownState = null
      this.previousState = null
      return
    }

    try {
      const currentState = this.determinePlayerState()
      const currentMetadata = this.getPlayerMetadata()
      const timestamp = Date.now()

      const newStateInfo: PlayerStateInfo = {
        state: currentState,
        metadata: currentMetadata,
        timestamp,
      }

      // Check if this is a significant state change
      const changes = this.compareStates(this.lastKnownState, newStateInfo)
      const hasSignificantChanges = this.hasSignificantChanges(changes)

      if (hasSignificantChanges || !this.lastKnownState) {
        // Store previous state for transition tracking
        this.previousState = this.lastKnownState

        // Create state transition if we have a previous state
        let transition: PlayerStateTransition | undefined
        if (this.previousState && this.previousState.state !== currentState) {
          const duration =
            timestamp - (this.stateTransitionStartTime || this.previousState.timestamp)
          transition = {
            from: this.previousState.state,
            to: currentState,
            duration,
            trigger,
          }
          this.stateTransitionStartTime = timestamp
        } else if (!this.previousState) {
          this.stateTransitionStartTime = timestamp
        }

        // Update current state
        this.lastKnownState = newStateInfo

        // Add to history if enabled
        if (this.stateTrackingConfig.enableStateHistory && transition) {
          this.addToStateHistory(newStateInfo, changes, transition)
        }

        // Notify state change listeners
        if (this.stateChangeListeners.size > 0) {
          this.notifyStateChange(newStateInfo, this.previousState, changes)
        }

        console.log(`[PlayerInteractionService] State changed to ${PlayerState[currentState]}`, {
          changes,
          transition,
          trigger,
        })
      }
    } catch (error) {
      console.error('[PlayerInteractionService] Failed to update player state:', error)
    }
  }

  /**
   * Throttled state update to prevent excessive change notifications
   */
  private throttledUpdatePlayerState(trigger?: string): void {
    if (this.stateUpdateThrottleId !== null) {
      return // Already scheduled
    }

    this.stateUpdateThrottleId = window.setTimeout(() => {
      this.updatePlayerState(trigger)
      this.stateUpdateThrottleId = null
    }, this.config.throttleEventInterval)
  }

  /**
   * Compare two player states and return what changed
   */
  private compareStates(
    previousState: PlayerStateInfo | null,
    currentState: PlayerStateInfo,
  ): PlayerStateChanges {
    if (!previousState) {
      return {
        stateChanged: true,
        timeChanged: true,
        durationChanged: true,
        rateChanged: true,
        volumeChanged: true,
        muteChanged: true,
        dimensionsChanged: true,
        readyStateChanged: true,
      }
    }

    const prev = previousState.metadata
    const curr = currentState.metadata

    return {
      stateChanged: previousState.state !== currentState.state,
      timeChanged:
        this.stateTrackingConfig.trackTimeUpdates &&
        Math.abs(prev.currentTime - curr.currentTime) >=
          this.stateTrackingConfig.stateChangeThreshold,
      durationChanged: prev.duration !== curr.duration,
      rateChanged: prev.playbackRate !== curr.playbackRate,
      volumeChanged: this.stateTrackingConfig.trackVolumeChanges && prev.volume !== curr.volume,
      muteChanged: prev.muted !== curr.muted,
      dimensionsChanged:
        this.stateTrackingConfig.trackDimensionChanges &&
        (prev.videoWidth !== curr.videoWidth || prev.videoHeight !== curr.videoHeight),
      readyStateChanged: prev.readyState !== curr.readyState,
    }
  }

  /**
   * Determine if changes are significant enough to trigger notifications
   */
  private hasSignificantChanges(changes: PlayerStateChanges): boolean {
    return (
      changes.stateChanged ||
      changes.durationChanged ||
      changes.rateChanged ||
      changes.muteChanged ||
      changes.readyStateChanged ||
      (this.stateTrackingConfig.trackTimeUpdates && changes.timeChanged) ||
      (this.stateTrackingConfig.trackVolumeChanges && changes.volumeChanged) ||
      (this.stateTrackingConfig.trackDimensionChanges && changes.dimensionsChanged)
    )
  }

  /**
   * Add entry to state history
   */
  private addToStateHistory(
    state: PlayerStateInfo,
    changes: PlayerStateChanges,
    transition: PlayerStateTransition,
  ): void {
    const historyEntry: PlayerStateHistoryEntry = {
      state,
      changes,
      transition,
    }

    this.stateHistory.push(historyEntry)

    // Limit history size
    if (this.stateHistory.length > this.stateTrackingConfig.maxHistoryEntries) {
      this.stateHistory.shift() // Remove oldest entry
    }
  }

  /**
   * Notify state change listeners
   */
  private notifyStateChange(
    newState: PlayerStateInfo,
    previousState: PlayerStateInfo | null,
    changes: PlayerStateChanges,
  ): void {
    this.stateChangeListeners.forEach((callback) => {
      try {
        callback(newState, previousState, changes)
      } catch (error) {
        console.error('[PlayerInteractionService] Error in state change callback:', error)
      }
    })
  }

  /**
   * Determine current player state
   */
  private determinePlayerState(): PlayerState {
    if (!this.videoElement) return PlayerState.UNKNOWN

    const endedResult = this.mediaProxy.getProperty('ended')
    const pausedResult = this.mediaProxy.getProperty('paused')
    const readyStateResult = this.mediaProxy.getProperty('readyState')

    if (endedResult.success && endedResult.value) return PlayerState.ENDED
    if (pausedResult.success && pausedResult.value) return PlayerState.PAUSED
    if (
      readyStateResult.success &&
      readyStateResult.value !== undefined &&
      readyStateResult.value < 3
    )
      return PlayerState.BUFFERING
    if (pausedResult.success && !pausedResult.value && endedResult.success && !endedResult.value)
      return PlayerState.PLAYING

    return PlayerState.UNKNOWN
  }

  /**
   * Get current player metadata
   */
  private getPlayerMetadata(): PlayerMetadata {
    if (!this.videoElement) {
      throw new Error('Video element not available')
    }

    const currentTimeResult = this.mediaProxy.getProperty('currentTime')
    const durationResult = this.mediaProxy.getProperty('duration')
    const playbackRateResult = this.mediaProxy.getProperty('playbackRate')
    const volumeResult = this.mediaProxy.getProperty('volume')
    const mutedResult = this.mediaProxy.getProperty('muted')
    const pausedResult = this.mediaProxy.getProperty('paused')
    const endedResult = this.mediaProxy.getProperty('ended')
    const readyStateResult = this.mediaProxy.getProperty('readyState')
    const videoWidthResult = this.mediaProxy.getProperty('videoWidth')
    const videoHeightResult = this.mediaProxy.getProperty('videoHeight')

    return {
      currentTime: currentTimeResult.success ? (currentTimeResult.value ?? 0) : 0,
      duration: durationResult.success ? (durationResult.value ?? 0) : 0,
      playbackRate: playbackRateResult.success ? (playbackRateResult.value ?? 1) : 1,
      volume: volumeResult.success ? (volumeResult.value ?? 0) : 0,
      muted: mutedResult.success ? (mutedResult.value ?? false) : false,
      paused: pausedResult.success ? (pausedResult.value ?? true) : true,
      ended: endedResult.success ? (endedResult.value ?? false) : false,
      readyState: readyStateResult.success ? (readyStateResult.value ?? 0) : 0,
      buffered: this.videoElement.buffered,
      seekable: this.videoElement.seekable,
      videoWidth: videoWidthResult.success ? (videoWidthResult.value ?? 0) : 0,
      videoHeight: videoHeightResult.success ? (videoHeightResult.value ?? 0) : 0,
    }
  }

  // ========================================
  // Notification Methods
  // ========================================

  /**
   * Notify listeners of player changes
   */
  private notifyPlayerChange(videoElement: HTMLVideoElement | null): void {
    this.playerChangeListeners.forEach((callback) => {
      try {
        callback(videoElement)
      } catch (error) {
        console.error('[PlayerInteractionService] Error in player change callback:', error)
      }
    })
  }

  /**
   * Notify listeners of errors
   */
  private notifyError(
    code: PlayerErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): void {
    const error: PlayerError = {
      code,
      message,
      details,
      timestamp: Date.now(),
      severity: 'medium',
      recoverable: true,
      retryable: true,
      context: 'unknown',
    }

    console.error('[PlayerInteractionService]', error)

    this.playerChangeListeners.forEach((callback) => {
      try {
        callback(null, error)
      } catch (callbackError) {
        console.error('[PlayerInteractionService] Error in error callback:', callbackError)
      }
    })
  }

  // ========================================
  // Public API Methods
  // ========================================

  /**
   * Check if service is ready for use
   */
  public isReady(): boolean {
    return this.isInitialized && this.videoElement !== null
  }

  /**
   * Get current video element
   */
  public getVideoElement(): HTMLVideoElement | null {
    return this.videoElement
  }

  /**
   * Get current player state
   */
  public getCurrentState(): PlayerStateInfo | null {
    this.updatePlayerState()
    return this.lastKnownState
  }

  /**
   * Add listener for player changes
   */
  public addPlayerChangeListener(callback: PlayerChangeCallback): void {
    this.playerChangeListeners.add(callback)
  }

  /**
   * Remove listener for player changes
   */
  public removePlayerChangeListener(callback: PlayerChangeCallback): void {
    this.playerChangeListeners.delete(callback)
  }

  /**
   * Add listener for player state changes
   */
  public addStateChangeListener(callback: PlayerStateChangeCallback): void {
    this.stateChangeListeners.add(callback)
    console.log('[PlayerInteractionService] State change listener added')
  }

  /**
   * Remove listener for player state changes
   */
  public removeStateChangeListener(callback: PlayerStateChangeCallback): void {
    this.stateChangeListeners.delete(callback)
    console.log('[PlayerInteractionService] State change listener removed')
  }

  /**
   * Remove all state change listeners
   */
  public removeAllStateChangeListeners(): void {
    this.stateChangeListeners.clear()
    console.log('[PlayerInteractionService] All state change listeners removed')
  }

  /**
   * Get the previous player state
   */
  public getPreviousState(): PlayerStateInfo | null {
    return this.previousState
  }

  /**
   * Get state change history
   */
  public getStateHistory(): PlayerStateHistoryEntry[] {
    return [...this.stateHistory] // Return copy to prevent external modifications
  }

  /**
   * Clear state history
   */
  public clearStateHistory(): void {
    this.stateHistory = []
    console.log('[PlayerInteractionService] State history cleared')
  }

  /**
   * Get state transitions for a specific time range
   */
  public getStateTransitions(startTime?: number, endTime?: number): PlayerStateHistoryEntry[] {
    let filtered = this.stateHistory

    if (startTime !== undefined) {
      filtered = filtered.filter((entry) => entry.state.timestamp >= startTime)
    }

    if (endTime !== undefined) {
      filtered = filtered.filter((entry) => entry.state.timestamp <= endTime)
    }

    return filtered
  }

  /**
   * Get statistics about state changes
   */
  public getStateStatistics(): {
    totalTransitions: number
    stateDistribution: Record<string, number>
    averageStateDuration: number
    totalTimeTracked: number
  } {
    const stateDistribution: Record<string, number> = {}
    let totalDuration = 0
    let totalTimeTracked = 0

    this.stateHistory.forEach((entry) => {
      const stateName = PlayerState[entry.transition.to]
      stateDistribution[stateName] = (stateDistribution[stateName] || 0) + 1
      totalDuration += entry.transition.duration
    })

    if (this.stateHistory.length > 0) {
      const firstEntry = this.stateHistory[0]
      const lastEntry = this.stateHistory[this.stateHistory.length - 1]
      totalTimeTracked = lastEntry.state.timestamp - firstEntry.state.timestamp
    }

    return {
      totalTransitions: this.stateHistory.length,
      stateDistribution,
      averageStateDuration:
        this.stateHistory.length > 0 ? totalDuration / this.stateHistory.length : 0,
      totalTimeTracked,
    }
  }

  /**
   * Force a state update check
   */
  public forceStateUpdate(): void {
    if (!this.isReady()) {
      throw new Error('Player not ready for state update')
    }

    this.updatePlayerState('manual_trigger')
    console.log('[PlayerInteractionService] Manual state update triggered')
  }

  // ========================================
  // Subtitle Synchronization API Methods
  // ========================================

  /**
   * Load a subtitle track for synchronization
   */
  public loadSubtitleTrack(track: SubtitleTrack): void {
    this.currentSubtitleTrack = track
    this.activeCues = []
    this.lastSyncTime = 0

    // Start synchronization if enabled
    if (this.subtitleSyncConfig.enabled) {
      this.startSubtitleSync()
    }

    // Notify listeners of track change
    this.notifySubtitleSync({
      type: 'track_change',
      track,
      currentTime: this.getCurrentTime(),
      activeCues: [],
      timestamp: Date.now(),
    })

    console.log(
      `[PlayerInteractionService] Subtitle track loaded: ${track.language} (${track.cues.length} cues)`,
    )
  }

  /**
   * Parse YouTube subtitle data into our subtitle format
   */
  public parseYouTubeSubtitleData(
    data: YouTubeSubtitleData,
    language: string,
    label: string,
    isAutoGenerated: boolean = false,
  ): SubtitleTrack {
    const cues: SubtitleCue[] = []
    let cueIndex = 0

    for (const event of data.events) {
      const startTime = event.tStartMs / 1000 // Convert to seconds
      const endTime = startTime + event.dDurationMs / 1000

      if (event.segs && event.segs.length > 0) {
        // Combine segments into single cue text
        const text = event.segs
          .map((seg) => seg.utf8)
          .join('')
          .trim()

        if (text) {
          cues.push({
            id: `cue_${cueIndex++}`,
            startTime,
            endTime,
            text,
            language,
            confidence: isAutoGenerated ? 0.85 : 1.0, // Auto-generated has lower confidence
          })
        }
      }
    }

    return {
      id: `track_${language}_${Date.now()}`,
      language,
      label,
      kind: 'subtitles',
      isDefault: false,
      isAutoGenerated,
      cues,
      source: 'youtube',
    }
  }

  /**
   * Create manual subtitle track from cue data
   */
  public createSubtitleTrack(
    cues: SubtitleCue[],
    language: string,
    label: string,
    kind: 'subtitles' | 'captions' | 'descriptions' = 'subtitles',
  ): SubtitleTrack {
    return {
      id: `manual_track_${language}_${Date.now()}`,
      language,
      label,
      kind,
      isDefault: false,
      isAutoGenerated: false,
      cues: [...cues], // Defensive copy
      source: 'manual',
    }
  }

  /**
   * Start subtitle synchronization
   */
  public startSubtitleSync(): void {
    if (!this.currentSubtitleTrack) {
      throw new Error('No subtitle track loaded')
    }

    if (this.syncUpdateIntervalId !== null) {
      this.stopSubtitleSync() // Stop existing sync
    }

    // Start sync update loop
    this.syncUpdateIntervalId = window.setInterval(() => {
      this.updateSubtitleSync()
    }, 100) // 20 FPS update rate

    console.log('[PlayerInteractionService] Subtitle synchronization started')
  }

  /**
   * Stop subtitle synchronization
   */
  public stopSubtitleSync(): void {
    if (this.syncUpdateIntervalId !== null) {
      window.clearInterval(this.syncUpdateIntervalId)
      this.syncUpdateIntervalId = null
    }

    // Clear active cues
    this.activeCues = []

    console.log('[PlayerInteractionService] Subtitle synchronization stopped')
  }

  /**
   * Update subtitle synchronization based on current playback time
   */
  private updateSubtitleSync(): void {
    if (!this.currentSubtitleTrack || !this.isReady()) {
      return
    }

    
    const currentTime = this.getCurrentTime()
    const adjustedTime = currentTime + this.subtitleSyncConfig.timeOffset

    // Skip if time hasn't changed significantly
    if (Math.abs(currentTime - this.lastSyncTime) < 0.02) {
      // 20ms threshold
      return
    }

    this.lastSyncTime = currentTime

    // Find cues that should be active
    const newActiveCues: ActiveSubtitleCue[] = []

    for (const cue of this.currentSubtitleTrack.cues) {
      const adjustedStartTime = cue.startTime + this.getTimingAdjustment(cue.startTime)
      const adjustedEndTime = cue.endTime + this.getTimingAdjustment(cue.endTime)

      // Check if cue should be active
      const isInTimeRange =
        adjustedTime >= adjustedStartTime - this.subtitleSyncConfig.lookBehindTime &&
        adjustedTime <= adjustedEndTime + this.subtitleSyncConfig.lookAheadTime

      if (isInTimeRange) {
        const isCurrentlyActive =
          adjustedTime >= adjustedStartTime && adjustedTime <= adjustedEndTime

        newActiveCues.push({
          ...cue,
          isActive: isCurrentlyActive,
          timeRemaining: Math.max(0, adjustedEndTime - adjustedTime),
          displayOrder: newActiveCues.length,
          adjustedStartTime,
          adjustedEndTime,
        })
      }
    }

    // Limit concurrent cues
    if (newActiveCues.length > this.subtitleSyncConfig.maxConcurrentCues) {
      newActiveCues.sort((a, b) => a.adjustedStartTime - b.adjustedStartTime)
      newActiveCues.splice(this.subtitleSyncConfig.maxConcurrentCues)
    }

    // Detect changes and notify
    const changes = this.detectCueChanges(this.activeCues, newActiveCues)
    this.activeCues = newActiveCues

    // Notify listeners of changes
    for (const change of changes) {
      this.notifySubtitleSync(change)
    }

    // Notify general update if there are active cues
    if (this.activeCues.length > 0) {
      this.notifySubtitleSync({
        type: 'cue_update',
        currentTime,
        activeCues: this.activeCues,
        timestamp: Date.now(),
      })
    }
  }

  /**
   * Detect changes between old and new active cues
   */
  private detectCueChanges(
    oldCues: ActiveSubtitleCue[],
    newCues: ActiveSubtitleCue[],
  ): SubtitleSyncEvent[] {
    const events: SubtitleSyncEvent[] = []
    const currentTime = this.getCurrentTime()
    const timestamp = Date.now()

    // Find cues that ended
    for (const oldCue of oldCues) {
      if (!newCues.find((c) => c.id === oldCue.id)) {
        events.push({
          type: 'cue_end',
          cue: oldCue,
          currentTime,
          activeCues: newCues,
          timestamp,
        })
      }
    }

    // Find cues that started
    for (const newCue of newCues) {
      if (!oldCues.find((c) => c.id === newCue.id)) {
        events.push({
          type: 'cue_start',
          cue: newCue,
          currentTime,
          activeCues: newCues,
          timestamp,
        })
      }
    }

    return events
  }

  /**
   * Get timing adjustment for a specific time based on history
   */
  private getTimingAdjustment(time: number): number {
    if (!this.subtitleSyncConfig.autoCorrectTiming || this.timingAdjustmentHistory.length === 0) {
      return 0
    }

    // Find the closest timing adjustment in history
    let closestAdjustment = 0
    let minDistance = Infinity

    for (const entry of this.timingAdjustmentHistory) {
      const distance = Math.abs(entry.time - time)
      if (distance < minDistance) {
        minDistance = distance
        closestAdjustment = entry.adjustment
      }
    }

    // Apply smoothing if enabled
    if (this.subtitleSyncConfig.enableSmoothing) {
      return closestAdjustment * 0.8 // Dampen adjustment
    }

    return closestAdjustment
  }

  /**
   * Add timing adjustment to history
   */
  public adjustSubtitleTiming(time: number, adjustment: number): void {
    this.timingAdjustmentHistory.push({ time, adjustment })

    // Limit history size
    if (this.timingAdjustmentHistory.length > 100) {
      this.timingAdjustmentHistory.shift()
    }

    console.log(`[PlayerInteractionService] Timing adjustment added: ${adjustment}s at ${time}s`)
  }

  /**
   * Notify subtitle sync listeners
   */
  private notifySubtitleSync(event: SubtitleSyncEvent): void {
    this.subtitleSyncListeners.forEach((callback) => {
      try {
        callback(event)
      } catch (error) {
        console.error('[PlayerInteractionService] Error in subtitle sync callback:', error)
      }
    })
  }

  /**
   * Update service configuration
   */
  public updateConfig(newConfig: Partial<PlayerInteractionConfig>): void {
    this.config = { ...this.config, ...newConfig }
    console.log('[PlayerInteractionService] Configuration updated:', this.config)
  }

  /**
   * Get current configuration
   */
  public getConfig(): PlayerInteractionConfig {
    return { ...this.config }
  }

  /**
   * Get current state tracking configuration
   */
  public getStateTrackingConfig(): StateTrackingConfig {
    return { ...this.stateTrackingConfig }
  }

  /**
   * Update state tracking configuration
   */
  public updateStateTrackingConfig(newConfig: Partial<StateTrackingConfig>): void {
    this.stateTrackingConfig = { ...this.stateTrackingConfig, ...newConfig }
    console.log(
      '[PlayerInteractionService] State tracking configuration updated:',
      this.stateTrackingConfig,
    )
  }

  /**
   * Get current subtitle sync configuration
   */
  public getSubtitleSyncConfig(): SubtitleSyncConfig {
    return { ...this.subtitleSyncConfig }
  }

  /**
   * Update subtitle sync configuration
   */
  public updateSubtitleSyncConfig(newConfig: Partial<SubtitleSyncConfig>): void {
    const wasEnabled = this.subtitleSyncConfig.enabled
    this.subtitleSyncConfig = { ...this.subtitleSyncConfig, ...newConfig }

    // Handle enable/disable changes
    if (this.subtitleSyncConfig.enabled && !wasEnabled && this.currentSubtitleTrack) {
      this.startSubtitleSync()
    } else if (!this.subtitleSyncConfig.enabled && wasEnabled) {
      this.stopSubtitleSync()
    }

    console.log(
      '[PlayerInteractionService] Subtitle sync configuration updated:',
      this.subtitleSyncConfig,
    )
  }

  /**
   * Add subtitle sync event listener
   */
  public addSubtitleSyncListener(callback: SubtitleSyncCallback): void {
    this.subtitleSyncListeners.add(callback)
    console.log('[PlayerInteractionService] Subtitle sync listener added')
  }

  /**
   * Remove subtitle sync event listener
   */
  public removeSubtitleSyncListener(callback: SubtitleSyncCallback): void {
    this.subtitleSyncListeners.delete(callback)
    console.log('[PlayerInteractionService] Subtitle sync listener removed')
  }

  /**
   * Remove all subtitle sync listeners
   */
  public removeAllSubtitleSyncListeners(): void {
    this.subtitleSyncListeners.clear()
    console.log('[PlayerInteractionService] All subtitle sync listeners removed')
  }

  /**
   * Get current subtitle track
   */
  public getCurrentSubtitleTrack(): SubtitleTrack | null {
    return this.currentSubtitleTrack
  }

  /**
   * Get currently active subtitle cues
   */
  public getActiveSubtitleCues(): ActiveSubtitleCue[] {
    return [...this.activeCues] // Defensive copy
  }

  /**
   * Clear current subtitle track and stop synchronization
   */
  public clearSubtitleTrack(): void {
    this.stopSubtitleSync()
    this.currentSubtitleTrack = null
    this.activeCues = []
    this.timingAdjustmentHistory = []

    console.log('[PlayerInteractionService] Subtitle track cleared')
  }

  /**
   * Get subtitle cues for a specific time range
   */
  public getSubtitleCuesInRange(startTime: number, endTime: number): SubtitleCue[] {
    if (!this.currentSubtitleTrack) {
      return []
    }

    return this.currentSubtitleTrack.cues.filter(
      (cue) => cue.startTime < endTime && cue.endTime > startTime,
    )
  }

  /**
   * Find the closest subtitle cue to a specific time
   */
  public findClosestSubtitleCue(time: number): SubtitleCue | null {
    if (!this.currentSubtitleTrack || this.currentSubtitleTrack.cues.length === 0) {
      return null
    }

    let closestCue: SubtitleCue | null = null
    let minDistance = Infinity

    for (const cue of this.currentSubtitleTrack.cues) {
      // Calculate distance to the start of the cue
      const distance = Math.abs(cue.startTime - time)

      if (distance < minDistance) {
        minDistance = distance
        closestCue = cue
      }
    }

    return closestCue
  }

  /**
   * Get subtitle synchronization statistics
   */
  public getSubtitleSyncStatistics(): {
    trackInfo: { language: string; cueCount: number; totalDuration: number } | null
    activeCueCount: number
    timingAdjustments: number
    averageAdjustment: number
    syncStatus: 'active' | 'inactive' | 'no_track'
  } {
    const trackInfo = this.currentSubtitleTrack
      ? {
          language: this.currentSubtitleTrack.language,
          cueCount: this.currentSubtitleTrack.cues.length,
          totalDuration: this.currentSubtitleTrack.cues.reduce(
            (total, cue) => total + (cue.endTime - cue.startTime),
            0,
          ),
        }
      : null

    const averageAdjustment =
      this.timingAdjustmentHistory.length > 0
        ? this.timingAdjustmentHistory.reduce((sum, entry) => sum + entry.adjustment, 0) /
          this.timingAdjustmentHistory.length
        : 0

    let syncStatus: 'active' | 'inactive' | 'no_track' = 'no_track'
    if (this.currentSubtitleTrack) {
      syncStatus = this.syncUpdateIntervalId !== null ? 'active' : 'inactive'
    }

    return {
      trackInfo,
      activeCueCount: this.activeCues.length,
      timingAdjustments: this.timingAdjustmentHistory.length,
      averageAdjustment,
      syncStatus,
    }
  }

  // ========================================
  // Segment Looping API Methods
  // ========================================

  /**
   * Create and activate a segment loop
   */
  public createSegmentLoop(
    startTime: number,
    endTime: number,
    options: {
      id?: string
      title?: string
      loopCount?: number
      metadata?: Record<string, unknown>
      enabled?: boolean
    } = {},
  ): ActiveSegmentLoop {
    // Validate input parameters
    if (startTime < 0) {
      throw new Error('Loop start time cannot be negative')
    }
    if (endTime <= startTime) {
      throw new Error('Loop end time must be greater than start time')
    }
    if (this.getDuration() > 0 && endTime > this.getDuration()) {
      console.warn(
        `[PlayerInteractionService] Loop end time (${endTime}s) exceeds video duration (${this.getDuration()}s)`,
      )
    }

    // Stop any existing loop
    if (this.activeLoop) {
      this.stopSegmentLoop()
    }

    // Create loop configuration
    const loopId = options.id || `loop_${Date.now()}`
    const baseLoop: SegmentLoop = {
      id: loopId,
      startTime,
      endTime,
      enabled: options.enabled !== false, // Default to enabled
      loopCount: options.loopCount,
      title: options.title,
      metadata: options.metadata,
    }

    // Create active loop with runtime state
    this.activeLoop = {
      ...baseLoop,
      currentIteration: 0,
      totalIterations: 0,
      isActive: false,
      timeInLoop: 0,
      timeRemaining: endTime - startTime,
      createdAt: Date.now(),
      lastTriggeredAt: 0,
    }

    // Start monitoring if enabled
    if (this.segmentLoopConfig.enabled && this.activeLoop.enabled) {
      this.startLoopMonitoring()
    }

    // Notify listeners
    this.notifySegmentLoop({
      type: 'loop_start',
      loop: this.activeLoop,
      currentTime: this.getCurrentTime(),
      timestamp: Date.now(),
    })

    console.log(
      `[PlayerInteractionService] Segment loop created: ${startTime}s - ${endTime}s (${loopId})`,
    )
    return this.activeLoop
  }

  /**
   * Update an existing segment loop
   */
  public updateSegmentLoop(updates: {
    startTime?: number
    endTime?: number
    enabled?: boolean
    loopCount?: number
    title?: string
    metadata?: Record<string, unknown>
  }): ActiveSegmentLoop | null {
    if (!this.activeLoop) {
      throw new Error('No active segment loop to update')
    }

    // Validate updates
    const newStartTime = updates.startTime ?? this.activeLoop.startTime
    const newEndTime = updates.endTime ?? this.activeLoop.endTime

    if (newStartTime < 0) {
      throw new Error('Loop start time cannot be negative')
    }
    if (newEndTime <= newStartTime) {
      throw new Error('Loop end time must be greater than start time')
    }

    // Update loop
    this.activeLoop = {
      ...this.activeLoop,
      startTime: newStartTime,
      endTime: newEndTime,
      enabled: updates.enabled ?? this.activeLoop.enabled,
      loopCount: updates.loopCount ?? this.activeLoop.loopCount,
      title: updates.title ?? this.activeLoop.title,
      metadata: updates.metadata ?? this.activeLoop.metadata,
      timeRemaining: newEndTime - newStartTime,
    }

    // Handle enabled/disabled state changes
    if (this.segmentLoopConfig.enabled && this.activeLoop.enabled && !this.loopMonitorIntervalId) {
      this.startLoopMonitoring()
    } else if (!this.activeLoop.enabled && this.loopMonitorIntervalId) {
      this.stopLoopMonitoring()
    }

    console.log(`[PlayerInteractionService] Segment loop updated: ${this.activeLoop.id}`)
    return this.activeLoop
  }

  /**
   * Start monitoring the current segment loop
   */
  private startLoopMonitoring(): void {
    if (this.loopMonitorIntervalId !== null) {
      this.stopLoopMonitoring()
    }

    if (!this.activeLoop) {
      return
    }

    // Monitor loop at 30 FPS
    this.loopMonitorIntervalId = window.setInterval(() => {
      this.updateLoopState()
    }, 33) // ~30 FPS

    console.log('[PlayerInteractionService] Segment loop monitoring started')
  }

  /**
   * Stop monitoring the current segment loop
   */
  private stopLoopMonitoring(): void {
    if (this.loopMonitorIntervalId !== null) {
      window.clearInterval(this.loopMonitorIntervalId)
      this.loopMonitorIntervalId = null
    }

    console.log('[PlayerInteractionService] Segment loop monitoring stopped')
  }

  /**
   * Update loop state and handle loop logic
   */
  private updateLoopState(): void {
    if (!this.activeLoop || !this.isReady()) {
      return
    }

    const currentTime = this.getCurrentTime()
    const { startTime, endTime } = this.activeLoop

    // Check if we're within the loop bounds
    const isInBounds = currentTime >= startTime && currentTime <= endTime
    const wasActive = this.activeLoop.isActive

    // Update loop runtime state
    const timeInLoop = isInBounds ? currentTime - startTime : 0
    const timeRemaining = isInBounds ? endTime - currentTime : endTime - startTime

    this.activeLoop = {
      ...this.activeLoop,
      isActive: isInBounds,
      timeInLoop,
      timeRemaining: Math.max(0, timeRemaining),
    }

    // Handle entering the loop
    if (isInBounds && !wasActive) {
      console.log(`[PlayerInteractionService] Entered loop bounds: ${this.activeLoop.id}`)
    }

    // Handle loop iteration (reached end)
    if (wasActive && currentTime >= endTime && !this.userSeekDetected) {
      this.handleLoopIteration()
    }

    // Handle seeking outside loop bounds
    if (wasActive && !isInBounds && this.userSeekDetected) {
      this.handleSeekOutsideLoop(currentTime)
    }

    // Reset user seek detection flag after processing
    if (this.userSeekDetected && Math.abs(currentTime - this.lastLoopSeekTime) > 1.0) {
      this.userSeekDetected = false
    }
  }

  /**
   * Handle loop iteration when end is reached
   */
  private handleLoopIteration(): void {
    if (!this.activeLoop) {
      return
    }

    const newIteration = this.activeLoop.currentIteration + 1
    const newTotalIterations = this.activeLoop.totalIterations + 1

    // Check if we've exceeded the loop count limit
    if (this.activeLoop.loopCount && newTotalIterations >= this.activeLoop.loopCount) {
      this.notifySegmentLoop({
        type: 'loop_end',
        loop: this.activeLoop,
        currentTime: this.getCurrentTime(),
        iteration: newTotalIterations,
        timestamp: Date.now(),
      })

      this.stopSegmentLoop()
      return
    }

    // Check if we've exceeded max consecutive loops
    if (newIteration >= this.segmentLoopConfig.maxConsecutiveLoops) {
      console.warn(
        `[PlayerInteractionService] Reached max consecutive loops (${this.segmentLoopConfig.maxConsecutiveLoops}), disabling loop`,
      )
      this.disableSegmentLoop()
      return
    }

    // Update loop state
    this.activeLoop = {
      ...this.activeLoop,
      currentIteration: newIteration,
      totalIterations: newTotalIterations,
      lastTriggeredAt: Date.now(),
    }

    // Notify iteration event
    this.notifySegmentLoop({
      type: 'loop_iteration',
      loop: this.activeLoop,
      currentTime: this.getCurrentTime(),
      iteration: newIteration,
      timestamp: Date.now(),
    })

    // Perform the actual loop (seek back to start)
    this.performLoopSeek()
  }

  /**
   * Perform the actual seek back to loop start
   */
  private performLoopSeek(): void {
    if (!this.activeLoop) {
      return
    }

    const seekTarget = Math.max(
      0,
      this.activeLoop.startTime - this.segmentLoopConfig.seekBackOffset,
    )

    if (this.segmentLoopConfig.delayBeforeLoop > 0) {
      // Delayed seek
      this.loopSeekTimeoutId = window.setTimeout(() => {
        this.executeLoopSeek(seekTarget)
        this.loopSeekTimeoutId = null
      }, this.segmentLoopConfig.delayBeforeLoop * 1000)
    } else {
      // Immediate seek
      this.executeLoopSeek(seekTarget)
    }
  }

  /**
   * Execute the actual seek operation for looping
   */
  private executeLoopSeek(seekTarget: number): void {
    try {
      this.lastLoopSeekTime = seekTarget
      this.seek(seekTarget)

      console.log(`[PlayerInteractionService] Loop seek executed to ${seekTarget}s`)

      // Handle fade effects if configured
      if (this.segmentLoopConfig.fadeInDuration > 0) {
        this.handleLoopFadeIn()
      }
    } catch (error) {
      console.error('[PlayerInteractionService] Failed to execute loop seek:', error)
    }
  }

  /**
   * Handle fade in effect after loop seek
   */
  private handleLoopFadeIn(): void {
    const originalVolume = this.getVolume()
    const fadeSteps = 20
    const stepDuration = (this.segmentLoopConfig.fadeInDuration * 1000) / fadeSteps
    let currentStep = 0

    // Start with low volume
    this.setVolume(originalVolume * 0.1)

    const fadeInterval = window.setInterval(() => {
      currentStep++
      const progress = currentStep / fadeSteps
      const newVolume = originalVolume * (0.1 + 0.9 * progress)

      this.setVolume(newVolume)

      if (currentStep >= fadeSteps) {
        window.clearInterval(fadeInterval)
        this.setVolume(originalVolume) // Ensure exact original volume
      }
    }, stepDuration)
  }

  /**
   * Handle user seeking outside loop bounds
   */
  private handleSeekOutsideLoop(currentTime: number): void {
    if (!this.activeLoop) {
      return
    }

    this.notifySegmentLoop({
      type: 'loop_seek_outside',
      loop: this.activeLoop,
      currentTime,
      seekTarget: currentTime,
      timestamp: Date.now(),
    })

    if (!this.segmentLoopConfig.allowUserSeekOutside) {
      // Force seek back to loop bounds
      const seekTarget =
        currentTime < this.activeLoop.startTime
          ? this.activeLoop.startTime
          : this.activeLoop.endTime - 0.1

      console.log(
        `[PlayerInteractionService] User seek outside loop not allowed, seeking back to ${seekTarget}s`,
      )
      this.seek(seekTarget)
    } else if (!this.segmentLoopConfig.resumeAfterSeekOutside) {
      // Disable loop when user seeks outside
      console.log('[PlayerInteractionService] User seeked outside loop, disabling loop')
      this.disableSegmentLoop()
    }
  }

  /**
   * Stop the current segment loop
   */
  public stopSegmentLoop(): void {
    if (!this.activeLoop) {
      return
    }

    this.stopLoopMonitoring()

    // Clear timeouts
    if (this.loopSeekTimeoutId !== null) {
      window.clearTimeout(this.loopSeekTimeoutId)
      this.loopSeekTimeoutId = null
    }

    const loop = this.activeLoop
    this.activeLoop = null
    this.userSeekDetected = false
    this.lastLoopSeekTime = 0

    this.notifySegmentLoop({
      type: 'loop_end',
      loop: { ...loop, isActive: false },
      currentTime: this.getCurrentTime(),
      timestamp: Date.now(),
    })

    console.log(`[PlayerInteractionService] Segment loop stopped: ${loop.id}`)
  }

  /**
   * Disable the current segment loop without stopping monitoring
   */
  public disableSegmentLoop(): void {
    if (!this.activeLoop) {
      return
    }

    this.activeLoop = {
      ...this.activeLoop,
      enabled: false,
      isActive: false,
    }

    this.notifySegmentLoop({
      type: 'loop_disabled',
      loop: this.activeLoop,
      currentTime: this.getCurrentTime(),
      timestamp: Date.now(),
    })

    console.log(`[PlayerInteractionService] Segment loop disabled: ${this.activeLoop.id}`)
  }

  /**
   * Enable the current segment loop
   */
  public enableSegmentLoop(): void {
    if (!this.activeLoop) {
      throw new Error('No segment loop to enable')
    }

    this.activeLoop = {
      ...this.activeLoop,
      enabled: true,
    }

    if (this.segmentLoopConfig.enabled && !this.loopMonitorIntervalId) {
      this.startLoopMonitoring()
    }

    console.log(`[PlayerInteractionService] Segment loop enabled: ${this.activeLoop.id}`)
  }

  /**
   * Notify segment loop listeners
   */
  private notifySegmentLoop(event: SegmentLoopEvent): void {
    this.segmentLoopListeners.forEach((callback) => {
      try {
        callback(event)
      } catch (error) {
        console.error('[PlayerInteractionService] Error in segment loop callback:', error)
      }
    })
  }

  /**
   * Force refresh of video element detection
   */
  public async refresh(): Promise<boolean> {
    if (!this.isInitialized) {
      throw new Error('Service not initialized')
    }

    console.log('[PlayerInteractionService] Manually refreshing video element detection')
    await this.recheckVideoElement()
    return this.isReady()
  }

  // ========================================
  // Player Control API Methods
  // ========================================

  /**
   * Play the video
   */
  public async play(): Promise<void> {
    this.ensureVideoElementReady()

    try {
      await this.videoElement!.play()
      console.log('[PlayerInteractionService] Video play initiated')
    } catch (error) {
      const message = `Failed to play video: ${error}`
      console.error('[PlayerInteractionService]', message)
      this.notifyError(PlayerErrorCode.PLAYBACK_FAILED, message, { error })
      throw new Error(message)
    }
  }

  /**
   * Pause the video
   */
  public pause(): void {
    this.ensureVideoElementReady()

    try {
      this.videoElement!.pause()
      console.log('[PlayerInteractionService] Video paused')
    } catch (error) {
      const message = `Failed to pause video: ${error}`
      console.error('[PlayerInteractionService]', message)
      this.notifyError(PlayerErrorCode.PLAYBACK_FAILED, message, { error })
      throw new Error(message)
    }
  }

  /**
   * Seek to a specific time in seconds
   */
  public seek(timeInSeconds: number): void {
    this.ensureVideoElementReady()
    this.validateTimeValue(timeInSeconds)

    try {
      this.videoElement!.currentTime = timeInSeconds
      console.log(`[PlayerInteractionService] Seeked to ${timeInSeconds}s`)
    } catch (error) {
      const message = `Failed to seek to ${timeInSeconds}s: ${error}`
      console.error('[PlayerInteractionService]', message)
      this.notifyError(PlayerErrorCode.SEEK_FAILED, message, { timeInSeconds, error })
      throw new Error(message)
    }
  }

  /**
   * Get current playback time in seconds
   */
  public getCurrentTime(): number {
    this.ensureVideoElementReady()
    return this.videoElement!.currentTime || 0
  }

  /**
   * Get video duration in seconds
   */
  public getDuration(): number {
    this.ensureVideoElementReady()
    return this.videoElement!.duration || 0
  }

  /**
   * Set playback rate (speed)
   */
  public setPlaybackRate(rate: number): void {
    this.ensureVideoElementReady()
    this.validatePlaybackRate(rate)

    try {
      this.videoElement!.playbackRate = rate
      console.log(`[PlayerInteractionService] Playback rate set to ${rate}x`)
    } catch (error) {
      const message = `Failed to set playback rate to ${rate}x: ${error}`
      console.error('[PlayerInteractionService]', message)
      this.notifyError(PlayerErrorCode.INVALID_RATE_VALUE, message, { rate, error })
      throw new Error(message)
    }
  }

  /**
   * Get current playback rate
   */
  public getPlaybackRate(): number {
    this.ensureVideoElementReady()
    return this.videoElement!.playbackRate || 1
  }

  /**
   * Set video volume (0 to 1)
   */
  public setVolume(volume: number): void {
    this.ensureVideoElementReady()
    this.validateVolumeValue(volume)

    try {
      this.videoElement!.volume = volume
      console.log(`[PlayerInteractionService] Volume set to ${Math.round(volume * 100)}%`)
    } catch (error) {
      const message = `Failed to set volume to ${volume}: ${error}`
      console.error('[PlayerInteractionService]', message)
      this.notifyError(PlayerErrorCode.PLAYBACK_FAILED, message, { volume, error })
      throw new Error(message)
    }
  }

  /**
   * Get current volume (0 to 1)
   */
  public getVolume(): number {
    this.ensureVideoElementReady()
    return this.videoElement!.volume || 0
  }

  /**
   * Mute or unmute the video
   */
  public setMuted(muted: boolean): void {
    this.ensureVideoElementReady()

    try {
      this.videoElement!.muted = muted
      console.log(`[PlayerInteractionService] Video ${muted ? 'muted' : 'unmuted'}`)
    } catch (error) {
      const message = `Failed to ${muted ? 'mute' : 'unmute'} video: ${error}`
      console.error('[PlayerInteractionService]', message)
      this.notifyError(PlayerErrorCode.PLAYBACK_FAILED, message, { muted, error })
      throw new Error(message)
    }
  }

  /**
   * Check if video is muted
   */
  public isMuted(): boolean {
    this.ensureVideoElementReady()
    return this.videoElement!.muted || false
  }

  /**
   * Check if video is paused
   */
  public isPaused(): boolean {
    this.ensureVideoElementReady()
    return this.videoElement!.paused || true
  }

  /**
   * Check if video has ended
   */
  public isEnded(): boolean {
    this.ensureVideoElementReady()
    return this.videoElement!.ended || false
  }

  /**
   * Get video ready state
   */
  public getReadyState(): number {
    this.ensureVideoElementReady()
    return this.videoElement!.readyState || 0
  }

  /**
   * Get buffered time ranges
   */
  public getBufferedRanges(): TimeRanges {
    this.ensureVideoElementReady()
    return this.videoElement!.buffered
  }

  /**
   * Get seekable time ranges
   */
  public getSeekableRanges(): TimeRanges {
    this.ensureVideoElementReady()
    return this.videoElement!.seekable
  }

  /**
   * Get video dimensions
   */
  public getVideoDimensions(): { width: number; height: number } {
    this.ensureVideoElementReady()
    const widthResult = this.mediaProxy.getProperty('videoWidth')
    const heightResult = this.mediaProxy.getProperty('videoHeight')
    return {
      width: widthResult.success ? (widthResult.value ?? 0) : 0,
      height: heightResult.success ? (heightResult.value ?? 0) : 0,
    }
  }

  // ========================================
  // Event Listener API Methods
  // ========================================

  /**
   * Add event listener for player events
   */
  public addEventListener(eventType: PlayerEvent | string, callback: PlayerEventCallback): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set())
    }

    this.eventListeners.get(eventType)!.add(callback)

    // If video element exists, add listener immediately via proxy
    if (this.videoElement && this.mediaProxy.isElementReady()) {
      this.mediaProxy
        .addEventListener(eventType, this.createEventHandler(eventType))
        .then((result) => {
          if (!result.success && result.error) {
            console.warn(
              `[PlayerInteractionService] Failed to add direct listener for ${eventType}:`,
              result.error.message,
            )
          }
        })
        .catch((error) => {
          console.warn(
            `[PlayerInteractionService] Error adding direct listener for ${eventType}:`,
            error,
          )
        })
    }

    console.log(`[PlayerInteractionService] Event listener added for '${eventType}'`)
  }

  /**
   * Remove event listener for player events
   */
  public removeEventListener(eventType: PlayerEvent | string, callback: PlayerEventCallback): void {
    const callbacks = this.eventListeners.get(eventType)
    if (!callbacks) return

    callbacks.delete(callback)

    // If no more callbacks for this event, remove the set
    if (callbacks.size === 0) {
      this.eventListeners.delete(eventType)

      // Remove listener from video element if it exists via proxy
      if (this.videoElement && this.mediaProxy.isElementReady()) {
        this.mediaProxy
          .removeEventListener(eventType, this.createEventHandler(eventType))
          .then((result) => {
            if (!result.success && result.error) {
              console.warn(
                `[PlayerInteractionService] Failed to remove direct listener for ${eventType}:`,
                result.error.message,
              )
            }
          })
          .catch((error) => {
            console.warn(
              `[PlayerInteractionService] Error removing direct listener for ${eventType}:`,
              error,
            )
          })
      }
    }

    console.log(`[PlayerInteractionService] Event listener removed for '${eventType}'`)
  }

  /**
   * Remove all event listeners for a specific event type
   */
  public removeAllEventListenersForType(eventType: PlayerEvent | string): void {
    if (this.eventListeners.has(eventType)) {
      this.eventListeners.delete(eventType)

      // Remove listener from video element if it exists via proxy
      if (this.videoElement && this.mediaProxy.isElementReady()) {
        this.mediaProxy
          .removeEventListener(eventType, this.createEventHandler(eventType))
          .then((result) => {
            if (!result.success && result.error) {
              console.warn(
                `[PlayerInteractionService] Failed to remove all listeners for ${eventType}:`,
                result.error.message,
              )
            }
          })
          .catch((error) => {
            console.warn(
              `[PlayerInteractionService] Error removing all listeners for ${eventType}:`,
              error,
            )
          })
      }

      console.log(`[PlayerInteractionService] All event listeners removed for '${eventType}'`)
    }
  }

  // ========================================
  // Validation and Helper Methods
  // ========================================

  /**
   * Ensure video element is ready for operations
   */
  private ensureVideoElementReady(): void {
    if (!this.isInitialized) {
      throw new Error('PlayerInteractionService not initialized')
    }

    if (!this.videoElement) {
      const message = 'Video element not available'
      this.notifyError(PlayerErrorCode.VIDEO_ELEMENT_UNAVAILABLE, message)
      throw new Error(message)
    }
  }

  /**
   * Validate time value for seeking
   */
  private validateTimeValue(timeInSeconds: number): void {
    if (typeof timeInSeconds !== 'number' || isNaN(timeInSeconds) || timeInSeconds < 0) {
      const message = `Invalid time value: ${timeInSeconds}. Must be a non-negative number.`
      this.notifyError(PlayerErrorCode.INVALID_TIME_VALUE, message, { timeInSeconds })
      throw new Error(message)
    }

    const duration = this.getDuration()
    if (duration > 0 && timeInSeconds > duration) {
      console.warn(
        `[PlayerInteractionService] Seek time ${timeInSeconds}s exceeds duration ${duration}s`,
      )
    }
  }

  /**
   * Validate playback rate value
   */
  private validatePlaybackRate(rate: number): void {
    if (typeof rate !== 'number' || isNaN(rate) || rate <= 0) {
      const message = `Invalid playback rate: ${rate}. Must be a positive number.`
      this.notifyError(PlayerErrorCode.INVALID_RATE_VALUE, message, { rate })
      throw new Error(message)
    }

    // YouTube typically supports rates between 0.25x and 2x
    if (rate < 0.25 || rate > 2) {
      console.warn(
        `[PlayerInteractionService] Playback rate ${rate}x may not be supported by YouTube`,
      )
    }
  }

  /**
   * Validate volume value
   */
  private validateVolumeValue(volume: number): void {
    if (typeof volume !== 'number' || isNaN(volume) || volume < 0 || volume > 1) {
      throw new ValidationError('volume', volume, 'Volume must be a number between 0 and 1')
    }
  }

  // ========================================
  // Enhanced Error Handling Methods
  // ========================================

  /**
   * Detect browser compatibility for video features
   */
  private detectBrowserCompatibility(): BrowserCompatibility {
    const userAgent = navigator.userAgent
    const features = {
      videoApi: typeof HTMLVideoElement !== 'undefined',
      mutationObserver: typeof MutationObserver !== 'undefined',
      webkitFullscreen: 'webkitRequestFullscreen' in document.documentElement,
      requestVideoFrameCallback: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
      mediasession: 'mediaSession' in navigator,
    }

    const supportCount = Object.values(features).filter(Boolean).length
    const totalFeatures = Object.keys(features).length

    let compatibility: 'full' | 'partial' | 'limited' | 'unsupported'
    if (supportCount === totalFeatures) {
      compatibility = 'full'
    } else if (supportCount >= totalFeatures * 0.7) {
      compatibility = 'partial'
    } else if (supportCount >= totalFeatures * 0.4) {
      compatibility = 'limited'
    } else {
      compatibility = 'unsupported'
    }

    const warnings: string[] = []
    const recommendations: string[] = []

    if (!features.videoApi) {
      warnings.push('HTML5 Video API not supported')
      recommendations.push('Update browser to a modern version')
    }
    if (!features.mutationObserver) {
      warnings.push('MutationObserver not supported - DOM monitoring may be limited')
      recommendations.push('Consider updating browser for better performance')
    }
    if (!features.requestVideoFrameCallback) {
      warnings.push(
        'requestVideoFrameCallback not supported - frame-accurate operations unavailable',
      )
    }

    return {
      userAgent,
      features,
      compatibility,
      warnings,
      recommendations,
    }
  }

  /**
   * Enhanced error notification with recovery and aggregation
   */
  private notifyEnhancedError(error: PlayerOperationError, context: string = 'unknown'): void {
    const playerError = error.toPlayerError()

    // Update error metrics
    this.updateErrorMetrics(playerError)

    // Add to error collector
    this.errorCollector.addError(playerError, context)

    // Handle circuit breaker
    if (this.errorRecoveryConfig.enableCircuitBreaker) {
      this.handleCircuitBreaker(playerError)
    }

    // Log error with enhanced context
    console.error(`[PlayerInteractionService] Enhanced Error [${playerError.code}]:`, {
      message: playerError.message,
      severity: playerError.severity,
      recoverable: playerError.recoverable,
      retryable: playerError.retryable,
      context: playerError.context,
      details: playerError.details,
      timestamp: new Date(playerError.timestamp).toISOString(),
    })

    // Notify standard error system
    this.notifyError(playerError.code, playerError.message, playerError.details)

    // Attempt recovery if applicable
    if (error.retryable && this.errorRecoveryConfig.enableRetry) {
      this.scheduleRetry(error, context)
    }
  }

  /**
   * Update error metrics
   */
  private updateErrorMetrics(error: PlayerError): void {
    const now = Date.now()
    this.errorMetrics = {
      totalErrors: this.errorMetrics.totalErrors + 1,
      errorsByCode: {
        ...this.errorMetrics.errorsByCode,
        [error.code]: (this.errorMetrics.errorsByCode[error.code] || 0) + 1,
      },
      errorsBySeverity: {
        ...this.errorMetrics.errorsBySeverity,
        [error.severity]: this.errorMetrics.errorsBySeverity[error.severity] + 1,
      },
      averageErrorsPerMinute: this.calculateAverageErrorsPerMinute(),
      lastErrorTime: now,
      uptime: now - this.startTime,
    }
  }

  /**
   * Calculate average errors per minute
   */
  private calculateAverageErrorsPerMinute(): number {
    const uptimeMinutes = (Date.now() - this.startTime) / 60000
    return uptimeMinutes > 0 ? this.errorMetrics.totalErrors / uptimeMinutes : 0
  }

  /**
   * Handle circuit breaker logic
   */
  private handleCircuitBreaker(error: PlayerError): void {
    if (error.severity === 'critical' || error.severity === 'high') {
      this.circuitBreakerFailureCount++
      this.circuitBreakerLastFailureTime = Date.now()

      if (this.circuitBreakerFailureCount >= this.errorRecoveryConfig.circuitBreakerThreshold) {
        this.circuitBreakerState = 'open'
        console.warn(
          `[PlayerInteractionService] Circuit breaker opened after ${this.circuitBreakerFailureCount} failures`,
        )

        // Schedule circuit breaker reset
        setTimeout(() => {
          this.circuitBreakerState = 'half-open'
          this.circuitBreakerFailureCount = 0
          console.log('[PlayerInteractionService] Circuit breaker reset to half-open')
        }, this.errorRecoveryConfig.circuitBreakerTimeoutMs)
      }
    }
  }

  /**
   * Schedule operation retry with exponential backoff
   */
  private scheduleRetry(error: PlayerOperationError, context: string): void {
    if (!error.retryable) return

    const retryCount = (error.details?.retryCount as number) || 0
    if (retryCount >= this.errorRecoveryConfig.maxRetries) {
      console.warn(`[PlayerInteractionService] Max retries exceeded for operation: ${context}`)
      return
    }

    const delay =
      this.errorRecoveryConfig.retryDelayMs *
      Math.pow(this.errorRecoveryConfig.retryBackoffFactor, retryCount)

    setTimeout(() => {
      console.log(
        `[PlayerInteractionService] Retrying operation: ${context} (attempt ${retryCount + 1})`,
      )
      // Note: Actual retry logic would depend on the specific operation
      // This provides the framework for retry implementation
    }, delay)
  }

  /**
   * Check if circuit breaker allows operation
   */
  private isOperationAllowed(): boolean {
    return this.circuitBreakerState !== 'open'
  }

  /**
   * Get comprehensive error statistics
   */
  public getErrorStatistics(): {
    metrics: ErrorMetrics
    aggregatedErrors: ErrorAggregationEntry[]
    collectorStats: ReturnType<ErrorCollector['getErrorStatistics']>
    circuitBreakerState: string
    browserCompatibility: BrowserCompatibility
  } {
    return {
      metrics: { ...this.errorMetrics },
      aggregatedErrors: this.errorCollector.getAggregatedErrors(),
      collectorStats: this.errorCollector.getErrorStatistics(),
      circuitBreakerState: this.circuitBreakerState,
      browserCompatibility: this.browserCompatibility,
    }
  }

  /**
   * Reset error statistics and circuit breaker
   */
  public resetErrorTracking(): void {
    this.errorMetrics = {
      totalErrors: 0,
      errorsByCode: {} as Record<PlayerErrorCode, number>,
      errorsBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
      averageErrorsPerMinute: 0,
      lastErrorTime: 0,
      uptime: Date.now() - this.startTime,
    }
    this.errorCollector.clearErrors()
    this.circuitBreakerState = 'closed'
    this.circuitBreakerFailureCount = 0
    this.retryQueues.clear()
    this.operationTimeouts.clear()
    console.log('[PlayerInteractionService] Error tracking reset')
  }

  /**
   * Get browser compatibility information
   */
  public getBrowserCompatibility(): BrowserCompatibility {
    return { ...this.browserCompatibility }
  }

  /**
   * Update error recovery configuration
   */
  public updateErrorRecoveryConfig(newConfig: Partial<ErrorRecoveryConfig>): void {
    this.errorRecoveryConfig = { ...this.errorRecoveryConfig, ...newConfig }
    console.log('[PlayerInteractionService] Error recovery configuration updated')
  }

  /**
   * Get current error recovery configuration
   */
  public getErrorRecoveryConfig(): ErrorRecoveryConfig {
    return { ...this.errorRecoveryConfig }
  }
}

// ========================================
// Export Default Instance
// ========================================

export default PlayerInteractionService
