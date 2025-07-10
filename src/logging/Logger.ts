// ========================================
// Centralized Logger Implementation
// ========================================

import {
  LogLevel,
  LogEntry,
  LogContext,
  ErrorContext,
  LoggerConfig,
  LoggerStats,
  ComponentType,
  MessageType,
  LogMessage,
  LogEventPayload,
  LogBatchPayload,
  StoredLogEntry,
  LogFilters,
  DEFAULT_LOGGER_CONFIG,
  LOG_LEVEL_PRIORITY,
  generateLogId,
  generateFingerprint,
  isProduction,
  ErrorType,
  ErrorSeverity
} from './types';
import { StackTraceProcessor, ProcessedStackTrace, ErrorSource } from './StackTraceProcessor';
import { PerformanceMonitor, OperationMetadata, PerformanceMeasurement, PerformanceAnalytics } from './PerformanceMonitor';

/**
 * Centralized Logger Service for Chrome Extension
 * Handles logging across all extension contexts (background, content script, popup)
 */
export class Logger {
  private static instance: Logger | null = null;
  private config: LoggerConfig;
  private logQueue: LogEntry[] = [];
  private rateLimitTracker: Map<string, number[]> = new Map();
  private deduplicationCache: Map<string, { count: number; lastSeen: number }> = new Map();
  private performanceMarks: Map<string, number> = new Map();
  private batchTimer: number | null = null;
  private isBackground: boolean;
  private sessionId: string;
  private extensionVersion: string;
  private stackTraceProcessor: StackTraceProcessor;
  private performanceMonitor: PerformanceMonitor;

  private constructor(config?: Partial<LoggerConfig>) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
    this.isBackground = this.detectBackgroundContext();
    this.sessionId = this.generateSessionId();
    this.extensionVersion = chrome.runtime.getManifest().version;
    this.stackTraceProcessor = StackTraceProcessor.getInstance();
    this.performanceMonitor = PerformanceMonitor.getInstance();
    
    this.initialize();
  }

  /**
   * Get singleton instance of Logger
   */
  public static getInstance(config?: Partial<LoggerConfig>): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  /**
   * Initialize the logger
   */
  private initialize(): void {
    if (this.isBackground) {
      this.setupBackgroundMessageHandler();
    }
    
    this.setupBatchTimer();
    this.setupCleanupTimer();
    
    // Log initialization
    this.logInternal(LogLevel.INFO, 'Logger initialized', {
      component: this.isBackground ? ComponentType.BACKGROUND : ComponentType.CONTENT_SCRIPT,
      action: 'initialize',
      metadata: {
        isBackground: this.isBackground,
        config: this.config,
        sessionId: this.sessionId
      }
    });
  }

  /**
   * Detect if running in background context
   */
  private detectBackgroundContext(): boolean {
    try {
      // Background service worker has access to chrome.runtime.onMessage
      return typeof chrome?.runtime?.onMessage !== 'undefined' && 
             typeof document === 'undefined';
    } catch {
      return false;
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Setup message handler for background context
   */
  private setupBackgroundMessageHandler(): void {
    chrome.runtime.onMessage.addListener((
      message: LogMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => {
      try {
        if (message.type === MessageType.LOG_EVENT) {
          const payload = message.payload as LogEventPayload;
          this.processLogEntry(payload.entry);
          sendResponse({ success: true });
        } else if (message.type === MessageType.LOG_BATCH) {
          const payload = message.payload as LogBatchPayload;
          payload.entries.forEach(entry => this.processLogEntry(entry));
          sendResponse({ success: true });
        }
             } catch (error) {
         console.error('[Logger] Error processing message:', error);
         const errorMessage = error instanceof Error ? error.message : String(error);
         sendResponse({ success: false, error: errorMessage });
      }
      return true; // Keep message channel open for async response
    });
  }

  /**
   * Setup batch timer for periodic log flushing
   */
  private setupBatchTimer(): void {
    if (this.config.batching.enabled && this.isBackground) {
      this.batchTimer = window.setInterval(() => {
        this.flushLogs();
      }, this.config.batching.flushInterval);
    }
  }

  /**
   * Setup cleanup timer for log retention
   */
  private setupCleanupTimer(): void {
    if (this.isBackground) {
      // Run cleanup every hour
      setInterval(() => {
        this.cleanupOldLogs();
      }, 60 * 60 * 1000);
    }
  }

  /**
   * Main logging method
   */
  public log(level: LogLevel, message: string, context: Partial<LogContext> = {}): void {
    if (!this.config.enabled || !this.shouldLog(level)) {
      return;
    }

    const logEntry = this.createLogEntry(level, message, context);
    
    if (this.isBackground) {
      this.processLogEntry(logEntry);
    } else {
      this.sendToBackground(logEntry);
    }
  }

  /**
   * Convenience methods for different log levels
   */
  public debug(message: string, context: Partial<LogContext> = {}): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  public info(message: string, context: Partial<LogContext> = {}): void {
    this.log(LogLevel.INFO, message, context);
  }

  public warn(message: string, context: Partial<LogContext> = {}): void {
    this.log(LogLevel.WARN, message, context);
  }

  public error(message: string, context: Partial<LogContext> = {}, error?: Error): void {
    if (error) {
      const processedTrace = this.stackTraceProcessor.processError(error, { component: context.component });
      const enhancedContext: Partial<ErrorContext> = {
        ...context,
        stackTrace: processedTrace.processed,
        userMessage: this.stackTraceProcessor.generateUserMessage(error, processedTrace),
        technicalDetails: this.stackTraceProcessor.extractTechnicalDetails(error, processedTrace),
        errorType: this.mapErrorSourceToType(processedTrace.errorSource),
        severity: this.determineSeverityFromTrace(processedTrace),
        recoverable: this.isRecoverableError(error, processedTrace)
      };
      this.log(LogLevel.ERROR, message, enhancedContext);
    } else {
      this.log(LogLevel.ERROR, message, context);
    }
  }

  public critical(message: string, context: Partial<LogContext> = {}, error?: Error): void {
    if (error) {
      const processedTrace = this.stackTraceProcessor.processError(error, { component: context.component });
      const enhancedContext: Partial<ErrorContext> = {
        ...context,
        stackTrace: processedTrace.processed,
        userMessage: this.stackTraceProcessor.generateUserMessage(error, processedTrace),
        technicalDetails: this.stackTraceProcessor.extractTechnicalDetails(error, processedTrace),
        errorType: this.mapErrorSourceToType(processedTrace.errorSource),
        severity: ErrorSeverity.CRITICAL,
        recoverable: false
      };
      this.log(LogLevel.CRITICAL, message, enhancedContext);
    } else {
      this.log(LogLevel.CRITICAL, message, context);
    }
  }

  /**
   * Log with error context for enhanced error handling
   */
  public logError(message: string, errorContext: Partial<ErrorContext>, error?: Error): void {
    const logEntry = this.createLogEntry(LogLevel.ERROR, message, errorContext, error);
    
    if (this.isBackground) {
      this.processLogEntry(logEntry);
    } else {
      this.sendToBackground(logEntry);
    }
  }

  /**
   * Performance marking and measuring
   */
  // ========================================
  // Enhanced Performance Monitoring Methods
  // ========================================

  /**
   * Create a performance mark (legacy method, enhanced with PerformanceMonitor)
   */
  public mark(name: string): void {
    if (!this.config.enablePerformance) return;
    
    this.performanceMarks.set(name, performance.now());
    
    if (typeof performance.mark === 'function') {
      performance.mark(name);
    }
  }

  /**
   * Measure duration between marks (legacy method, enhanced with PerformanceMonitor)
   */
  public measure(name: string, startMark: string, endMark?: string): number | null {
    if (!this.config.enablePerformance) return null;
    
    const startTime = this.performanceMarks.get(startMark);
    const endTime = endMark ? this.performanceMarks.get(endMark) : performance.now();
    
    if (startTime && endTime) {
      const duration = endTime - startTime;
      
      this.debug(`Performance: ${name}`, {
        component: ComponentType.ERROR_HANDLER,
        action: 'performance_measure',
        performance: {
          duration,
          timing: { start: startTime, end: endTime }
        }
      });
      
      return duration;
    }
    
    return null;
  }

  /**
   * Start monitoring a performance operation
   */
  public startPerformanceOperation(name: string, metadata: OperationMetadata): void {
    if (!this.config.enablePerformance) return;
    
    this.performanceMonitor.startOperation(name, metadata);
    
    this.debug(`Started performance operation: ${name}`, {
      component: metadata.component,
      action: 'performance_operation_start',
      metadata: {
        operationType: metadata.operationType,
        inputSize: metadata.inputSize
      }
    });
  }

  /**
   * End monitoring a performance operation
   */
  public endPerformanceOperation(name: string, additionalMetadata?: Partial<OperationMetadata>): PerformanceMeasurement | null {
    if (!this.config.enablePerformance) return null;
    
    const measurement = this.performanceMonitor.endOperation(name, additionalMetadata);
    
    if (measurement) {
      const logLevel = measurement.isSlowOperation ? LogLevel.WARN : LogLevel.DEBUG;
      this.log(logLevel, `Performance operation completed: ${name}`, {
        component: measurement.metadata.component,
        action: measurement.isSlowOperation ? 'performance_slow_operation' : 'performance_operation_complete',
        performance: {
          duration: measurement.duration,
          timing: {
            start: measurement.startTime,
            end: measurement.endTime
          }
        },
        metadata: {
          operationType: measurement.metadata.operationType,
          isSlowOperation: measurement.isSlowOperation,
          threshold: measurement.threshold,
          memoryDelta: measurement.memoryDelta
        }
      });
    }
    
    return measurement;
  }

  /**
   * Measure an async operation with automatic performance tracking
   */
  public async measureAsyncOperation<T>(
    name: string,
    operation: () => Promise<T>,
    metadata: OperationMetadata
  ): Promise<T> {
    if (!this.config.enablePerformance) {
      return operation();
    }
    
    return this.performanceMonitor.measureAsync(name, operation, metadata);
  }

  /**
   * Measure a sync operation with automatic performance tracking
   */
  public measureSyncOperation<T>(
    name: string,
    operation: () => T,
    metadata: OperationMetadata
  ): T {
    if (!this.config.enablePerformance) {
      return operation();
    }
    
    return this.performanceMonitor.measureSync(name, operation, metadata);
  }

  /**
   * Get performance analytics from the PerformanceMonitor
   */
  public getPerformanceAnalytics(): PerformanceAnalytics | null {
    if (!this.config.enablePerformance) return null;
    
    return this.performanceMonitor.generateAnalytics();
  }

  /**
   * Update performance monitoring thresholds
   */
  public updatePerformanceThresholds(thresholds: Partial<import('./PerformanceMonitor').PerformanceThresholds>): void {
    if (!this.config.enablePerformance) return;
    
    this.performanceMonitor.updateThresholds(thresholds);
    
    this.info('Performance thresholds updated', {
      component: ComponentType.ERROR_HANDLER,
      action: 'performance_thresholds_update',
      metadata: { thresholds }
    });
  }

  /**
   * Get current performance monitoring statistics
   */
  public getPerformanceStats(): {
    activeOperations: number;
    totalMeasurements: number;
    isEnabled: boolean;
  } | null {
    if (!this.config.enablePerformance) return null;
    
    const stats = this.performanceMonitor.getStats();
    return {
      activeOperations: stats.activeOperations,
      totalMeasurements: stats.totalMeasurements,
      isEnabled: stats.isEnabled
    };
  }

  /**
   * Create log entry with full context
   */
  private createLogEntry(
    level: LogLevel, 
    message: string, 
    context: Partial<LogContext>, 
    error?: Error
  ): LogEntry {
    const timestamp = new Date().toISOString();
         const fullContext: LogContext = {
       component: ComponentType.ERROR_HANDLER,
      sessionId: this.sessionId,
      extensionVersion: this.extensionVersion,
      timestamp,
      url: typeof window !== 'undefined' ? window.location?.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      ...context
    };

    const logEntry: LogEntry = {
      id: generateLogId(),
      level,
      message: this.sanitizeMessage(message),
      timestamp,
      context: fullContext,
      error,
      fingerprint: generateFingerprint(level, message, fullContext.component)
    };

    return logEntry;
  }

  /**
   * Process log entry (background context only)
   */
  private processLogEntry(entry: LogEntry): void {
    if (!this.isBackground) return;

    // Rate limiting check
    if (!this.checkRateLimit(entry)) {
      return;
    }

    // Deduplication check
    if (!this.checkDeduplication(entry)) {
      return;
    }

    // Add to queue
    this.logQueue.push(entry);

    // Console logging
    if (this.config.enableConsole) {
      this.logToConsole(entry);
    }

    // Immediate flush for critical errors
    if (entry.level === LogLevel.CRITICAL || this.logQueue.length >= this.config.batching.batchSize) {
      this.flushLogs();
    }
  }

  /**
   * Send log entry to background service worker
   */
  private sendToBackground(entry: LogEntry): void {
    try {
      const message: LogMessage = {
        type: MessageType.LOG_EVENT,
        payload: { entry },
        sender: entry.context.component,
        timestamp: entry.timestamp
      };

      chrome.runtime.sendMessage(message).catch((error) => {
        // Fallback to console if background is unavailable
        console.error('[Logger] Failed to send to background:', error);
        this.logToConsole(entry);
      });
    } catch (error) {
      // Fallback to console
      this.logToConsole(entry);
    }
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(entry: LogEntry): boolean {
    if (!this.config.rateLimiting.enabled) return true;

    const key = `${entry.context.component}:${entry.level}`;
    const now = Date.now();
    const windowMs = 1000; // 1 second window
    
    let timestamps = this.rateLimitTracker.get(key) || [];
    timestamps = timestamps.filter(ts => now - ts < windowMs);
    
    if (timestamps.length >= this.config.rateLimiting.maxLogsPerSecond) {
      return false;
    }
    
    timestamps.push(now);
    this.rateLimitTracker.set(key, timestamps);
    return true;
  }

  /**
   * Check deduplication
   */
  private checkDeduplication(entry: LogEntry): boolean {
    if (!this.config.deduplication.enabled || !entry.fingerprint) return true;

    const now = Date.now();
    const cached = this.deduplicationCache.get(entry.fingerprint);
    
    if (cached && now - cached.lastSeen < this.config.deduplication.windowMs) {
      if (cached.count >= this.config.deduplication.maxDuplicates) {
        return false;
      }
      cached.count++;
      cached.lastSeen = now;
      return false; // Skip this duplicate but update count
    }
    
    this.deduplicationCache.set(entry.fingerprint, { count: 1, lastSeen: now });
    return true;
  }

  /**
   * Log to console with appropriate method
   */
  private logToConsole(entry: LogEntry): void {
    const prefix = `[${entry.context.component}]`;
    const message = `${prefix} ${entry.message}`;
    
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message, entry.context);
        break;
      case LogLevel.INFO:
        console.info(message, entry.context);
        break;
      case LogLevel.WARN:
        console.warn(message, entry.context);
        break;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        console.error(message, entry.context, entry.error);
        break;
    }
  }

  /**
   * Flush queued logs to storage
   */
  private async flushLogs(): Promise<void> {
    if (this.logQueue.length === 0 || !this.config.enableStorage) return;

    try {
      const logsToFlush = [...this.logQueue];
      this.logQueue = [];

      const storedEntries: StoredLogEntry[] = logsToFlush.map(entry => ({
        ...entry,
        stored: new Date().toISOString(),
        version: this.extensionVersion,
        environment: isProduction() ? 'production' : 'development'
      }));

      // Get existing logs
      const result = await chrome.storage.local.get(['logs']);
      const existingLogs: StoredLogEntry[] = result.logs || [];
      
      // Add new logs
      const allLogs = [...existingLogs, ...storedEntries];
      
      // Enforce limits
      const limitedLogs = this.enforceLimits(allLogs);
      
      // Save back to storage
      await chrome.storage.local.set({ logs: limitedLogs });
      
    } catch (error) {
      console.error('[Logger] Failed to flush logs:', error);
      // Re-add failed logs to queue
      this.logQueue.unshift(...this.logQueue);
    }
  }

  /**
   * Enforce storage limits
   */
  private enforceLimits(logs: StoredLogEntry[]): StoredLogEntry[] {
    // Sort by timestamp (newest first)
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // Enforce max entries
    if (logs.length > this.config.maxEntries) {
      logs = logs.slice(0, this.config.maxEntries);
    }
    
    // Enforce retention period
    const cutoffDate = new Date(Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000);
    logs = logs.filter(log => new Date(log.timestamp) > cutoffDate);
    
    return logs;
  }

  /**
   * Clean up old logs
   */
  private async cleanupOldLogs(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['logs']);
      const logs: StoredLogEntry[] = result.logs || [];
      
      const cleanedLogs = this.enforceLimits(logs);
      
      if (cleanedLogs.length !== logs.length) {
        await chrome.storage.local.set({ logs: cleanedLogs });
        this.info('Cleaned up old logs', {
          component: ComponentType.BACKGROUND,
          action: 'cleanup',
          metadata: {
            removed: logs.length - cleanedLogs.length,
            remaining: cleanedLogs.length
          }
        });
      }
    } catch (error) {
      console.error('[Logger] Cleanup failed:', error);
    }
  }

  /**
   * Check if log level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.minLevel];
  }

  /**
   * Sanitize message to remove sensitive data
   */
  private sanitizeMessage(message: string): string {
    let sanitized = message;
    
    this.config.sensitiveDataPatterns.forEach(pattern => {
      const regex = new RegExp(pattern, 'gi');
      sanitized = sanitized.replace(regex, '[REDACTED]');
    });
    
    return sanitized;
  }

  /**
   * Internal logging method to avoid recursion
   */
  private logInternal(level: LogLevel, message: string, context: LogContext): void {
    if (this.isBackground) {
      const entry = this.createLogEntry(level, message, context);
      this.processLogEntry(entry);
    }
  }

  /**
   * Update logger configuration
   */
  public updateConfig(newConfig: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    this.info('Logger configuration updated', {
      component: ComponentType.ERROR_HANDLER,
      action: 'config_update',
      metadata: newConfig
    });
  }

  /**
   * Get logger statistics
   */
  public async getStats(): Promise<LoggerStats | null> {
    if (!this.isBackground) return null;

    try {
      const result = await chrome.storage.local.get(['logs']);
      const logs: StoredLogEntry[] = result.logs || [];
      
      const stats: LoggerStats = {
        totalEntries: logs.length,
        entriesByLevel: this.countByField(logs, 'level'),
        entriesByComponent: this.countByField(logs, 'context.component'),
        errorsByType: this.countErrorsByType(logs),
        storageUsage: {
          bytes: JSON.stringify(logs).length,
          percentage: (JSON.stringify(logs).length / this.config.maxStorageSize) * 100
        },
        performance: this.calculatePerformanceStats(logs),
        timeRange: {
          oldest: logs.length > 0 ? logs[logs.length - 1].timestamp : '',
          newest: logs.length > 0 ? logs[0].timestamp : ''
        }
      };
      
      return stats;
    } catch (error) {
      console.error('[Logger] Failed to get stats:', error);
      return null;
    }
  }

  /**
   * Helper method to count entries by field
   */
  private countByField(logs: StoredLogEntry[], field: string): Record<string, number> {
    const counts: Record<string, number> = {};
    
    logs.forEach(log => {
      const value = this.getNestedValue(log, field);
      if (value) {
        counts[value] = (counts[value] || 0) + 1;
      }
    });
    
    return counts;
  }

  /**
   * Get nested object value by dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Count errors by type
   */
  private countErrorsByType(logs: StoredLogEntry[]): Record<string, number> {
    const counts: Record<string, number> = {};
    
    logs.forEach(log => {
      if (log.errorContext?.errorType) {
        const type = log.errorContext.errorType;
        counts[type] = (counts[type] || 0) + 1;
      }
    });
    
    return counts;
  }

  /**
   * Calculate performance statistics
   */
  private calculatePerformanceStats(logs: StoredLogEntry[]): LoggerStats['performance'] {
    const performanceLogs = logs.filter(log => log.context.performance?.duration);
    
    if (performanceLogs.length === 0) {
      return { avgLogTime: 0, slowestLog: 0, totalLogTime: 0 };
    }
    
    const durations = performanceLogs.map(log => log.context.performance!.duration!);
    const totalLogTime = durations.reduce((sum, duration) => sum + duration, 0);
    
    return {
      avgLogTime: totalLogTime / durations.length,
      slowestLog: Math.max(...durations),
      totalLogTime
    };
  }

  /**
   * Export logs
   */
  public async exportLogs(format: 'json' | 'csv' | 'txt', filters?: LogFilters): Promise<string | null> {
    if (!this.isBackground) return null;

    try {
      const result = await chrome.storage.local.get(['logs']);
      let logs: StoredLogEntry[] = result.logs || [];
      
      // Apply filters
      if (filters) {
        logs = this.applyFilters(logs, filters);
      }
      
      switch (format) {
        case 'json':
          return JSON.stringify(logs, null, 2);
        case 'csv':
          return this.convertToCsv(logs);
        case 'txt':
          return this.convertToText(logs);
        default:
          return null;
      }
    } catch (error) {
      console.error('[Logger] Export failed:', error);
      return null;
    }
  }

  /**
   * Apply filters to logs
   */
  private applyFilters(logs: StoredLogEntry[], filters: LogFilters): StoredLogEntry[] {
    return logs.filter(log => {
      if (filters.levels && !filters.levels.includes(log.level)) return false;
      if (filters.components && !filters.components.includes(log.context.component)) return false;
      if (filters.search && !log.message.toLowerCase().includes(filters.search.toLowerCase())) return false;
      
      if (filters.timeRange) {
        const logTime = new Date(log.timestamp).getTime();
        const start = new Date(filters.timeRange.start).getTime();
        const end = new Date(filters.timeRange.end).getTime();
        if (logTime < start || logTime > end) return false;
      }
      
      return true;
    });
  }

  /**
   * Convert logs to CSV format
   */
  private convertToCsv(logs: StoredLogEntry[]): string {
    const headers = ['Timestamp', 'Level', 'Component', 'Message', 'Action'];
    const rows = logs.map(log => [
      log.timestamp,
      log.level,
      log.context.component,
      `"${log.message.replace(/"/g, '""')}"`,
      log.context.action || ''
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  /**
   * Convert logs to text format
   */
  private convertToText(logs: StoredLogEntry[]): string {
    return logs.map(log => 
      `[${log.timestamp}] ${log.level.toUpperCase()} [${log.context.component}] ${log.message}`
    ).join('\n');
  }

  /**
   * Clear logs
   */
  public async clearLogs(filters?: LogFilters): Promise<boolean> {
    if (!this.isBackground) return false;

    try {
      if (!filters) {
        // Clear all logs
        await chrome.storage.local.remove(['logs']);
      } else {
        // Clear filtered logs
        const result = await chrome.storage.local.get(['logs']);
        const logs: StoredLogEntry[] = result.logs || [];
        const filteredLogs = this.applyFilters(logs, filters);
        const remainingLogs = logs.filter(log => !filteredLogs.includes(log));
        await chrome.storage.local.set({ logs: remainingLogs });
      }
      
      this.info('Logs cleared', {
        component: ComponentType.BACKGROUND,
        action: 'clear_logs',
        metadata: { filters }
      });
      
      return true;
    } catch (error) {
      console.error('[Logger] Clear logs failed:', error);
      return false;
    }
  }

  // ========================================
  // Stack Trace Processing Helper Methods
  // ========================================

  /**
   * Map error source to error type
   */
  private mapErrorSourceToType(errorSource: ErrorSource): ErrorType {
    switch (errorSource) {
      case ErrorSource.EXTENSION_CODE:
      case ErrorSource.BACKGROUND_SCRIPT:
      case ErrorSource.CONTENT_SCRIPT:
      case ErrorSource.POPUP_SCRIPT:
        return ErrorType.BACKGROUND;
      case ErrorSource.BROWSER_API:
        return ErrorType.API;
      case ErrorSource.THIRD_PARTY:
        return ErrorType.UNKNOWN;
      case ErrorSource.USER_SCRIPT:
        return ErrorType.CONTENT_SCRIPT;
      default:
        return ErrorType.UNKNOWN;
    }
  }

  /**
   * Determine error severity from processed stack trace
   */
  private determineSeverityFromTrace(processedTrace: ProcessedStackTrace): ErrorSeverity {
    // If error originates from extension code, it's more critical
    if (processedTrace.frames.some(f => f.isExtensionCode)) {
      return ErrorSeverity.HIGH;
    }
    
    // Third-party errors are less critical
    if (processedTrace.errorSource === ErrorSource.THIRD_PARTY) {
      return ErrorSeverity.LOW;
    }
    
    // Browser API errors are medium severity
    if (processedTrace.errorSource === ErrorSource.BROWSER_API) {
      return ErrorSeverity.MEDIUM;
    }
    
    return ErrorSeverity.MEDIUM;
  }

  /**
   * Determine if error is recoverable based on stack trace
   */
  private isRecoverableError(error: Error, processedTrace: ProcessedStackTrace): boolean {
    // Network errors are typically recoverable
    if (error.name === 'NetworkError' || error.message.includes('fetch')) {
      return true;
    }
    
    // Permission errors are not recoverable without user action
    if (error.message.includes('permission') || error.message.includes('denied')) {
      return false;
    }
    
    // Third-party errors don't affect core functionality
    if (processedTrace.errorSource === ErrorSource.THIRD_PARTY) {
      return true;
    }
    
    // Extension code errors may be recoverable depending on context
    if (processedTrace.frames.some(f => f.isExtensionCode)) {
      return !error.message.includes('Cannot read') && !error.message.includes('undefined');
    }
    
    return true;
  }

  /**
   * Destroy logger instance
   */
  public destroy(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    
    // Flush remaining logs
    if (this.logQueue.length > 0) {
      this.flushLogs();
    }
    
    // Clean up resources
    this.logQueue = [];
    this.rateLimitTracker.clear();
    this.deduplicationCache.clear();
    this.performanceMarks.clear();
    
    // Clean up PerformanceMonitor
    if (this.performanceMonitor) {
      this.performanceMonitor.destroy();
    }
    
    Logger.instance = null;
  }
} 