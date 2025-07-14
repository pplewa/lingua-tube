/**
 * LinguaTube Retry Service
 * Handles retry logic for failed subtitle fetch requests with exponential backoff and jitter
 */

import { RetryConfig, SubtitleErrorCode, SubtitleFetchError, DEFAULT_RETRY_CONFIG } from './types';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';

/**
 * Retry attempt information
 */
export interface RetryAttempt {
  readonly attemptNumber: number;
  readonly delay: number;
  readonly error: SubtitleFetchError;
  readonly timestamp: number;
}

/**
 * Retry result information
 */
export interface RetryResult<T> {
  readonly success: boolean;
  readonly result?: T;
  readonly error?: SubtitleFetchError;
  readonly totalAttempts: number;
  readonly totalTime: number;
  readonly attempts: RetryAttempt[];
}

/**
 * Retry policy function type
 */
export type RetryPolicy = (error: SubtitleFetchError, attempt: number) => boolean;

/**
 * Async operation function type
 */
export type AsyncOperation<T> = () => Promise<T>;

/**
 * Retry service implementation
 */
export class RetryService {
  private readonly config: RetryConfig;
  private readonly logger: Logger | null = null;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.logger = Logger.getInstance();
  }

  // ========================================
  // Main Retry Logic
  // ========================================

  /**
   * Execute operation with retry logic
   */
  async execute<T>(
    operation: AsyncOperation<T>,
    customConfig?: Partial<RetryConfig>,
  ): Promise<RetryResult<T>> {
    const config = customConfig ? { ...this.config, ...customConfig } : this.config;
    const startTime = Date.now();
    const attempts: RetryAttempt[] = [];

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        this.logger?.debug('Retry attempt', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { attempt, maxAttempts: config.maxAttempts },
        });

        const result = await operation();

        const totalTime = Date.now() - startTime;
        this.logger?.info('Operation succeeded', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { attempt, totalTime },
        });

        return {
          success: true,
          result,
          totalAttempts: attempt,
          totalTime,
          attempts,
        };
      } catch (error) {
        const fetchError = this.normalizeError(error);
        const timestamp = Date.now();

        // Record attempt
        const attemptInfo: RetryAttempt = {
          attemptNumber: attempt,
          delay: 0, // Will be set if we retry
          error: fetchError,
          timestamp,
        };

        attempts.push(attemptInfo);

        this.logger?.warn('Attempt failed', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { attempt, error: fetchError.message, errorCode: fetchError.code },
        });

        // Check if we should retry
        if (attempt >= config.maxAttempts) {
          this.logger?.error('All retry attempts failed', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: { maxAttempts: config.maxAttempts },
          });
          break;
        }

        if (!this.shouldRetry(fetchError, attempt, config)) {
          this.logger?.info('Not retrying due to error type', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: { errorCode: fetchError.code, attempt },
          });
          break;
        }

        // Calculate delay and wait
        const delay = this.calculateDelay(attempt, config);

        this.logger?.debug('Waiting before retry', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { delay, attempt },
        });
        await this.sleep(delay);

        // Update the attempt info with the actual delay used
        const updatedAttemptInfo = { ...attemptInfo, delay };
        attempts[attempts.length - 1] = updatedAttemptInfo;
      }
    }

    // All attempts failed
    const totalTime = Date.now() - startTime;
    const lastError = attempts[attempts.length - 1]?.error || this.createUnknownError();

    return {
      success: false,
      error: lastError,
      totalAttempts: attempts.length,
      totalTime,
      attempts,
    };
  }

  /**
   * Execute operation with custom retry policy
   */
  async executeWithPolicy<T>(
    operation: AsyncOperation<T>,
    retryPolicy: RetryPolicy,
    config?: Partial<RetryConfig>,
  ): Promise<RetryResult<T>> {
    const mergedConfig = config ? { ...this.config, ...config } : this.config;
    const startTime = Date.now();
    const attempts: RetryAttempt[] = [];

    for (let attempt = 1; attempt <= mergedConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();

        return {
          success: true,
          result,
          totalAttempts: attempt,
          totalTime: Date.now() - startTime,
          attempts,
        };
      } catch (error) {
        const fetchError = this.normalizeError(error);
        const attemptInfo: RetryAttempt = {
          attemptNumber: attempt,
          delay: 0,
          error: fetchError,
          timestamp: Date.now(),
        };

        attempts.push(attemptInfo);

        // Check retry policy
        if (attempt >= mergedConfig.maxAttempts || !retryPolicy(fetchError, attempt)) {
          break;
        }

        // Calculate delay and wait
        const delay = this.calculateDelay(attempt, mergedConfig);
        await this.sleep(delay);

        // Update the attempt info with the actual delay used
        const updatedAttemptInfo = { ...attemptInfo, delay };
        attempts[attempts.length - 1] = updatedAttemptInfo;
      }
    }

    return {
      success: false,
      error: attempts[attempts.length - 1]?.error || this.createUnknownError(),
      totalAttempts: attempts.length,
      totalTime: Date.now() - startTime,
      attempts,
    };
  }

  // ========================================
  // Retry Policies
  // ========================================

  /**
   * Determine if error should trigger a retry
   */
  private shouldRetry(error: SubtitleFetchError, attempt: number, config: RetryConfig): boolean {
    // Check if error is retryable
    if (!error.retryable) {
      return false;
    }

    // Check HTTP status codes
    if (error.httpStatus && config.retryOn) {
      if (!config.retryOn.includes(error.httpStatus)) {
        return false;
      }
    }

    // Check error codes that should not be retried
    const nonRetryableErrors: SubtitleErrorCode[] = [
      SubtitleErrorCode.NOT_FOUND,
      SubtitleErrorCode.UNAUTHORIZED,
      SubtitleErrorCode.FORBIDDEN,
      SubtitleErrorCode.INVALID_URL,
      SubtitleErrorCode.INVALID_FORMAT,
      SubtitleErrorCode.CORS_ERROR,
    ];

    if (nonRetryableErrors.includes(error.code)) {
      return false;
    }

    // Special handling for rate limiting
    if (error.code === SubtitleErrorCode.RATE_LIMITED) {
      return attempt <= Math.floor(config.maxAttempts / 2); // Only retry first half of attempts for rate limiting
    }

    return true;
  }

  /**
   * Create default retry policy
   */
  static createDefaultPolicy(): RetryPolicy {
    return (error: SubtitleFetchError, attempt: number): boolean => {
      // Standard retryable error codes
      const retryableErrors: SubtitleErrorCode[] = [
        SubtitleErrorCode.NETWORK_ERROR,
        SubtitleErrorCode.TIMEOUT,
        SubtitleErrorCode.RATE_LIMITED,
        SubtitleErrorCode.SERVICE_UNAVAILABLE,
      ];

      return error.retryable && retryableErrors.includes(error.code);
    };
  }

  /**
   * Create conservative retry policy (fewer retries)
   */
  static createConservativePolicy(): RetryPolicy {
    return (error: SubtitleFetchError, attempt: number): boolean => {
      // Only retry network and timeout errors
      const retryableErrors: SubtitleErrorCode[] = [
        SubtitleErrorCode.NETWORK_ERROR,
        SubtitleErrorCode.TIMEOUT,
      ];

      return attempt <= 2 && retryableErrors.includes(error.code);
    };
  }

  /**
   * Create aggressive retry policy (more retries)
   */
  static createAggressivePolicy(): RetryPolicy {
    return (error: SubtitleFetchError, attempt: number): boolean => {
      // Retry most errors except authentication and permanent failures
      const nonRetryableErrors: SubtitleErrorCode[] = [
        SubtitleErrorCode.NOT_FOUND,
        SubtitleErrorCode.UNAUTHORIZED,
        SubtitleErrorCode.FORBIDDEN,
        SubtitleErrorCode.INVALID_URL,
        SubtitleErrorCode.CORS_ERROR,
      ];

      return !nonRetryableErrors.includes(error.code);
    };
  }

  // ========================================
  // Delay Calculation
  // ========================================

  /**
   * Calculate delay for next retry attempt
   */
  private calculateDelay(attempt: number, config: RetryConfig): number {
    let delay: number;

    if (config.exponentialBackoff) {
      // Exponential backoff: baseDelay * 2^(attempt-1)
      delay = config.baseDelay * Math.pow(2, attempt - 1);
    } else {
      // Linear backoff
      delay = config.baseDelay * attempt;
    }

    // Apply maximum delay limit
    delay = Math.min(delay, config.maxDelay);

    // Add jitter to prevent thundering herd
    delay = this.addJitter(delay);

    return Math.floor(delay);
  }

  /**
   * Add jitter to delay to prevent synchronized retries
   */
  private addJitter(delay: number): number {
    // Add up to 25% random jitter
    const jitterRange = delay * 0.25;
    const jitter = Math.random() * jitterRange;
    return delay + jitter;
  }

  /**
   * Sleep for specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ========================================
  // Error Handling
  // ========================================

  /**
   * Normalize error into SubtitleFetchError format
   */
  private normalizeError(error: unknown): SubtitleFetchError {
    if (this.isSubtitleFetchError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return this.convertStandardError(error);
    }

    return this.createUnknownError(error);
  }

  /**
   * Check if error is already a SubtitleFetchError
   */
  private isSubtitleFetchError(error: unknown): error is SubtitleFetchError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      'retryable' in error
    );
  }

  /**
   * Convert standard Error to SubtitleFetchError
   */
  private convertStandardError(error: Error): SubtitleFetchError {
    let code: SubtitleErrorCode = SubtitleErrorCode.UNKNOWN_ERROR;
    let retryable = true;
    let httpStatus: number | undefined;

    // Analyze error message for common patterns
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('fetch')) {
      code = SubtitleErrorCode.NETWORK_ERROR;
    } else if (message.includes('timeout')) {
      code = SubtitleErrorCode.TIMEOUT;
    } else if (message.includes('cors')) {
      code = SubtitleErrorCode.CORS_ERROR;
      retryable = false;
    } else if (message.includes('not found') || message.includes('404')) {
      code = SubtitleErrorCode.NOT_FOUND;
      httpStatus = 404;
      retryable = false;
    } else if (message.includes('unauthorized') || message.includes('401')) {
      code = SubtitleErrorCode.UNAUTHORIZED;
      httpStatus = 401;
      retryable = false;
    } else if (message.includes('forbidden') || message.includes('403')) {
      code = SubtitleErrorCode.FORBIDDEN;
      httpStatus = 403;
      retryable = false;
    } else if (message.includes('rate limit') || message.includes('429')) {
      code = SubtitleErrorCode.RATE_LIMITED;
      httpStatus = 429;
    }

    return {
      code,
      message: error.message,
      httpStatus,
      originalError: error,
      retryable,
    };
  }

  /**
   * Create unknown error
   */
  private createUnknownError(originalError?: unknown): SubtitleFetchError {
    return {
      code: SubtitleErrorCode.UNKNOWN_ERROR,
      message: 'An unknown error occurred',
      originalError,
      retryable: true,
    };
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get current retry configuration
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }

  /**
   * Create new RetryService with updated configuration
   */
  withConfig(config: Partial<RetryConfig>): RetryService {
    return new RetryService({ ...this.config, ...config });
  }

  /**
   * Estimate total retry time
   */
  estimateRetryTime(config?: Partial<RetryConfig>): number {
    const mergedConfig = config ? { ...this.config, ...config } : this.config;
    let totalTime = 0;

    for (let attempt = 1; attempt < mergedConfig.maxAttempts; attempt++) {
      totalTime += this.calculateDelayEstimate(attempt, mergedConfig);
    }

    return totalTime;
  }

  /**
   * Calculate delay estimate without jitter
   */
  private calculateDelayEstimate(attempt: number, config: RetryConfig): number {
    let delay: number;

    if (config.exponentialBackoff) {
      delay = config.baseDelay * Math.pow(2, attempt - 1);
    } else {
      delay = config.baseDelay * attempt;
    }

    return Math.min(delay, config.maxDelay);
  }
}

// ========================================
// Factory Functions and Utilities
// ========================================

/**
 * Create retry service with default configuration
 */
export function createRetryService(config?: Partial<RetryConfig>): RetryService {
  return new RetryService(config);
}

/**
 * Create retry service for network operations
 */
export function createNetworkRetryService(): RetryService {
  return new RetryService({
    maxAttempts: 5,
    baseDelay: 1000,
    maxDelay: 30000,
    exponentialBackoff: true,
    retryOn: [408, 429, 500, 502, 503, 504],
  });
}

/**
 * Create retry service for rate-limited operations
 */
export function createRateLimitRetryService(): RetryService {
  return new RetryService({
    maxAttempts: 3,
    baseDelay: 5000,
    maxDelay: 60000,
    exponentialBackoff: true,
    retryOn: [429],
  });
}

/**
 * Wrapper function for simple retry operations
 */
export async function withRetry<T>(
  operation: AsyncOperation<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const retryService = createRetryService(config);
  const result = await retryService.execute(operation);

  if (result.success && result.result !== undefined) {
    return result.result;
  }

  throw result.error || new Error('Operation failed after all retry attempts');
}

/**
 * Default retry service instance
 */
export const retryService = createRetryService();
