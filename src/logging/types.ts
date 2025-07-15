// ========================================
// Logging System Types and Interfaces
// ========================================

/**
 * Log levels supported by the logging system
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * Log level priorities for filtering and comparison
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
  [LogLevel.CRITICAL]: 4,
};

/**
 * Error classification types for better error handling
 */
export enum ErrorType {
  NETWORK = 'network',
  VALIDATION = 'validation',
  PERMISSION = 'permission',
  STORAGE = 'storage',
  API = 'api',
  UI = 'ui',
  BACKGROUND = 'background',
  CONTENT_SCRIPT = 'content_script',
  POPUP = 'popup',
  PERFORMANCE = 'performance',
  SECURITY = 'security',
  UNKNOWN = 'unknown',
}

/**
 * Error severity levels for user-facing error handling
 */
export enum ErrorSeverity {
  LOW = 'low', // Minor issues, extension continues normally
  MEDIUM = 'medium', // Some functionality affected
  HIGH = 'high', // Major functionality broken
  CRITICAL = 'critical', // Extension unusable
}

/**
 * Extension component types for context tracking
 */
export enum ComponentType {
  BACKGROUND = 'background',
  CONTENT_SCRIPT = 'content_script',
  POPUP = 'popup',
  OPTIONS = 'options',
  SUBTITLE_MANAGER = 'subtitle_manager',
  WORD_LOOKUP = 'word_lookup',
  TRANSLATION_SERVICE = 'translation_service',
  DICTIONARY_SERVICE = 'dictionary_service',
  TTS_SERVICE = 'tts_service',
  STORAGE_SERVICE = 'storage_service',
  YOUTUBE_INTEGRATION = 'youtube_integration',
  ERROR_HANDLER = 'error_handler',
}

/**
 * Context information attached to log entries
 */
export interface LogContext {
  readonly component: ComponentType;
  readonly action?: string;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly url?: string;
  readonly userAgent?: string;
  readonly extensionVersion?: string;
  readonly timestamp?: string;
  readonly performance?: PerformanceData;
  readonly metadata?: Record<string, any>;
}

/**
 * Performance monitoring data
 */
export interface PerformanceData {
  readonly duration?: number;
  readonly memoryUsage?: number;
  readonly timing?: {
    readonly start: number;
    readonly end: number;
  };
  readonly marks?: string[];
  readonly measures?: Array<{
    readonly name: string;
    readonly duration: number;
  }>;
}

/**
 * Error context for enhanced error handling
 */
export interface ErrorContext extends LogContext {
  readonly errorType: ErrorType;
  readonly severity: ErrorSeverity;
  readonly recoverable: boolean;
  readonly stackTrace?: string;
  readonly sourceMap?: string;
  readonly userMessage?: string;
  readonly technicalDetails?: string;
  readonly relatedLogs?: string[];
}

/**
 * Core log entry structure
 */
export interface LogEntry {
  readonly id: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly context: LogContext;
  readonly error?: Error;
  readonly errorContext?: ErrorContext;
  readonly tags?: string[];
  readonly fingerprint?: string; // For deduplication
}

/**
 * Log storage entry with additional metadata
 */
export interface StoredLogEntry extends LogEntry {
  readonly stored: string;
  readonly version: string;
  readonly environment: 'development' | 'production';
  readonly count?: number; // For deduplicated entries
}

/**
 * Message types for inter-context communication
 */
export enum MessageType {
  LOG_EVENT = 'LOG_EVENT',
  LOG_BATCH = 'LOG_BATCH',
  LOG_CONFIG_UPDATE = 'LOG_CONFIG_UPDATE',
  LOG_EXPORT_REQUEST = 'LOG_EXPORT_REQUEST',
  LOG_CLEAR_REQUEST = 'LOG_CLEAR_REQUEST',
  LOG_STATS_REQUEST = 'LOG_STATS_REQUEST',
  ERROR_REPORT = 'ERROR_REPORT',
}

/**
 * Message structure for chrome.runtime.sendMessage
 */
export interface LogMessage {
  readonly level: LogLevel;
  readonly type: MessageType;
  readonly payload: LogMessagePayload;
  readonly sender: ComponentType;
  readonly timestamp: string;
}

/**
 * Payload types for different message types
 */
export type LogMessagePayload =
  | LogEventPayload
  | LogBatchPayload
  | LogConfigPayload
  | LogExportPayload
  | LogClearPayload
  | LogStatsPayload
  | ErrorReportPayload;

export interface LogEventPayload {
  readonly entry: LogEntry;
}

export interface LogBatchPayload {
  readonly entries: LogEntry[];
}

export interface LogConfigPayload {
  readonly config: Partial<LoggerConfig>;
}

export interface LogExportPayload {
  readonly format: 'json' | 'csv' | 'txt';
  readonly filters?: LogFilters;
}

export interface LogClearPayload {
  readonly filters?: LogFilters;
  readonly confirm: boolean;
}

export interface LogStatsPayload {
  readonly timeRange?: {
    readonly start: string;
    readonly end: string;
  };
}

export interface ErrorReportPayload {
  readonly entries: LogEntry[];
  readonly userConsent: boolean;
  readonly includeContext: boolean;
}

/**
 * Log filtering options
 */
export interface LogFilters {
  readonly levels?: LogLevel[];
  readonly components?: ComponentType[];
  readonly errorTypes?: ErrorType[];
  readonly timeRange?: {
    readonly start: string;
    readonly end: string;
  };
  readonly search?: string;
  readonly tags?: string[];
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  readonly enabled: boolean;
  readonly minLevel: LogLevel;
  readonly maxStorageSize: number; // bytes
  readonly maxEntries: number;
  readonly retentionDays: number;
  readonly enableConsole: boolean;
  readonly enableStorage: boolean;
  readonly enablePerformance: boolean;
  readonly enableErrorReporting: boolean;
  readonly debugMode: boolean;
  readonly rateLimiting: {
    readonly enabled: boolean;
    readonly maxLogsPerSecond: number;
    readonly burstLimit: number;
  };
  readonly deduplication: {
    readonly enabled: boolean;
    readonly windowMs: number;
    readonly maxDuplicates: number;
  };
  readonly batching: {
    readonly enabled: boolean;
    readonly batchSize: number;
    readonly flushInterval: number;
  };
  readonly filters: LogFilters;
  readonly sensitiveDataPatterns: string[];
}

/**
 * Logger statistics
 */
export interface LoggerStats {
  readonly totalEntries: number;
  readonly entriesByLevel: Record<LogLevel, number>;
  readonly entriesByComponent: Record<ComponentType, number>;
  readonly errorsByType: Record<ErrorType, number>;
  readonly storageUsage: {
    readonly bytes: number;
    readonly percentage: number;
  };
  readonly performance: {
    readonly avgLogTime: number;
    readonly slowestLog: number;
    readonly totalLogTime: number;
  };
  readonly timeRange: {
    readonly oldest: string;
    readonly newest: string;
  };
}

/**
 * Recovery strategy for error handling
 */
export interface RecoveryStrategy {
  readonly type: 'retry' | 'fallback' | 'reset' | 'ignore';
  readonly maxAttempts?: number;
  readonly delay?: number;
  readonly fallbackAction?: () => Promise<void>;
  readonly resetAction?: () => Promise<void>;
}

/**
 * User notification for errors
 */
export interface UserNotification {
  readonly type: 'toast' | 'popup' | 'banner';
  readonly severity: ErrorSeverity;
  readonly title: string;
  readonly message: string;
  readonly actions?: Array<{
    readonly label: string;
    readonly action: () => void;
  }>;
  readonly duration?: number;
  readonly dismissible: boolean;
}

/**
 * Default logger configuration
 */
export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  enabled: true,
  minLevel: LogLevel.DEBUG,
  maxStorageSize: 5 * 1024 * 1024, // 5MB
  maxEntries: 10000,
  retentionDays: 7,
  enableConsole: true,
  enableStorage: true,
  enablePerformance: true,
  enableErrorReporting: false,
  debugMode: false,
  rateLimiting: {
    enabled: true,
    maxLogsPerSecond: 10,
    burstLimit: 50,
  },
  deduplication: {
    enabled: true,
    windowMs: 60000, // 1 minute
    maxDuplicates: 5,
  },
  batching: {
    enabled: true,
    batchSize: 10,
    flushInterval: 5000, // 5 seconds
  },
  filters: {},
  sensitiveDataPatterns: [
    'password',
    'token',
    'key',
    'secret',
    'auth',
    'credential',
    'session',
    'cookie',
  ],
};

/**
 * Environment detection
 */
export const isProduction = (): boolean => {
  return (
    process.env.NODE_ENV === 'production' || !chrome.runtime.getManifest().name.includes('Dev')
  );
};

/**
 * Generate unique ID for log entries
 */
export const generateLogId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Generate fingerprint for log deduplication
 */
export const generateFingerprint = (
  level: LogLevel,
  message: string,
  component: ComponentType,
): string => {
  const content = `${level}:${component}:${message}`;
  // Simple hash function for fingerprinting
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
};
