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
  ErrorSeverity,
} from './types';
import { StackTraceProcessor, ProcessedStackTrace, ErrorSource } from './StackTraceProcessor';
import {
  PerformanceMonitor,
  OperationMetadata,
  PerformanceMeasurement,
  PerformanceAnalytics,
} from './PerformanceMonitor';
import { ErrorNotificationService, NotificationType } from './ErrorNotificationService';
import { RateLimitingService, createRateLimitingServiceFromConfig } from './RateLimitingService';
import type { RateLimitStats, DeduplicationStats } from './RateLimitingService';
import { DebugModeService, createDebugModeService } from './DebugModeService';
import { GracefulDegradationService } from './GracefulDegradationService';
import type { FeatureState, SystemHealth, FeatureStatus } from './GracefulDegradationService';
import { ErrorRecoveryService, RecoveryResult } from './ErrorRecoveryService';
import type { RecoveryStats } from './ErrorRecoveryService';
import { ConsoleLoggingService, createConsoleLoggingService } from './ConsoleLoggingService';
import type { ConsoleLoggingConfig, ConsolePerformanceStats } from './ConsoleLoggingService';

/**
 * Centralized Logger Service for Chrome Extension
 * Handles logging across all extension contexts (background, content script, popup)
 */
export class Logger {
  private static instance: Logger | null = null;
  private config: LoggerConfig;
  private logQueue: LogEntry[] = [];
  private performanceMarks: Map<string, number> = new Map();
  private batchTimer: number | null = null;
  private isBackground: boolean;
  private sessionId: string;
  private extensionVersion: string;
  private stackTraceProcessor: StackTraceProcessor;
  private performanceMonitor: PerformanceMonitor | null;
  private notificationService: ErrorNotificationService | null;
  private rateLimitingService: RateLimitingService | null;
  private debugModeService: DebugModeService | null;
  private gracefulDegradationService: GracefulDegradationService | null;
  private errorRecoveryService: ErrorRecoveryService | null;
  private consoleLoggingService: ConsoleLoggingService | null;

  private constructor(config?: Partial<LoggerConfig>) {
    this.config = { ...DEFAULT_LOGGER_CONFIG, ...config };
    this.isBackground = this.detectBackgroundContext();
    this.sessionId = this.generateSessionId();
    this.extensionVersion = chrome.runtime.getManifest().version;
    this.stackTraceProcessor = StackTraceProcessor.getInstance();
    // Initialize PerformanceMonitor lazily to avoid circular dependency
    this.performanceMonitor = null;
    // Initialize ErrorNotificationService lazily to avoid circular dependency
    this.notificationService = null;
    // Initialize RateLimitingService
    this.rateLimitingService = createRateLimitingServiceFromConfig(this.config);
    // Initialize DebugModeService
    this.debugModeService = createDebugModeService(this.config);
    // Initialize GracefulDegradationService
    this.gracefulDegradationService = GracefulDegradationService.getInstance();
    // Initialize ErrorRecoveryService
    this.errorRecoveryService = ErrorRecoveryService.getInstance();
    // Initialize ConsoleLoggingService
    this.consoleLoggingService = createConsoleLoggingService();

    this.initialize();
  }

  /**
   * Get singleton instance of Logger
   */
  public static getInstance(config?: Partial<LoggerConfig>): Logger | null {
    if (typeof window === 'undefined') {
      return null;
    }
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  /**
   * Lazy initialization of PerformanceMonitor to avoid circular dependency
   */
  private ensurePerformanceMonitor(): PerformanceMonitor {
    if (!this.performanceMonitor) {
      this.performanceMonitor = PerformanceMonitor.getInstance();
    }
    return this.performanceMonitor;
  }

  /**
   * Lazy initialization of ErrorNotificationService to avoid circular dependency
   */
  private ensureNotificationService(): ErrorNotificationService {
    if (!this.notificationService) {
      this.notificationService = ErrorNotificationService.getInstance();
      // Initialize the service if we're in a content script or popup context
      if (!this.isBackground) {
        this.notificationService.initialize().catch((error) => {
          console.error('[Logger] Failed to initialize notification service:', error);
        });
      }
    }
    return this.notificationService;
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
        sessionId: this.sessionId,
      },
    });
  }

  /**
   * Detect if running in background context
   */
  private detectBackgroundContext(): boolean {
    try {
      // Background service worker has access to chrome.runtime.onMessage
      return typeof chrome?.runtime?.onMessage !== 'undefined' && typeof document === 'undefined';
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
    chrome.runtime.onMessage.addListener(
      (
        message: LogMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: any) => void,
      ) => {
        try {
          if (message.type === MessageType.LOG_EVENT) {
            const payload = message.payload as LogEventPayload;
            this.processLogEntry(payload.entry);
            sendResponse({ success: true });
          } else if (message.type === MessageType.LOG_BATCH) {
            const payload = message.payload as LogBatchPayload;
            payload.entries.forEach((entry) => this.processLogEntry(entry));
            sendResponse({ success: true });
          }
        } catch (error) {
          console.error('[Logger] Error processing message:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          sendResponse({ success: false, error: errorMessage });
        }
        return true; // Keep message channel open for async response
      },
    );
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
      setInterval(
        () => {
          this.cleanupOldLogs();
        },
        60 * 60 * 1000,
      );
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
      const processedTrace = this.stackTraceProcessor.processError(error, {
        component: context.component,
      });
      const enhancedContext: Partial<ErrorContext> = {
        ...context,
        stackTrace: processedTrace.processed,
        userMessage: this.stackTraceProcessor.generateUserMessage(error, processedTrace),
        technicalDetails: this.stackTraceProcessor.extractTechnicalDetails(error, processedTrace),
        errorType: this.mapErrorSourceToType(processedTrace.errorSource),
        severity: this.determineSeverityFromTrace(processedTrace),
        recoverable: this.isRecoverableError(error, processedTrace),
      };

      // Attempt error recovery before triggering graceful degradation
      if (
        this.errorRecoveryService &&
        context.component &&
        enhancedContext.errorType &&
        enhancedContext.severity
      ) {
        const componentType = context.component;
        this.errorRecoveryService
          .attemptRecovery(
            error,
            componentType,
            enhancedContext.errorType,
            enhancedContext.severity,
            context.metadata,
          )
          .then((recoveryResult) => {
            if (
              recoveryResult === RecoveryResult.SUCCESS ||
              recoveryResult === RecoveryResult.PARTIAL_SUCCESS
            ) {
              this.log(
                LogLevel.INFO,
                `Error recovery succeeded for ${componentType}: ${recoveryResult}`,
              );
            } else {
              // If recovery failed, report to graceful degradation service
              if (this.gracefulDegradationService) {
                const featureName = this.mapComponentToFeatureName(componentType);
                if (featureName && enhancedContext.severity !== ErrorSeverity.LOW) {
                  this.gracefulDegradationService
                    .reportFeatureFailure(featureName, error, {
                      severity: enhancedContext.severity,
                      userImpact:
                        enhancedContext.severity === ErrorSeverity.CRITICAL
                          ? 'critical'
                          : enhancedContext.severity === ErrorSeverity.HIGH
                            ? 'high'
                            : 'medium',
                    })
                    .catch((degradationError) => {
                      console.error('[Logger] Failed to report feature failure:', degradationError);
                    });
                }
              }
            }
          })
          .catch((recoveryError) => {
            console.error('[Logger] Error recovery attempt failed:', recoveryError);

            // Still report to graceful degradation service as fallback
            if (this.gracefulDegradationService) {
              const featureName = this.mapComponentToFeatureName(componentType);
              if (featureName && enhancedContext.severity !== ErrorSeverity.LOW) {
                this.gracefulDegradationService
                  .reportFeatureFailure(featureName, error, {
                    severity: enhancedContext.severity,
                    userImpact:
                      enhancedContext.severity === ErrorSeverity.CRITICAL
                        ? 'critical'
                        : enhancedContext.severity === ErrorSeverity.HIGH
                          ? 'high'
                          : 'medium',
                  })
                  .catch((degradationError) => {
                    console.error('[Logger] Failed to report feature failure:', degradationError);
                  });
              }
            }
          });
      }

      this.log(LogLevel.ERROR, message, enhancedContext);
    } else {
      this.log(LogLevel.ERROR, message, context);
    }
  }

  public critical(message: string, context: Partial<LogContext> = {}, error?: Error): void {
    if (error) {
      const processedTrace = this.stackTraceProcessor.processError(error, {
        component: context.component,
      });
      const enhancedContext: Partial<ErrorContext> = {
        ...context,
        stackTrace: processedTrace.processed,
        userMessage: this.stackTraceProcessor.generateUserMessage(error, processedTrace),
        technicalDetails: this.stackTraceProcessor.extractTechnicalDetails(error, processedTrace),
        errorType: this.mapErrorSourceToType(processedTrace.errorSource),
        severity: ErrorSeverity.CRITICAL,
        recoverable: false,
      };

      // Always report critical errors to graceful degradation service
      if (this.gracefulDegradationService && context.component) {
        const featureName = this.mapComponentToFeatureName(context.component);
        if (featureName) {
          this.gracefulDegradationService
            .reportFeatureFailure(featureName, error, {
              severity: ErrorSeverity.CRITICAL,
              userImpact: 'critical',
            })
            .catch((degradationError) => {
              console.error(
                '[Logger] Failed to report critical feature failure:',
                degradationError,
              );
            });
        }
      }

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
          timing: { start: startTime, end: endTime },
        },
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

    const performanceMonitor = this.ensurePerformanceMonitor();
    performanceMonitor.startOperation(name, metadata);

    this.debug(`Started performance operation: ${name}`, {
      component: metadata.component,
      action: 'performance_operation_start',
      metadata: {
        operationType: metadata.operationType,
        inputSize: metadata.inputSize,
      },
    });
  }

  /**
   * End monitoring a performance operation
   */
  public endPerformanceOperation(
    name: string,
    additionalMetadata?: Partial<OperationMetadata>,
  ): PerformanceMeasurement | null {
    if (!this.config.enablePerformance) return null;

    const performanceMonitor = this.ensurePerformanceMonitor();
    const measurement = performanceMonitor.endOperation(name, additionalMetadata);

    if (measurement) {
      const logLevel = measurement.isSlowOperation ? LogLevel.WARN : LogLevel.DEBUG;
      this.log(logLevel, `Performance operation completed: ${name}`, {
        component: measurement.metadata.component,
        action: measurement.isSlowOperation
          ? 'performance_slow_operation'
          : 'performance_operation_complete',
        performance: {
          duration: measurement.duration,
          timing: {
            start: measurement.startTime,
            end: measurement.endTime,
          },
        },
        metadata: {
          operationType: measurement.metadata.operationType,
          isSlowOperation: measurement.isSlowOperation,
          threshold: measurement.threshold,
          memoryDelta: measurement.memoryDelta,
        },
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
    metadata: OperationMetadata,
  ): Promise<T> {
    if (!this.config.enablePerformance) {
      return operation();
    }

    const performanceMonitor = this.ensurePerformanceMonitor();
    return performanceMonitor.measureAsync(name, operation, metadata);
  }

  /**
   * Measure a sync operation with automatic performance tracking
   */
  public measureSyncOperation<T>(name: string, operation: () => T, metadata: OperationMetadata): T {
    if (!this.config.enablePerformance) {
      return operation();
    }

    const performanceMonitor = this.ensurePerformanceMonitor();
    return performanceMonitor.measureSync(name, operation, metadata);
  }

  /**
   * Get performance analytics from the PerformanceMonitor
   */
  public getPerformanceAnalytics(): PerformanceAnalytics | null {
    if (!this.config.enablePerformance) return null;

    const performanceMonitor = this.ensurePerformanceMonitor();
    return performanceMonitor.generateAnalytics();
  }

  /**
   * Update performance monitoring thresholds
   */
  public updatePerformanceThresholds(
    thresholds: Partial<import('./PerformanceMonitor').PerformanceThresholds>,
  ): void {
    if (!this.config.enablePerformance) return;

    const performanceMonitor = this.ensurePerformanceMonitor();
    performanceMonitor.updateThresholds(thresholds);

    this.info('Performance thresholds updated', {
      component: ComponentType.ERROR_HANDLER,
      action: 'performance_thresholds_update',
      metadata: { thresholds },
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

    const performanceMonitor = this.ensurePerformanceMonitor();
    const stats = performanceMonitor.getStats();
    return {
      activeOperations: stats.activeOperations,
      totalMeasurements: stats.totalMeasurements,
      isEnabled: stats.isEnabled,
    };
  }

  /**
   * Create log entry with full context
   */
  private createLogEntry(
    level: LogLevel,
    message: string,
    context: Partial<LogContext>,
    error?: Error,
  ): LogEntry {
    const timestamp = new Date().toISOString();
    const fullContext: LogContext = {
      component: ComponentType.ERROR_HANDLER,
      sessionId: this.sessionId,
      extensionVersion: this.extensionVersion,
      timestamp,
      url: typeof window !== 'undefined' ? window.location?.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      ...context,
    };

    const logEntry: LogEntry = {
      id: generateLogId(),
      level,
      message: this.sanitizeMessage(message),
      timestamp,
      context: fullContext,
      error,
      fingerprint: generateFingerprint(level, message, fullContext.component),
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
    const dedupResult = this.checkDeduplication(entry);
    if (!dedupResult.shouldLog) {
      return;
    }

    // Use modified entry if available (for deduplication messages)
    const finalEntry = dedupResult.modifiedEntry || entry;

    // Process with debug mode service
    if (this.debugModeService && this.config.debugMode) {
      this.debugModeService.processLogEntry(finalEntry);
    }

    // Show user notification for error conditions (only in content script/popup contexts)
    if (!this.isBackground && this.config.enableErrorReporting) {
      this.showUserNotificationIfNeeded(finalEntry);
    }

    // Add to queue
    this.logQueue.push(finalEntry);

    // Console logging
    if (this.config.enableConsole) {
      this.logToConsole(entry);
    }

    // Immediate flush for critical errors
    if (
      entry.level === LogLevel.CRITICAL ||
      this.logQueue.length >= this.config.batching.batchSize
    ) {
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
        level: entry.level,
        payload: { entry },
        sender: entry.context.component,
        timestamp: entry.timestamp,
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
    if (!this.rateLimitingService) return true;
    return this.rateLimitingService.checkRateLimit(entry);
  }

  /**
   * Show user notification if conditions are met
   */
  private showUserNotificationIfNeeded(entry: LogEntry): void {
    try {
      const notificationService = this.ensureNotificationService();
      notificationService.showFromLogEntry(entry).catch((error) => {
        // Don't log notification errors to avoid infinite loops
        console.error('[Logger] Failed to show user notification:', error);
      });
    } catch (error) {
      // Silently handle notification service errors
      console.error('[Logger] Notification service error:', error);
    }
  }

  /**
   * Check deduplication and return result with potentially modified entry
   */
  private checkDeduplication(entry: LogEntry): { shouldLog: boolean; modifiedEntry?: LogEntry } {
    if (!this.rateLimitingService) return { shouldLog: true };

    const result = this.rateLimitingService.checkDeduplication(entry);

    // Create a modified entry if we have deduplication info
    if (result.dedupInfo && result.shouldLog && result.dedupInfo.count > 1) {
      const modifiedEntry: LogEntry = {
        ...entry,
        message: result.dedupInfo.message,
      };
      return { shouldLog: result.shouldLog, modifiedEntry };
    }

    return { shouldLog: result.shouldLog };
  }

  /**
   * Log to console with appropriate method
   */
  private logToConsole(entry: LogEntry): void {
    if (this.consoleLoggingService) {
      this.consoleLoggingService.processLogEntry(entry);
    } else {
      // Fallback to basic console output
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
  }

  /**
   * Flush queued logs to storage
   */
  private async flushLogs(): Promise<void> {
    if (this.logQueue.length === 0 || !this.config.enableStorage) return;

    try {
      const logsToFlush = [...this.logQueue];
      this.logQueue = [];

      const storedEntries: StoredLogEntry[] = logsToFlush.map((entry) => ({
        ...entry,
        stored: new Date().toISOString(),
        version: this.extensionVersion,
        environment: isProduction() ? 'production' : 'development',
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
    logs = logs.filter((log) => new Date(log.timestamp) > cutoffDate);

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
            remaining: cleanedLogs.length,
          },
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

    this.config.sensitiveDataPatterns.forEach((pattern) => {
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
      metadata: newConfig,
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
          percentage: (JSON.stringify(logs).length / this.config.maxStorageSize) * 100,
        },
        performance: this.calculatePerformanceStats(logs),
        timeRange: {
          oldest: logs.length > 0 ? logs[logs.length - 1].timestamp : '',
          newest: logs.length > 0 ? logs[0].timestamp : '',
        },
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

    logs.forEach((log) => {
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

    logs.forEach((log) => {
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
    const performanceLogs = logs.filter((log) => log.context.performance?.duration);

    if (performanceLogs.length === 0) {
      return { avgLogTime: 0, slowestLog: 0, totalLogTime: 0 };
    }

    const durations = performanceLogs.map((log) => log.context.performance!.duration!);
    const totalLogTime = durations.reduce((sum, duration) => sum + duration, 0);

    return {
      avgLogTime: totalLogTime / durations.length,
      slowestLog: Math.max(...durations),
      totalLogTime,
    };
  }

  /**
   * Export logs
   */
  public async exportLogs(
    format: 'json' | 'csv' | 'txt',
    filters?: LogFilters,
  ): Promise<string | null> {
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
    return logs.filter((log) => {
      if (filters.levels && !filters.levels.includes(log.level)) return false;
      if (filters.components && !filters.components.includes(log.context.component)) return false;
      if (filters.search && !log.message.toLowerCase().includes(filters.search.toLowerCase()))
        return false;

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
    const rows = logs.map((log) => [
      log.timestamp,
      log.level,
      log.context.component,
      `"${log.message.replace(/"/g, '""')}"`,
      log.context.action || '',
    ]);

    return [headers, ...rows].map((row) => row.join(',')).join('\n');
  }

  /**
   * Convert logs to text format
   */
  private convertToText(logs: StoredLogEntry[]): string {
    return logs
      .map(
        (log) =>
          `[${log.timestamp}] ${log.level.toUpperCase()} [${log.context.component}] ${log.message}`,
      )
      .join('\n');
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
        const remainingLogs = logs.filter((log) => !filteredLogs.includes(log));
        await chrome.storage.local.set({ logs: remainingLogs });
      }

      this.info('Logs cleared', {
        component: ComponentType.BACKGROUND,
        action: 'clear_logs',
        metadata: { filters },
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
    if (processedTrace.frames.some((f) => f.isExtensionCode)) {
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
    if (processedTrace.frames.some((f) => f.isExtensionCode)) {
      return !error.message.includes('Cannot read') && !error.message.includes('undefined');
    }

    return true;
  }

  /**
   * Map component type to graceful degradation feature name
   */
  private mapComponentToFeatureName(component: ComponentType): string | null {
    switch (component) {
      case ComponentType.TRANSLATION_SERVICE:
        return 'translation';
      case ComponentType.SUBTITLE_MANAGER:
        return 'subtitles';
      case ComponentType.DICTIONARY_SERVICE:
        return 'dictionary';
      case ComponentType.TTS_SERVICE:
        return 'tts';
      case ComponentType.STORAGE_SERVICE:
        return 'storage';
      case ComponentType.YOUTUBE_INTEGRATION:
        return 'youtube';
      default:
        return null;
    }
  }

  /**
   * Get rate limiting statistics
   */
  public getRateLimitingStats(): RateLimitStats | null {
    if (!this.rateLimitingService) return null;
    return this.rateLimitingService.getRateLimitStats();
  }

  /**
   * Get deduplication statistics
   */
  public getDeduplicationStats(): DeduplicationStats | null {
    if (!this.rateLimitingService) return null;
    return this.rateLimitingService.getDeduplicationStats();
  }

  /**
   * Reset rate limiting and deduplication statistics
   */
  public resetRateLimitingStats(): void {
    if (this.rateLimitingService) {
      this.rateLimitingService.reset();
    }
  }

  /**
   * Update rate limiting and deduplication configuration
   */
  public updateRateLimitingConfig(config: {
    rateLimiting?: Partial<import('./RateLimitingService').RateLimitConfig>;
    deduplication?: Partial<import('./RateLimitingService').DeduplicationConfig>;
  }): void {
    if (this.rateLimitingService) {
      this.rateLimitingService.updateConfig(config.rateLimiting, config.deduplication);
    }
  }

  /**
   * Check if debug mode is enabled
   */
  public isDebugModeEnabled(): boolean {
    return this.debugModeService ? this.debugModeService.isEnabled() : false;
  }

  /**
   * Get debug mode statistics
   */
  public getDebugStats(): import('./DebugModeService').DebugStats | null {
    return this.debugModeService ? this.debugModeService.getStats() : null;
  }

  /**
   * Update debug mode configuration
   */
  public updateDebugModeConfig(
    config: Partial<import('./DebugModeService').DebugModeConfig>,
  ): void {
    if (this.debugModeService) {
      this.debugModeService.updateConfig(config);
    }
  }

  /**
   * Export debug data for analysis
   */
  public exportDebugData(): string | null {
    return this.debugModeService ? this.debugModeService.exportDebugData() : null;
  }

  /**
   * Get system health overview from graceful degradation service
   */
  public getSystemHealth(): SystemHealth | null {
    return this.gracefulDegradationService
      ? this.gracefulDegradationService.getSystemHealth()
      : null;
  }

  /**
   * Get feature status from graceful degradation service
   */
  public getFeatureStatus(featureName?: string): FeatureStatus | FeatureStatus[] | null {
    if (!this.gracefulDegradationService) return null;
    try {
      return this.gracefulDegradationService.getFeatureStatus(featureName);
    } catch (error) {
      console.error('[Logger] Failed to get feature status:', error);
      return null;
    }
  }

  /**
   * Attempt to recover a specific feature
   */
  public async attemptFeatureRecovery(featureName: string): Promise<boolean> {
    if (!this.gracefulDegradationService) return false;
    try {
      return await this.gracefulDegradationService.attemptFeatureRecovery(featureName);
    } catch (error) {
      console.error('[Logger] Failed to attempt feature recovery:', error);
      return false;
    }
  }

  /**
   * Get degradation event history
   */
  public getDegradationHistory(
    featureName?: string,
    limit?: number,
  ): import('./GracefulDegradationService').DegradationEvent[] {
    if (!this.gracefulDegradationService) return [];
    return this.gracefulDegradationService.getDegradationHistory(featureName, limit);
  }

  /**
   * Get error recovery statistics
   */
  public getRecoveryStats(): RecoveryStats | null {
    return this.errorRecoveryService ? this.errorRecoveryService.getStats() : null;
  }

  /**
   * Get error recovery history
   */
  public getRecoveryHistory(
    component?: ComponentType,
    limit?: number,
  ): import('./ErrorRecoveryService').RecoveryAttempt[] {
    if (!this.errorRecoveryService) return [];
    return this.errorRecoveryService.getHistory(component, limit);
  }

  /**
   * Check if a component is currently being recovered
   */
  public isComponentRecovering(component: ComponentType): boolean {
    return this.errorRecoveryService ? this.errorRecoveryService.isRecovering(component) : false;
  }

  /**
   * Update error recovery configuration
   */
  public updateRecoveryConfig(
    config: Partial<import('./ErrorRecoveryService').RecoveryConfig>,
  ): void {
    if (this.errorRecoveryService) {
      this.errorRecoveryService.updateConfig(config);
    }
  }

  /**
   * Get console logging configuration
   */
  public getConsoleLoggingConfig(): ConsoleLoggingConfig | null {
    return this.consoleLoggingService?.getConfig() || null;
  }

  /**
   * Update console logging configuration
   */
  public updateConsoleLoggingConfig(config: Partial<ConsoleLoggingConfig>): void {
    if (this.consoleLoggingService) {
      this.consoleLoggingService.updateConfig(config);
    }
  }

  /**
   * Get console logging performance statistics
   */
  public getConsoleLoggingStats(): ConsolePerformanceStats | null {
    return this.consoleLoggingService?.getStats() || null;
  }

  /**
   * Reset console logging statistics
   */
  public resetConsoleLoggingStats(): void {
    if (this.consoleLoggingService) {
      this.consoleLoggingService.resetStats();
    }
  }

  /**
   * Enable or disable console logging
   */
  public setConsoleLoggingEnabled(enabled: boolean): void {
    if (this.consoleLoggingService) {
      this.consoleLoggingService.setEnabled(enabled);
    }
  }

  /**
   * Set console log level filtering
   */
  public setConsoleLogLevels(levels: LogLevel[]): void {
    if (this.consoleLoggingService) {
      this.consoleLoggingService.setEnabledLevels(levels);
    }
  }

  /**
   * Set console component filtering
   */
  public setConsoleLogComponents(components: ComponentType[]): void {
    if (this.consoleLoggingService) {
      this.consoleLoggingService.setEnabledComponents(components);
    }
  }

  /**
   * Set silent components (suppress console output)
   */
  public setSilentComponents(components: ComponentType[]): void {
    if (this.consoleLoggingService) {
      this.consoleLoggingService.setSilentComponents(components);
    }
  }

  /**
   * Clear console groups
   */
  public clearConsoleGroups(): void {
    if (this.consoleLoggingService) {
      this.consoleLoggingService.clearGroups();
    }
  }

  /**
   * Export console logs and statistics
   */
  public exportConsoleLogsData(): string | null {
    return this.consoleLoggingService?.exportLogs() || null;
  }

  /**
   * Manually show user notification for custom error scenarios
   */
  public async showUserNotification(
    title: string,
    message: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    component: ComponentType,
    options?: {
      guidance?: string;
      actionLabel?: string;
      action?: () => Promise<void>;
      duration?: number;
    },
  ): Promise<string | null> {
    if (this.isBackground) {
      return null; // Only show notifications in content script/popup contexts
    }

    try {
      const notificationService = this.ensureNotificationService();
      const notificationId = `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // We need to access private methods, so we'll create a simple notification manually
      // This is a simplified version for manual notifications
      await notificationService.show({
        id: notificationId,
        type: severity === ErrorSeverity.CRITICAL ? NotificationType.POPUP : NotificationType.TOAST,
        severity,
        title,
        message,
        component,
        actions: options?.action
          ? [
              {
                label: options.actionLabel || 'Action',
                type: 'primary',
                action: options.action,
              },
            ]
          : [
              {
                label: 'Dismiss',
                type: 'secondary',
                action: async () => {
                  await notificationService.hide(notificationId);
                },
              },
            ],
        duration: options?.duration || (severity === ErrorSeverity.CRITICAL ? 0 : 5000),
        dismissible: true,
        config: {
          type:
            severity === ErrorSeverity.CRITICAL ? NotificationType.POPUP : NotificationType.TOAST,
          position: 'top-right',
          duration: options?.duration || (severity === ErrorSeverity.CRITICAL ? 0 : 5000),
          dismissible: true,
          autoHide: severity !== ErrorSeverity.CRITICAL,
          showProgress: true,
          allowMultiple: true,
          stackable: true,
          maxStack: 5,
          animationDuration: 300,
          theme: 'auto',
        },
        retryable: false,
        retryCount: 0,
        maxRetries: 0,
        timestamp: Date.now(),
        context: options?.guidance ? { guidance: options.guidance } : undefined,
      });

      return notificationId;
    } catch (error) {
      console.error('[Logger] Failed to show manual notification:', error);
      return null;
    }
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

    // Clean up notification service
    if (this.notificationService) {
      this.notificationService.destroy();
      this.notificationService = null;
    }

    // Clean up resources
    this.logQueue = [];
    this.performanceMarks.clear();

    // Clean up PerformanceMonitor
    if (this.performanceMonitor) {
      this.performanceMonitor.destroy();
    }

    // Clean up RateLimitingService
    if (this.rateLimitingService) {
      this.rateLimitingService.destroy();
    }

    // Clean up DebugModeService
    if (this.debugModeService) {
      this.debugModeService.destroy();
    }

    // Clean up GracefulDegradationService
    if (this.gracefulDegradationService) {
      this.gracefulDegradationService.destroy();
    }

    // Clean up ErrorRecoveryService
    if (this.errorRecoveryService) {
      this.errorRecoveryService.destroy();
    }

    // Clean up ConsoleLoggingService
    if (this.consoleLoggingService) {
      this.consoleLoggingService.destroy();
    }

    Logger.instance = null;
  }
}
