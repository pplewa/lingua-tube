// ========================================
// Console Logging Service Implementation
// ========================================

import {
  LogLevel,
  LogEntry,
  ComponentType,
  ErrorSeverity,
  LOG_LEVEL_PRIORITY,
  isProduction,
} from './types'

/**
 * Console output formatting options
 */
export enum ConsoleFormat {
  SIMPLE = 'simple',
  STRUCTURED = 'structured',
  COMPACT = 'compact',
  VERBOSE = 'verbose',
}

/**
 * Console color scheme
 */
export enum ConsoleColorScheme {
  NONE = 'none',
  BASIC = 'basic',
  EXTENDED = 'extended',
  CUSTOM = 'custom',
}

/**
 * Console grouping options
 */
export interface ConsoleGrouping {
  readonly enabled: boolean
  readonly groupByComponent: boolean
  readonly groupByLevel: boolean
  readonly groupByTime: boolean
  readonly maxGroupDepth: number
}

/**
 * Console filtering configuration
 */
export interface ConsoleFiltering {
  readonly enabledLevels: Set<LogLevel>
  readonly enabledComponents: Set<ComponentType>
  readonly minSeverity: ErrorSeverity
  readonly productionOverride: boolean
  readonly debugModeOverride: boolean
  readonly maxOutputRate: number // logs per second
  readonly silentComponents: Set<ComponentType>
}

/**
 * Console formatting configuration
 */
export interface ConsoleFormatting {
  readonly format: ConsoleFormat
  readonly colorScheme: ConsoleColorScheme
  readonly showTimestamp: boolean
  readonly showComponent: boolean
  readonly showLevel: boolean
  readonly showContext: boolean
  readonly showStackTrace: boolean
  readonly maxMessageLength: number
  readonly indentSize: number
  readonly customColors: Record<LogLevel, string>
}

/**
 * Console performance monitoring
 */
export interface ConsolePerformanceStats {
  readonly totalLogsOutput: number
  readonly logsByLevel: Record<LogLevel, number>
  readonly logsByComponent: Record<ComponentType, number>
  readonly avgProcessingTime: number
  readonly maxProcessingTime: number
  readonly totalProcessingTime: number
  readonly suppressedLogs: number
  readonly rateLimit: {
    readonly hitsPerSecond: number
    readonly suppressedByRate: number
  }
}

/**
 * Mutable version for internal use
 */
interface MutableConsolePerformanceStats {
  totalLogsOutput: number
  logsByLevel: Record<LogLevel, number>
  logsByComponent: Record<ComponentType, number>
  avgProcessingTime: number
  maxProcessingTime: number
  totalProcessingTime: number
  suppressedLogs: number
  rateLimit: {
    hitsPerSecond: number
    suppressedByRate: number
  }
}

/**
 * Console logging configuration
 */
export interface ConsoleLoggingConfig {
  readonly enabled: boolean
  readonly filtering: ConsoleFiltering
  readonly formatting: ConsoleFormatting
  readonly grouping: ConsoleGrouping
  readonly performance: {
    readonly trackStats: boolean
    readonly maxProcessingTime: number
    readonly warnOnSlowOutput: boolean
  }
  readonly development: {
    readonly enableEnhancedDebugging: boolean
    readonly showInternalLogs: boolean
    readonly enableConsoleAPI: boolean
  }
  readonly production: {
    readonly suppressDebugLogs: boolean
    readonly suppressInfoLogs: boolean
    readonly onlyShowErrors: boolean
    readonly maxLogsPerSession: number
  }
}

/**
 * Default console logging configuration
 */
export const DEFAULT_CONSOLE_LOGGING_CONFIG: ConsoleLoggingConfig = {
  enabled: true,
  filtering: {
    enabledLevels: new Set([LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.CRITICAL]),
    enabledComponents: new Set(Object.values(ComponentType)),
    minSeverity: ErrorSeverity.LOW,
    productionOverride: true,
    debugModeOverride: true,
    maxOutputRate: 10,
    silentComponents: new Set(),
  },
  formatting: {
    format: ConsoleFormat.STRUCTURED,
    colorScheme: ConsoleColorScheme.EXTENDED,
    showTimestamp: true,
    showComponent: true,
    showLevel: true,
    showContext: false,
    showStackTrace: true,
    maxMessageLength: 1000,
    indentSize: 2,
    customColors: {
      [LogLevel.DEBUG]: '#888888',
      [LogLevel.INFO]: '#2196F3',
      [LogLevel.WARN]: '#FF9800',
      [LogLevel.ERROR]: '#F44336',
      [LogLevel.CRITICAL]: '#E91E63',
    },
  },
  grouping: {
    enabled: true,
    groupByComponent: true,
    groupByLevel: false,
    groupByTime: false,
    maxGroupDepth: 3,
  },
  performance: {
    trackStats: true,
    maxProcessingTime: 5, // ms
    warnOnSlowOutput: true,
  },
  development: {
    enableEnhancedDebugging: true,
    showInternalLogs: false,
    enableConsoleAPI: true,
  },
  production: {
    suppressDebugLogs: true,
    suppressInfoLogs: false,
    onlyShowErrors: false,
    maxLogsPerSession: 1000,
  },
}

/**
 * Console Logging Service
 * Provides comprehensive control over console output formatting, filtering, and performance
 */
export class ConsoleLoggingService {
  private static instance: ConsoleLoggingService | null = null
  private config: ConsoleLoggingConfig
  private stats: MutableConsolePerformanceStats
  private activeGroups: Map<string, number> = new Map()
  private outputBuffer: Array<{ entry: LogEntry; timestamp: number }> = []
  private rateTracker: Array<number> = []
  private sessionLogCount: number = 0
  private startTime: number = Date.now()
  private originalConsole: Console

  private constructor(config: Partial<ConsoleLoggingConfig> = {}) {
    this.config = this.mergeConfig(DEFAULT_CONSOLE_LOGGING_CONFIG, config)
    this.stats = this.initializeStats()
    this.originalConsole = { ...console }
    this.setupRateTracking()
    this.setupConsoleAPI()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<ConsoleLoggingConfig>): ConsoleLoggingService | null {
    if (typeof window === 'undefined') {
      return null
    }
    if (!ConsoleLoggingService.instance) {
      ConsoleLoggingService.instance = new ConsoleLoggingService(config)
    }
    return ConsoleLoggingService.instance
  }

  /**
   * Process and output log entry to console
   */
  public processLogEntry(entry: LogEntry): void {
    const startTime = performance.now()

    try {
      // Check if console logging is enabled
      if (!this.config.enabled) {
        return
      }

      // Apply filtering
      if (!this.shouldOutput(entry)) {
        this.stats.suppressedLogs++
        return
      }

      // Check rate limiting
      if (!this.checkRateLimit()) {
        this.stats.rateLimit.suppressedByRate++
        return
      }

      // Apply production limits
      if (isProduction() && !this.checkProductionLimits()) {
        this.stats.suppressedLogs++
        return
      }

      // Format and output
      this.outputToConsole(entry)
      this.updateStats(entry, startTime)
      this.sessionLogCount++

    } catch (error) {
      // Fallback to basic console output if formatting fails
      this.originalConsole.error('[ConsoleLoggingService] Failed to process log entry:', error)
      this.fallbackOutput(entry)
    }
  }

  /**
   * Update console logging configuration
   */
  public updateConfig(newConfig: Partial<ConsoleLoggingConfig>): void {
    this.config = this.mergeConfig(this.config, newConfig)
    this.setupConsoleAPI()
  }

  /**
   * Get current configuration
   */
  public getConfig(): ConsoleLoggingConfig {
    return { ...this.config }
  }

  /**
   * Get performance statistics
   */
  public getStats(): ConsolePerformanceStats {
    return { 
      ...this.stats,
      rateLimit: { ...this.stats.rateLimit }
    }
  }

  /**
   * Reset statistics
   */
  public resetStats(): void {
    this.stats = this.initializeStats()
    this.sessionLogCount = 0
    this.startTime = Date.now()
  }

  /**
   * Enable/disable console logging
   */
  public setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled }
  }

  /**
   * Set log level filtering
   */
  public setEnabledLevels(levels: LogLevel[]): void {
    this.config = {
      ...this.config,
      filtering: {
        ...this.config.filtering,
        enabledLevels: new Set(levels),
      },
    }
  }

  /**
   * Set component filtering
   */
  public setEnabledComponents(components: ComponentType[]): void {
    this.config = {
      ...this.config,
      filtering: {
        ...this.config.filtering,
        enabledComponents: new Set(components),
      },
    }
  }

  /**
   * Set silent components (completely suppress output)
   */
  public setSilentComponents(components: ComponentType[]): void {
    this.config = {
      ...this.config,
      filtering: {
        ...this.config.filtering,
        silentComponents: new Set(components),
      },
    }
  }

  /**
   * Set console format
   */
  public setFormat(format: ConsoleFormat): void {
    this.config = {
      ...this.config,
      formatting: {
        ...this.config.formatting,
        format,
      },
    }
  }

  /**
   * Set color scheme
   */
  public setColorScheme(scheme: ConsoleColorScheme): void {
    this.config = {
      ...this.config,
      formatting: {
        ...this.config.formatting,
        colorScheme: scheme,
      },
    }
  }

  /**
   * Clear all console groups
   */
  public clearGroups(): void {
    this.activeGroups.clear()
    for (let i = 0; i < this.config.grouping.maxGroupDepth; i++) {
      console.groupEnd()
    }
  }

  /**
   * Export console logs as text
   */
  public exportLogs(): string {
    const header = `Console Logs Export - ${new Date().toISOString()}\n${'='.repeat(50)}\n`
    const statsSection = this.formatStatsForExport()
    const configSection = this.formatConfigForExport()
    
    return `${header}\n${statsSection}\n${configSection}`
  }

  /**
   * Destroy service and cleanup
   */
  public destroy(): void {
    this.clearGroups()
    this.outputBuffer = []
    this.rateTracker = []
    this.activeGroups.clear()
    ConsoleLoggingService.instance = null
  }

  // ========================================
  // Private Methods
  // ========================================

  /**
   * Initialize performance statistics
   */
  private initializeStats(): MutableConsolePerformanceStats {
    return {
      totalLogsOutput: 0,
      logsByLevel: {
        [LogLevel.DEBUG]: 0,
        [LogLevel.INFO]: 0,
        [LogLevel.WARN]: 0,
        [LogLevel.ERROR]: 0,
        [LogLevel.CRITICAL]: 0,
      },
      logsByComponent: Object.values(ComponentType).reduce((acc, component) => {
        acc[component] = 0
        return acc
      }, {} as Record<ComponentType, number>),
      avgProcessingTime: 0,
      maxProcessingTime: 0,
      totalProcessingTime: 0,
      suppressedLogs: 0,
      rateLimit: {
        hitsPerSecond: 0,
        suppressedByRate: 0,
      },
    }
  }

  /**
   * Merge configuration objects
   */
  private mergeConfig(base: ConsoleLoggingConfig, override: Partial<ConsoleLoggingConfig>): ConsoleLoggingConfig {
    const merged = { ...base }
    
    if (override.enabled !== undefined) merged.enabled = override.enabled
    if (override.filtering) merged.filtering = { ...merged.filtering, ...override.filtering }
    if (override.formatting) merged.formatting = { ...merged.formatting, ...override.formatting }
    if (override.grouping) merged.grouping = { ...merged.grouping, ...override.grouping }
    if (override.performance) merged.performance = { ...merged.performance, ...override.performance }
    if (override.development) merged.development = { ...merged.development, ...override.development }
    if (override.production) merged.production = { ...merged.production, ...override.production }
    
    return merged
  }

  /**
   * Setup rate tracking
   */
  private setupRateTracking(): void {
    setInterval(() => {
      const now = Date.now()
      this.rateTracker = this.rateTracker.filter(time => now - time < 1000)
      this.stats.rateLimit.hitsPerSecond = this.rateTracker.length
    }, 100)
  }

  /**
   * Setup console API for runtime control
   */
  private setupConsoleAPI(): void {
    if (!this.config.development.enableConsoleAPI || isProduction()) {
      return
    }

    // Add global console controls
    (window as any).linguaTubeConsole = {
      enable: () => this.setEnabled(true),
      disable: () => this.setEnabled(false),
      setLevel: (levels: LogLevel[]) => this.setEnabledLevels(levels),
      setComponents: (components: ComponentType[]) => this.setEnabledComponents(components),
      setSilent: (components: ComponentType[]) => this.setSilentComponents(components),
      setFormat: (format: ConsoleFormat) => this.setFormat(format),
      setColors: (scheme: ConsoleColorScheme) => this.setColorScheme(scheme),
      getStats: () => this.getStats(),
      getConfig: () => this.getConfig(),
      reset: () => this.resetStats(),
      export: () => this.exportLogs(),
      clear: () => this.clearGroups(),
    }
  }

  /**
   * Check if log entry should be output
   */
  private shouldOutput(entry: LogEntry): boolean {
    // Check if component is silenced
    if (this.config.filtering.silentComponents.has(entry.context.component)) {
      return false
    }

    // Check level filtering
    if (!this.config.filtering.enabledLevels.has(entry.level)) {
      return false
    }

    // Check component filtering
    if (!this.config.filtering.enabledComponents.has(entry.context.component)) {
      return false
    }

    // Apply production overrides
    if (isProduction() && this.config.filtering.productionOverride) {
      if (this.config.production.suppressDebugLogs && entry.level === LogLevel.DEBUG) {
        return false
      }
      if (this.config.production.suppressInfoLogs && entry.level === LogLevel.INFO) {
        return false
      }
      if (this.config.production.onlyShowErrors && 
          ![LogLevel.ERROR, LogLevel.CRITICAL].includes(entry.level)) {
        return false
      }
    }

    // Check error severity
    if (entry.errorContext && 
        this.getSeverityPriority(entry.errorContext.severity) < this.getSeverityPriority(this.config.filtering.minSeverity)) {
      return false
    }

    return true
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(): boolean {
    const now = Date.now()
    this.rateTracker.push(now)
    
    // Clean old entries
    this.rateTracker = this.rateTracker.filter(time => now - time < 1000)
    
    return this.rateTracker.length <= this.config.filtering.maxOutputRate
  }

  /**
   * Check production limits
   */
  private checkProductionLimits(): boolean {
    if (!isProduction()) return true
    
    return this.sessionLogCount < this.config.production.maxLogsPerSession
  }

  /**
   * Output log entry to console
   */
  private outputToConsole(entry: LogEntry): void {
    // Handle grouping
    this.handleGrouping(entry)
    
    // Format message
    const formattedMessage = this.formatMessage(entry)
    const formattedContext = this.formatContext(entry)
    
    // Output based on level
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage, formattedContext)
        break
      case LogLevel.INFO:
        console.info(formattedMessage, formattedContext)
        break
      case LogLevel.WARN:
        console.warn(formattedMessage, formattedContext)
        break
      case LogLevel.ERROR:
        console.error(formattedMessage, formattedContext, entry.error)
        break
      case LogLevel.CRITICAL:
        console.error(formattedMessage, formattedContext, entry.error)
        if (entry.error && this.config.formatting.showStackTrace) {
          console.trace('Stack trace:', entry.error.stack)
        }
        break
    }
  }

  /**
   * Handle console grouping
   */
  private handleGrouping(entry: LogEntry): void {
    if (!this.config.grouping.enabled) return
    
    const groupKey = this.getGroupKey(entry)
    const currentDepth = this.activeGroups.get(groupKey) || 0
    
    if (currentDepth === 0 && this.activeGroups.size < this.config.grouping.maxGroupDepth) {
      const groupLabel = this.getGroupLabel(entry)
      console.group(groupLabel)
      this.activeGroups.set(groupKey, 1)
    }
  }

  /**
   * Get group key for log entry
   */
  private getGroupKey(entry: LogEntry): string {
    const parts: string[] = []
    
    if (this.config.grouping.groupByComponent) {
      parts.push(entry.context.component)
    }
    
    if (this.config.grouping.groupByLevel) {
      parts.push(entry.level)
    }
    
    if (this.config.grouping.groupByTime) {
      const timeWindow = Math.floor(Date.now() / 60000) // 1-minute windows
      parts.push(timeWindow.toString())
    }
    
    return parts.join('-')
  }

  /**
   * Get group label for log entry
   */
  private getGroupLabel(entry: LogEntry): string {
    const parts: string[] = []
    
    if (this.config.grouping.groupByComponent) {
      parts.push(`Component: ${entry.context.component}`)
    }
    
    if (this.config.grouping.groupByLevel) {
      parts.push(`Level: ${entry.level.toUpperCase()}`)
    }
    
    if (this.config.grouping.groupByTime) {
      parts.push(`Time: ${new Date().toLocaleTimeString()}`)
    }
    
    return parts.join(' | ')
  }

  /**
   * Format log message
   */
  private formatMessage(entry: LogEntry): string {
    const timestamp = this.config.formatting.showTimestamp ? 
      `[${new Date(entry.timestamp).toLocaleTimeString()}] ` : ''
    
    const level = this.config.formatting.showLevel ? 
      `[${entry.level.toUpperCase()}] ` : ''
    
    const component = this.config.formatting.showComponent ? 
      `[${entry.context.component}] ` : ''
    
    let message = entry.message
    if (message.length > this.config.formatting.maxMessageLength) {
      message = message.substring(0, this.config.formatting.maxMessageLength) + '...'
    }
    
    const baseMessage = `${timestamp}${level}${component}${message}`
    
    // Apply coloring
    return this.applyColoring(baseMessage, entry.level)
  }

  /**
   * Format context information
   */
  private formatContext(entry: LogEntry): any {
    if (!this.config.formatting.showContext) return undefined
    
    const context: any = {}
    
    if (entry.context.action) context.action = entry.context.action
    if (entry.context.url) context.url = entry.context.url
    if (entry.context.metadata) context.metadata = entry.context.metadata
    if (entry.tags) context.tags = entry.tags
    
    return Object.keys(context).length > 0 ? context : undefined
  }

  /**
   * Apply color formatting
   */
  private applyColoring(message: string, level: LogLevel): string {
    if (this.config.formatting.colorScheme === ConsoleColorScheme.NONE) {
      return message
    }
    
    const color = this.config.formatting.customColors[level] || this.getDefaultColor(level)
    
    if (this.config.formatting.colorScheme === ConsoleColorScheme.BASIC) {
      return message
    }
    
    return `%c${message}`
  }

  /**
   * Get default color for log level
   */
  private getDefaultColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG: return '#888888'
      case LogLevel.INFO: return '#2196F3'
      case LogLevel.WARN: return '#FF9800'
      case LogLevel.ERROR: return '#F44336'
      case LogLevel.CRITICAL: return '#E91E63'
      default: return '#000000'
    }
  }

  /**
   * Fallback output for errors
   */
  private fallbackOutput(entry: LogEntry): void {
    const message = `[${entry.context.component}] ${entry.message}`
    
    switch (entry.level) {
      case LogLevel.DEBUG:
        this.originalConsole.debug(message)
        break
      case LogLevel.INFO:
        this.originalConsole.info(message)
        break
      case LogLevel.WARN:
        this.originalConsole.warn(message)
        break
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        this.originalConsole.error(message, entry.error)
        break
    }
  }

  /**
   * Update performance statistics
   */
  private updateStats(entry: LogEntry, startTime: number): void {
    const processingTime = performance.now() - startTime
    
    this.stats.totalLogsOutput++
    this.stats.logsByLevel[entry.level]++
    this.stats.logsByComponent[entry.context.component]++
    this.stats.totalProcessingTime += processingTime
    this.stats.avgProcessingTime = this.stats.totalProcessingTime / this.stats.totalLogsOutput
    
    if (processingTime > this.stats.maxProcessingTime) {
      this.stats.maxProcessingTime = processingTime
    }
    
    // Warn if processing is slow
    if (this.config.performance.warnOnSlowOutput && 
        processingTime > this.config.performance.maxProcessingTime) {
      this.originalConsole.warn(`[ConsoleLoggingService] Slow log processing: ${processingTime.toFixed(2)}ms`)
    }
  }

  /**
   * Get severity priority for comparison
   */
  private getSeverityPriority(severity: ErrorSeverity): number {
    const priorities = {
      [ErrorSeverity.LOW]: 1,
      [ErrorSeverity.MEDIUM]: 2,
      [ErrorSeverity.HIGH]: 3,
      [ErrorSeverity.CRITICAL]: 4,
    }
    return priorities[severity] || 0
  }

  /**
   * Format statistics for export
   */
  private formatStatsForExport(): string {
    const stats = this.stats
    const uptime = Date.now() - this.startTime
    
    return `
Performance Statistics:
- Total logs output: ${stats.totalLogsOutput}
- Session uptime: ${(uptime / 1000).toFixed(2)}s
- Avg processing time: ${stats.avgProcessingTime.toFixed(2)}ms
- Max processing time: ${stats.maxProcessingTime.toFixed(2)}ms
- Suppressed logs: ${stats.suppressedLogs}
- Rate limit hits/sec: ${stats.rateLimit.hitsPerSecond}

Logs by Level:
${Object.entries(stats.logsByLevel).map(([level, count]) => `- ${level}: ${count}`).join('\n')}

Logs by Component:
${Object.entries(stats.logsByComponent).map(([component, count]) => `- ${component}: ${count}`).join('\n')}
`
  }

  /**
   * Format configuration for export
   */
  private formatConfigForExport(): string {
    const config = this.config
    
    return `
Configuration:
- Enabled: ${config.enabled}
- Format: ${config.formatting.format}
- Color scheme: ${config.formatting.colorScheme}
- Grouping enabled: ${config.grouping.enabled}
- Max output rate: ${config.filtering.maxOutputRate}/sec
- Production mode: ${isProduction()}
- Session log limit: ${config.production.maxLogsPerSession}
`
  }
}

/**
 * Factory function to create console logging service
 */
export function createConsoleLoggingService(config?: Partial<ConsoleLoggingConfig>): ConsoleLoggingService {
  return ConsoleLoggingService.getInstance(config)
} 