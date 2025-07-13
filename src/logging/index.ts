// ========================================
// Logging System Main Export
// ========================================

export * from './types';
export { Logger } from './Logger';
export * from './StackTraceProcessor';
export { PerformanceMonitor } from './PerformanceMonitor';
export { ErrorNotificationService, NotificationType } from './ErrorNotificationService';
export type {
  NotificationConfig,
  ErrorMessage,
  NotificationAction,
  EnhancedNotification,
} from './ErrorNotificationService';
export { RateLimitingService, createRateLimitingServiceFromConfig } from './RateLimitingService';
export type {
  RateLimitConfig,
  DeduplicationConfig,
  RateLimitStats,
  DeduplicationStats,
} from './RateLimitingService';
export { DebugModeService, createDebugModeService } from './DebugModeService';
export type {
  DebugModeConfig,
  DebugStats,
  MemorySnapshot,
  NetworkRequestInfo,
  ConsoleEntry,
  ErrorPattern,
} from './DebugModeService';
export { GracefulDegradationService } from './GracefulDegradationService';
export type {
  FeatureState,
  DegradationLevel,
  FeatureConfig,
  FallbackOption,
  RecoveryStrategy,
  FeatureStatus,
  HealthCheckResult,
  SystemHealth,
  DegradationEvent,
  UserNotificationConfig,
} from './GracefulDegradationService';
export { ErrorRecoveryService } from './ErrorRecoveryService';
export type {
  RecoveryStrategyType,
  RecoveryResult,
  RecoveryAttempt,
  RecoveryContext,
  RecoveryStats,
  RecoveryConfig,
} from './ErrorRecoveryService';
export {
  ConsoleLoggingService,
  createConsoleLoggingService,
  ConsoleFormat,
  ConsoleColorScheme,
  DEFAULT_CONSOLE_LOGGING_CONFIG,
} from './ConsoleLoggingService';
export type {
  ConsoleLoggingConfig,
  ConsoleGrouping,
  ConsoleFiltering,
  ConsoleFormatting,
  ConsolePerformanceStats,
} from './ConsoleLoggingService';

import { Logger } from './Logger';
import { ComponentType, LogLevel, LoggerConfig } from './types';

/**
 * Convenience factory for creating logger instances
 */
export class LoggerFactory {
  private static defaultConfig: Partial<LoggerConfig> = {};

  /**
   * Set default configuration for all logger instances
   */
  public static setDefaultConfig(config: Partial<LoggerConfig>): void {
    LoggerFactory.defaultConfig = config;
  }

  /**
   * Get logger instance with optional custom configuration
   */
  public static getLogger(config?: Partial<LoggerConfig>): Logger | null {
    const mergedConfig = { ...LoggerFactory.defaultConfig, ...config };
    return Logger.getInstance(mergedConfig);
  }

  /**
   * Create a logger instance specifically for background context
   */
  public static getBackgroundLogger(): Logger | null {
    return LoggerFactory.getLogger({
      enableStorage: true,
      enableConsole: true,
      minLevel: LogLevel.DEBUG,
    });
  }

  /**
   * Create a logger instance specifically for content script context
   */
  public static getContentScriptLogger(): Logger | null {
    return LoggerFactory.getLogger({
      enableStorage: false, // Content scripts send to background
      enableConsole: true,
      minLevel: LogLevel.INFO,
    });
  }

  /**
   * Create a logger instance specifically for popup context
   */
  public static getPopupLogger(): Logger | null {
    return LoggerFactory.getLogger({
      enableStorage: false, // Popups send to background
      enableConsole: true,
      minLevel: LogLevel.INFO,
    });
  }
}

/**
 * Global logger instance - use this for most logging needs
 */
export const logger = LoggerFactory.getLogger();

/**
 * Convenience logging functions that use the global logger
 */
export const log = {
  debug: (message: string, component: ComponentType, context?: any) =>
    logger?.debug(message, { component, ...context }),

  info: (message: string, component: ComponentType, context?: any) =>
    logger?.info(message, { component, ...context }),

  warn: (message: string, component: ComponentType, context?: any) =>
    logger?.warn(message, { component, ...context }),

  error: (message: string, component: ComponentType, context?: any, error?: Error) =>
    logger?.error(message, { component, ...context }, error),

  critical: (message: string, component: ComponentType, context?: any, error?: Error) =>
    logger?.critical(message, { component, ...context }, error),

  // Performance logging
  mark: (name: string) => logger?.mark(name),
  measure: (name: string, startMark: string, endMark?: string) =>
    logger?.measure(name, startMark, endMark),

  // Enhanced performance monitoring
  startOperation: (name: string, metadata: import('./PerformanceMonitor').OperationMetadata) =>
    logger?.startPerformanceOperation(name, metadata),
  endOperation: (
    name: string,
    additionalMetadata?: Partial<import('./PerformanceMonitor').OperationMetadata>,
  ) => logger?.endPerformanceOperation(name, additionalMetadata),
  measureAsync: <T>(
    name: string,
    operation: () => Promise<T>,
    metadata: import('./PerformanceMonitor').OperationMetadata,
  ) => logger?.measureAsyncOperation(name, operation, metadata),
  measureSync: <T>(
    name: string,
    operation: () => T,
    metadata: import('./PerformanceMonitor').OperationMetadata,
  ) => logger?.measureSyncOperation(name, operation, metadata),
};

/**
 * Component-specific logger creators for convenience
 */
export const createComponentLogger = (component: ComponentType) => ({
  debug: (message: string, context?: any) => logger?.debug(message, { component, ...context }),

  info: (message: string, context?: any) => logger?.info(message, { component, ...context }),

  warn: (message: string, context?: any) => logger?.warn(message, { component, ...context }),

  error: (message: string, context?: any, error?: Error) =>
    logger?.error(message, { component, ...context }, error),

  critical: (message: string, context?: any, error?: Error) =>
    logger?.critical(message, { component, ...context }, error),

  mark: (name: string) => logger?.mark(name),
  measure: (name: string, startMark: string, endMark?: string) =>
    logger?.measure(name, startMark, endMark),

  // Enhanced performance monitoring with component context
  startOperation: (
    name: string,
    operationType: string,
    metadata?: Partial<import('./PerformanceMonitor').OperationMetadata>,
  ) => logger?.startPerformanceOperation(name, { component, operationType, ...metadata }),
  endOperation: (
    name: string,
    additionalMetadata?: Partial<import('./PerformanceMonitor').OperationMetadata>,
  ) => logger?.endPerformanceOperation(name, additionalMetadata),
  measureAsync: <T>(
    name: string,
    operation: () => Promise<T>,
    operationType: string,
    metadata?: Partial<import('./PerformanceMonitor').OperationMetadata>,
  ) => logger?.measureAsyncOperation(name, operation, { component, operationType, ...metadata }),
  measureSync: <T>(
    name: string,
    operation: () => T,
    operationType: string,
    metadata?: Partial<import('./PerformanceMonitor').OperationMetadata>,
  ) => logger?.measureSyncOperation(name, operation, { component, operationType, ...metadata }),
});

/**
 * Pre-configured component loggers for major extension parts
 */
export const backgroundLogger = createComponentLogger(ComponentType.BACKGROUND);
export const contentScriptLogger = createComponentLogger(ComponentType.CONTENT_SCRIPT);
export const popupLogger = createComponentLogger(ComponentType.POPUP);
export const subtitleLogger = createComponentLogger(ComponentType.SUBTITLE_MANAGER);
export const wordLookupLogger = createComponentLogger(ComponentType.WORD_LOOKUP);
export const translationLogger = createComponentLogger(ComponentType.TRANSLATION_SERVICE);
export const dictionaryLogger = createComponentLogger(ComponentType.DICTIONARY_SERVICE);
export const ttsLogger = createComponentLogger(ComponentType.TTS_SERVICE);
export const storageLogger = createComponentLogger(ComponentType.STORAGE_SERVICE);
export const youtubeLogger = createComponentLogger(ComponentType.YOUTUBE_INTEGRATION);
export const errorHandlerLogger = createComponentLogger(ComponentType.ERROR_HANDLER);
