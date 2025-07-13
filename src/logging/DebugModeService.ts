// ========================================
// Debug Mode Service for Development Tools
// ========================================

import {
  LogLevel,
  LogEntry,
  ComponentType,
  LoggerConfig,
  LogFilters,
  StoredLogEntry,
  isProduction,
} from './types'

/**
 * Debug mode configuration and preferences
 */
export interface DebugModeConfig {
  readonly enabled: boolean
  readonly verboseLogging: boolean
  readonly consoleTimestamps: boolean
  readonly colorizedOutput: boolean
  readonly stackTraceInConsole: boolean
  readonly performanceProfiling: boolean
  readonly autoOpenDevTools: boolean
  readonly debugFilters: LogFilters
  readonly consoleLogLevel: LogLevel
  readonly enabledComponents: ComponentType[]
  readonly memoryMonitoring: boolean
  readonly networkMonitoring: boolean
  readonly storageInspection: boolean
  readonly exposeToChromeDevTools: boolean
}

/**
 * Debug statistics and metrics
 */
export interface DebugStats {
  readonly sessionStartTime: number
  totalLogsGenerated: number
  readonly logsByLevel: Record<LogLevel, number>
  readonly logsByComponent: Record<ComponentType, number>
  averageLogFrequency: number
  readonly memorySnapshots: MemorySnapshot[]
  readonly performanceMarks: PerformanceEntry[]
  readonly networkRequests: NetworkRequestInfo[]
  consoleHistory: ConsoleEntry[]
  readonly errorPatterns: ErrorPattern[]
}

/**
 * Memory usage snapshot for debugging
 */
export interface MemorySnapshot {
  readonly timestamp: number
  readonly heapUsed: number
  readonly heapTotal: number
  readonly external: number
  readonly arrayBuffers: number
  readonly component: ComponentType
  readonly operation?: string
}

/**
 * Network request information for debugging
 */
export interface NetworkRequestInfo {
  readonly timestamp: number
  readonly url: string
  readonly method: string
  readonly status: number
  readonly duration: number
  readonly size: number
  readonly component: ComponentType
  readonly cached: boolean
}

/**
 * Console entry for debug history
 */
export interface ConsoleEntry {
  readonly timestamp: number
  readonly level: LogLevel
  readonly message: string
  readonly component: ComponentType
  readonly args: any[]
  readonly stackTrace?: string
}

/**
 * Error pattern analysis for debugging
 */
export interface ErrorPattern {
  readonly pattern: string
  count: number
  readonly firstSeen: number
  lastSeen: number
  readonly components: ComponentType[]
  readonly severity: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Debug mode service class
 */
export class DebugModeService {
  private static instance: DebugModeService | null = null
  private config: DebugModeConfig
  private stats: DebugStats
  private memoryMonitorInterval: number | null = null
  private performanceObserver: PerformanceObserver | null = null
  private consoleInterceptor: ConsoleInterceptor | null = null
  private chromeDevToolsLogger: ChromeDevToolsLogger | null = null

  private constructor(config: Partial<DebugModeConfig> = {}) {
    this.config = this.createDefaultConfig(config)
    this.stats = this.initializeStats()

    // Only initialize if debug mode is enabled and not in production
    if (this.config.enabled && !isProduction()) {
      this.initialize()
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<DebugModeConfig>): DebugModeService {
    if (!DebugModeService.instance) {
      DebugModeService.instance = new DebugModeService(config)
    }
    return DebugModeService.instance
  }

  /**
   * Initialize debug mode service
   */
  private initialize(): void {
    try {
      // Set up console interceptor for enhanced logging
      if (this.config.colorizedOutput || this.config.verboseLogging) {
        this.consoleInterceptor = new ConsoleInterceptor(this.config)
        this.consoleInterceptor.install()
      }

      // Set up Chrome DevTools integration
      if (this.config.exposeToChromeDevTools) {
        this.chromeDevToolsLogger = new ChromeDevToolsLogger(this.config)
        this.chromeDevToolsLogger.install()
      }

      // Set up memory monitoring
      if (this.config.memoryMonitoring) {
        this.startMemoryMonitoring()
      }

      // Set up performance profiling
      if (this.config.performanceProfiling) {
        this.startPerformanceProfiling()
      }

      // Auto-open dev tools if configured
      if (this.config.autoOpenDevTools && typeof chrome !== 'undefined' && chrome.devtools) {
        this.openDevToolsConsole()
      }

      // Register global debug utilities
      this.registerGlobalDebugUtils()

      console.info('[DebugMode] 🔧 Debug mode enabled with comprehensive development tools')
    } catch (error) {
      console.error('[DebugMode] Failed to initialize debug mode:', error)
    }
  }

  /**
   * Create default debug configuration
   */
  private createDefaultConfig(overrides: Partial<DebugModeConfig>): DebugModeConfig {
    return {
      enabled: !isProduction(), // Auto-disable in production
      verboseLogging: true,
      consoleTimestamps: true,
      colorizedOutput: true,
      stackTraceInConsole: true,
      performanceProfiling: true,
      autoOpenDevTools: false,
      debugFilters: {
        levels: [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR, LogLevel.CRITICAL],
        components: Object.values(ComponentType),
      },
      consoleLogLevel: LogLevel.DEBUG,
      enabledComponents: Object.values(ComponentType),
      memoryMonitoring: true,
      networkMonitoring: true,
      storageInspection: true,
      exposeToChromeDevTools: true,
      ...overrides,
    }
  }

  /**
   * Initialize debug statistics
   */
  private initializeStats(): DebugStats {
    return {
      sessionStartTime: Date.now(),
      totalLogsGenerated: 0,
      logsByLevel: {
        [LogLevel.DEBUG]: 0,
        [LogLevel.INFO]: 0,
        [LogLevel.WARN]: 0,
        [LogLevel.ERROR]: 0,
        [LogLevel.CRITICAL]: 0,
      },
      logsByComponent: Object.values(ComponentType).reduce(
        (acc, component) => {
          acc[component] = 0
          return acc
        },
        {} as Record<ComponentType, number>,
      ),
      averageLogFrequency: 0,
      memorySnapshots: [],
      performanceMarks: [],
      networkRequests: [],
      consoleHistory: [],
      errorPatterns: [],
    }
  }

  /**
   * Process a log entry for debug mode analysis
   */
  public processLogEntry(entry: LogEntry): void {
    if (!this.config.enabled || isProduction()) {
      return
    }

    try {
      // Update statistics
      this.updateStats(entry)

      // Enhanced console output
      if (this.shouldLogToConsole(entry)) {
        this.logToConsole(entry)
      }

      // Store in console history
      this.addToConsoleHistory(entry)

      // Analyze error patterns
      if (entry.level === LogLevel.ERROR || entry.level === LogLevel.CRITICAL) {
        this.analyzeErrorPattern(entry)
      }

      // Chrome DevTools integration
      if (this.chromeDevToolsLogger) {
        this.chromeDevToolsLogger.log(entry)
      }
    } catch (error) {
      console.error('[DebugMode] Error processing log entry:', error)
    }
  }

  /**
   * Update debug statistics
   */
  private updateStats(entry: LogEntry): void {
    this.stats.totalLogsGenerated++
    this.stats.logsByLevel[entry.level]++
    this.stats.logsByComponent[entry.context.component]++

    // Calculate average frequency
    const sessionDuration = Date.now() - this.stats.sessionStartTime
    this.stats.averageLogFrequency = this.stats.totalLogsGenerated / (sessionDuration / 1000)
  }

  /**
   * Check if log should be output to console
   */
  private shouldLogToConsole(entry: LogEntry): boolean {
    // Check if component is enabled
    if (!this.config.enabledComponents.includes(entry.context.component)) {
      return false
    }

    // Check if level meets threshold
    const levelPriority = {
      [LogLevel.DEBUG]: 0,
      [LogLevel.INFO]: 1,
      [LogLevel.WARN]: 2,
      [LogLevel.ERROR]: 3,
      [LogLevel.CRITICAL]: 4,
    }

    return levelPriority[entry.level] >= levelPriority[this.config.consoleLogLevel]
  }

  /**
   * Enhanced console logging with formatting
   */
  private logToConsole(entry: LogEntry): void {
    const styles = this.getConsoleStyles(entry.level)
    const timestamp = this.config.consoleTimestamps
      ? `[${new Date(entry.timestamp).toLocaleTimeString()}]`
      : ''
    const component = `[${entry.context.component.toUpperCase()}]`

    const baseMessage = `${timestamp} ${component} ${entry.message}`

    if (this.config.colorizedOutput) {
      console.log(`%c${baseMessage}`, styles.message)
    } else {
      console.log(baseMessage)
    }

    // Add verbose details if enabled
    if (this.config.verboseLogging) {
      console.groupCollapsed(`%c📊 Details for ${entry.id}`, styles.details)
      console.log('Entry ID:', entry.id)
      console.log('Timestamp:', entry.timestamp)
      console.log('Level:', entry.level)
      console.log('Component:', entry.context.component)
      console.log('Context:', entry.context)

      if (entry.error) {
        console.log('Error:', entry.error)
      }

      if (entry.errorContext) {
        console.log('Error Context:', entry.errorContext)
      }

      if (entry.context.performance) {
        console.log('Performance:', entry.context.performance)
      }

      if (this.config.stackTraceInConsole && entry.errorContext?.stackTrace) {
        console.log('Stack Trace:', entry.errorContext.stackTrace)
      }

      console.groupEnd()
    }
  }

  /**
   * Get console styles for different log levels
   */
  private getConsoleStyles(level: LogLevel): { message: string; details: string } {
    const styles = {
      [LogLevel.DEBUG]: {
        message: 'color: #888; font-size: 11px;',
        details: 'color: #666; font-style: italic;',
      },
      [LogLevel.INFO]: {
        message: 'color: #007acc; font-weight: normal;',
        details: 'color: #005a99; font-style: italic;',
      },
      [LogLevel.WARN]: {
        message: 'color: #ff8c00; font-weight: bold;',
        details: 'color: #cc7000; font-style: italic;',
      },
      [LogLevel.ERROR]: {
        message: 'color: #e74c3c; font-weight: bold; background: #fff5f5; padding: 2px 4px;',
        details: 'color: #c0392b; font-style: italic;',
      },
      [LogLevel.CRITICAL]: {
        message:
          'color: #fff; font-weight: bold; background: #e74c3c; padding: 4px 8px; border-radius: 3px;',
        details: 'color: #8e2930; font-style: italic;',
      },
    }

    return styles[level] || styles[LogLevel.INFO]
  }

  /**
   * Add entry to console history
   */
  private addToConsoleHistory(entry: LogEntry): void {
    const consoleEntry: ConsoleEntry = {
      timestamp: Date.now(),
      level: entry.level,
      message: entry.message,
      component: entry.context.component,
      args: [entry],
      stackTrace: entry.errorContext?.stackTrace,
    }

    this.stats.consoleHistory.push(consoleEntry)

    // Keep only last 1000 entries
    if (this.stats.consoleHistory.length > 1000) {
      this.stats.consoleHistory.shift()
    }
  }

  /**
   * Analyze error patterns for debugging insights
   */
  private analyzeErrorPattern(entry: LogEntry): void {
    const pattern = entry.message.replace(/\d+/g, 'N').replace(/[a-f0-9-]{36}/g, 'UUID')

    let existingPattern = this.stats.errorPatterns.find((p) => p.pattern === pattern)

    if (existingPattern) {
      existingPattern.count++
      existingPattern.lastSeen = Date.now()
      if (!existingPattern.components.includes(entry.context.component)) {
        existingPattern.components.push(entry.context.component)
      }
    } else {
      this.stats.errorPatterns.push({
        pattern,
        count: 1,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        components: [entry.context.component],
        severity: entry.level === LogLevel.CRITICAL ? 'critical' : 'high',
      })
    }
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    // Check if memory API is available (Chrome-specific)
    const performanceWithMemory = performance as any
    if (typeof performance === 'undefined' || !performanceWithMemory.memory) {
      console.warn('[DebugMode] Memory monitoring not available in this context')
      return
    }

    this.memoryMonitorInterval = window.setInterval(() => {
      const memory = performanceWithMemory.memory
      if (memory) {
        const snapshot: MemorySnapshot = {
          timestamp: Date.now(),
          heapUsed: memory.usedJSHeapSize,
          heapTotal: memory.totalJSHeapSize,
          external: memory.jsHeapSizeLimit,
          arrayBuffers: 0, // Not directly available
          component: ComponentType.BACKGROUND, // Will be updated per component
        }

        this.stats.memorySnapshots.push(snapshot)

        // Keep only last 100 snapshots
        if (this.stats.memorySnapshots.length > 100) {
          this.stats.memorySnapshots.shift()
        }
      }
    }, 5000) // Every 5 seconds
  }

  /**
   * Start performance profiling
   */
  private startPerformanceProfiling(): void {
    if (typeof PerformanceObserver === 'undefined') {
      console.warn('[DebugMode] PerformanceObserver not available')
      return
    }

    try {
      this.performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.stats.performanceMarks.push(entry as PerformanceEntry)
        }
      })

      this.performanceObserver.observe({ entryTypes: ['mark', 'measure'] })
    } catch (error) {
      console.warn('[DebugMode] Could not start performance profiling:', error)
    }
  }

  /**
   * Open Chrome DevTools console
   */
  private openDevToolsConsole(): void {
    // This is a hint to developers - actual DevTools opening requires user action
    console.info(
      '%c🔧 LinguaTube Debug Mode Active%c\n' +
        'Open Chrome DevTools (F12) for enhanced debugging features.\n' +
        'Available debug commands: debugLinguaTube.help()',
      'font-size: 16px; font-weight: bold; color: #007acc;',
      'font-size: 12px; color: #666;',
    )
  }

  /**
   * Register global debug utilities
   */
  private registerGlobalDebugUtils(): void {
    if (typeof window !== 'undefined') {
      ;(window as any).debugLinguaTube = {
        getStats: () => this.getStats(),
        exportLogs: () => this.exportDebugData(),
        clearHistory: () => this.clearConsoleHistory(),
        setLogLevel: (level: LogLevel) => this.setConsoleLogLevel(level),
        enableComponent: (component: ComponentType) => this.enableComponent(component),
        disableComponent: (component: ComponentType) => this.disableComponent(component),
        memory: () => this.getMemoryStats(),
        performance: () => this.getPerformanceStats(),
        patterns: () => this.getErrorPatterns(),
        help: () => this.showDebugHelp(),
      }
    }
  }

  /**
   * Show debug help in console
   */
  private showDebugHelp(): void {
    console.group(
      '%c🔧 LinguaTube Debug Commands',
      'font-size: 14px; font-weight: bold; color: #007acc;',
    )
    console.log('%cdebugLinguaTube.getStats()', 'font-weight: bold;', '- Get debug statistics')
    console.log('%cdebugLinguaTube.exportLogs()', 'font-weight: bold;', '- Export debug data')
    console.log('%cdebugLinguaTube.clearHistory()', 'font-weight: bold;', '- Clear console history')
    console.log(
      '%cdebugLinguaTube.setLogLevel(level)',
      'font-weight: bold;',
      '- Set console log level',
    )
    console.log(
      '%cdebugLinguaTube.enableComponent(component)',
      'font-weight: bold;',
      '- Enable component logging',
    )
    console.log(
      '%cdebugLinguaTube.disableComponent(component)',
      'font-weight: bold;',
      '- Disable component logging',
    )
    console.log('%cdebugLinguaTube.memory()', 'font-weight: bold;', '- Get memory statistics')
    console.log(
      '%cdebugLinguaTube.performance()',
      'font-weight: bold;',
      '- Get performance statistics',
    )
    console.log('%cdebugLinguaTube.patterns()', 'font-weight: bold;', '- Get error patterns')
    console.groupEnd()
  }

  // Public API methods...

  /**
   * Get current debug statistics
   */
  public getStats(): DebugStats {
    return { ...this.stats }
  }

  /**
   * Update debug mode configuration
   */
  public updateConfig(updates: Partial<DebugModeConfig>): void {
    this.config = { ...this.config, ...updates }

    // Re-initialize if needed
    if (updates.enabled !== undefined) {
      if (updates.enabled && !isProduction()) {
        this.initialize()
      } else {
        this.destroy()
      }
    }
  }

  /**
   * Export debug data for analysis
   */
  public exportDebugData(): string {
    const exportData = {
      config: this.config,
      stats: this.stats,
      timestamp: new Date().toISOString(),
      version: chrome.runtime.getManifest().version,
    }

    return JSON.stringify(exportData, null, 2)
  }

  /**
   * Clear console history
   */
  public clearConsoleHistory(): void {
    this.stats.consoleHistory = []
    console.clear()
    console.info('[DebugMode] Console history cleared')
  }

  /**
   * Set console log level
   */
  public setConsoleLogLevel(level: LogLevel): void {
    this.config = { ...this.config, consoleLogLevel: level }
    console.info(`[DebugMode] Console log level set to ${level}`)
  }

  /**
   * Enable component logging
   */
  public enableComponent(component: ComponentType): void {
    if (!this.config.enabledComponents.includes(component)) {
      this.config = {
        ...this.config,
        enabledComponents: [...this.config.enabledComponents, component],
      }
      console.info(`[DebugMode] Enabled logging for ${component}`)
    }
  }

  /**
   * Disable component logging
   */
  public disableComponent(component: ComponentType): void {
    this.config = {
      ...this.config,
      enabledComponents: this.config.enabledComponents.filter((c) => c !== component),
    }
    console.info(`[DebugMode] Disabled logging for ${component}`)
  }

  /**
   * Get memory statistics
   */
  public getMemoryStats(): MemorySnapshot[] {
    return [...this.stats.memorySnapshots]
  }

  /**
   * Get performance statistics
   */
  public getPerformanceStats(): PerformanceEntry[] {
    return [...this.stats.performanceMarks]
  }

  /**
   * Get error patterns
   */
  public getErrorPatterns(): ErrorPattern[] {
    return [...this.stats.errorPatterns]
  }

  /**
   * Check if debug mode is enabled
   */
  public isEnabled(): boolean {
    return this.config.enabled && !isProduction()
  }

  /**
   * Destroy debug mode service
   */
  public destroy(): void {
    // Clear intervals
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval)
      this.memoryMonitorInterval = null
    }

    // Disconnect observers
    if (this.performanceObserver) {
      this.performanceObserver.disconnect()
      this.performanceObserver = null
    }

    // Uninstall interceptors
    if (this.consoleInterceptor) {
      this.consoleInterceptor.uninstall()
      this.consoleInterceptor = null
    }

    if (this.chromeDevToolsLogger) {
      this.chromeDevToolsLogger.uninstall()
      this.chromeDevToolsLogger = null
    }

    // Clean up global utilities
    if (typeof window !== 'undefined') {
      delete (window as any).debugLinguaTube
    }

    console.info('[DebugMode] Debug mode service destroyed')
  }
}

/**
 * Console interceptor for enhanced logging
 */
class ConsoleInterceptor {
  private originalMethods: Record<string, any> = {}
  private installed = false

  constructor(private config: DebugModeConfig) {}

  public install(): void {
    if (this.installed) return

    // Store original methods
    this.originalMethods = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    }

    // Override console methods
    console.log = this.createInterceptor('log')
    console.info = this.createInterceptor('info')
    console.warn = this.createInterceptor('warn')
    console.error = this.createInterceptor('error')
    console.debug = this.createInterceptor('debug')

    this.installed = true
  }

  public uninstall(): void {
    if (!this.installed) return

    // Restore original methods
    Object.assign(console, this.originalMethods)
    this.installed = false
  }

  private createInterceptor(method: string) {
    return (...args: any[]) => {
      // Add timestamp if enabled
      if (this.config.consoleTimestamps) {
        const timestamp = new Date().toLocaleTimeString()
        args.unshift(`[${timestamp}]`)
      }

      // Call original method
      this.originalMethods[method].apply(console, args)
    }
  }
}

/**
 * Chrome DevTools logger integration
 */
class ChromeDevToolsLogger {
  private installed = false

  constructor(private config: DebugModeConfig) {}

  public install(): void {
    if (this.installed) return

    // Expose logging API to DevTools
    if (typeof window !== 'undefined') {
      ;(window as any).__LINGUA_TUBE_LOGGER__ = {
        version: chrome.runtime.getManifest().version,
        logEntry: (entry: LogEntry) => this.log(entry),
        getConfig: () => this.config,
      }
    }

    this.installed = true
  }

  public uninstall(): void {
    if (!this.installed) return

    if (typeof window !== 'undefined') {
      delete (window as any).__LINGUA_TUBE_LOGGER__
    }

    this.installed = false
  }

  public log(entry: LogEntry): void {
    // Send to DevTools console with special formatting
    const devToolsEntry = {
      ...entry,
      _linguaTubeDebug: true,
      _timestamp: Date.now(),
    }

    console.groupCollapsed(`🔧 [${entry.context.component}] ${entry.message}`)
    console.table(devToolsEntry)
    console.groupEnd()
  }
}

/**
 * Create debug mode service from logger config
 */
export function createDebugModeService(loggerConfig: LoggerConfig): DebugModeService {
  const debugConfig: Partial<DebugModeConfig> = {
    enabled: loggerConfig.debugMode,
    verboseLogging: loggerConfig.debugMode && loggerConfig.enableConsole,
    consoleLogLevel: loggerConfig.minLevel,
    performanceProfiling: loggerConfig.enablePerformance,
  }

  return DebugModeService.getInstance(debugConfig)
}
