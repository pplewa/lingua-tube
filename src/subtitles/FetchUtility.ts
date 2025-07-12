/**
 * LinguaTube Subtitle Fetch Utility
 * Handles HTTP requests for fetching subtitle content with retry logic and error handling
 */

import {
  SubtitleFetchRequest,
  SubtitleFetchResult,
  SubtitleFetchError,
  SubtitleErrorCode,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_FETCH_TIMEOUT,
} from './types'

/**
 * Response data from a fetch operation
 */
interface FetchResponse {
  readonly content: string
  readonly contentType: string
  readonly contentLength: number
  readonly etag?: string
  readonly lastModified?: string
  readonly status: number
  readonly statusText: string
}

/**
 * Utility class for fetching subtitle content from remote URLs
 */
export class SubtitleFetchUtility {
  private readonly abortController: AbortController
  private retryDelay = 0

  constructor() {
    this.abortController = new AbortController()
  }

  // ========================================
  // Main Fetch Methods
  // ========================================

  /**
   * Fetch subtitle content from a URL with retry logic
   */
  async fetchContent(request: SubtitleFetchRequest): Promise<FetchResponse> {
    const config = this.buildFetchConfig(request)
    let lastError: Error | null = null
    let attempt = 0

    while (attempt < config.retryConfig.maxAttempts) {
      try {
        console.log(`[LinguaTube] Fetching subtitles: ${request.url} (attempt ${attempt + 1})`)

        // Add delay for retries
        if (attempt > 0) {
          await this.delay(this.calculateRetryDelay(attempt, config.retryConfig))
        }

        const response = await this.performFetch(request.url, config)

        // Check if response indicates success
        if (response.status >= 200 && response.status < 300) {
          console.log(
            `[LinguaTube] Successfully fetched subtitles: ${response.contentLength} bytes`,
          )
          return response
        }

        // Handle HTTP error codes
        if (!this.isRetryableStatus(response.status, config.retryConfig)) {
          throw this.createHttpError(response.status, response.statusText)
        }

        lastError = this.createHttpError(response.status, response.statusText)
      } catch (error) {
        lastError = error as Error

        // Check if error is retryable
        if (!this.isRetryableError(error, config.retryConfig)) {
          throw this.convertToSubtitleError(error, request.url)
        }

        console.warn(`[LinguaTube] Fetch attempt ${attempt + 1} failed:`, error)
      }

      attempt++
    }

    // All retries exhausted
    throw this.convertToSubtitleError(
      lastError || new Error('Maximum retry attempts exceeded'),
      request.url,
    )
  }

  /**
   * Perform the actual fetch operation
   */
  private async performFetch(url: string, config: FetchConfig): Promise<FetchResponse> {
    const controller = new AbortController()

    // Set up timeout
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, config.timeout)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: config.headers,
        signal: controller.signal,
        mode: config.corsMode,
        cache: 'default',
        redirect: 'follow',
      })

      clearTimeout(timeoutId)

      // Read response content
      const content = await response.text()
      const contentType = response.headers.get('content-type') || 'text/plain'
      const contentLength = parseInt(response.headers.get('content-length') || '0')
      const etag = response.headers.get('etag') || undefined
      const lastModified = response.headers.get('last-modified') || undefined

      return {
        content,
        contentType,
        contentLength: contentLength || content.length,
        etag,
        lastModified,
        status: response.status,
        statusText: response.statusText,
      }
    } catch (error) {
      clearTimeout(timeoutId)

      if (controller.signal.aborted) {
        throw new Error('Request timeout')
      }

      throw error
    }
  }

  // ========================================
  // Configuration and Helper Methods
  // ========================================

  /**
   * Build fetch configuration from request
   */
  private buildFetchConfig(request: SubtitleFetchRequest): FetchConfig {
    return {
      timeout: request.timeout || DEFAULT_FETCH_TIMEOUT,
      headers: this.buildHeaders(request),
      retryConfig: { ...DEFAULT_RETRY_CONFIG, ...request.retryConfig },
      corsMode: this.determineCorsMode(request.url),
    }
  }

  /**
   * Build HTTP headers for the request
   */
  private buildHeaders(request: SubtitleFetchRequest): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'text/plain, text/xml, application/xml, text/vtt, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (compatible; LinguaTube Extension)',
      ...request.headers,
    }

    // Add language-specific headers if provided
    if (request.language) {
      headers['Accept-Language'] = `${request.language},en;q=0.8`
    }

    return headers
  }

  /**
   * Determine CORS mode based on URL
   */
  private determineCorsMode(url: string): RequestMode {
    try {
      const urlObj = new URL(url)
      const currentOrigin = window.location.origin

      // Same origin requests
      if (urlObj.origin === currentOrigin) {
        return 'same-origin'
      }

      // YouTube requests
      if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('googlevideo.com')) {
        return 'cors'
      }

      // Cross-origin requests
      return 'cors'
    } catch (error) {
      console.warn('[LinguaTube] Invalid URL, using CORS mode:', url)
      return 'cors'
    }
  }

  // ========================================
  // Retry Logic
  // ========================================

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number, config: RetryConfig): number {
    if (!config.exponentialBackoff) {
      return config.baseDelay
    }

    const exponentialDelay = config.baseDelay * Math.pow(2, attempt - 1)
    const jitter = Math.random() * 0.1 * exponentialDelay // 10% jitter

    return Math.min(exponentialDelay + jitter, config.maxDelay)
  }

  /**
   * Check if HTTP status is retryable
   */
  private isRetryableStatus(status: number, config: RetryConfig): boolean {
    if (!config.retryOn) {
      return status >= 500 // Retry on server errors by default
    }

    return config.retryOn.includes(status)
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown, config: RetryConfig): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase()

      // Network errors that are typically retryable
      const retryableMessages = [
        'network error',
        'fetch failed',
        'connection',
        'timeout',
        'aborted',
        'interrupted',
      ]

      return retryableMessages.some((msg) => message.includes(msg))
    }

    return false
  }

  /**
   * Delay execution for retry
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ========================================
  // Error Handling
  // ========================================

  /**
   * Create HTTP error with status information
   */
  private createHttpError(status: number, statusText: string): Error {
    const error = new Error(`HTTP ${status}: ${statusText}`)
    ;(error as any).status = status
    ;(error as any).statusText = statusText
    return error
  }

  /**
   * Convert generic error to SubtitleFetchError
   */
  private convertToSubtitleError(error: unknown, url: string): SubtitleFetchError {
    if (error instanceof Error) {
      const httpStatus = (error as any).status

      // Network errors
      if (error.message.includes('timeout') || error.message.includes('aborted')) {
        return {
          code: SubtitleErrorCode.TIMEOUT,
          message: `Request timeout while fetching: ${url}`,
          httpStatus,
          originalError: error,
          retryable: true,
        }
      }

      if (error.message.includes('network') || error.message.includes('fetch failed')) {
        return {
          code: SubtitleErrorCode.NETWORK_ERROR,
          message: `Network error while fetching: ${url}`,
          httpStatus,
          originalError: error,
          retryable: true,
        }
      }

      // CORS errors
      if (error.message.includes('cors') || error.message.includes('cross-origin')) {
        return {
          code: SubtitleErrorCode.CORS_ERROR,
          message: `CORS error while fetching: ${url}`,
          httpStatus,
          originalError: error,
          retryable: false,
        }
      }

      // HTTP status errors
      if (httpStatus) {
        return this.convertHttpStatusToError(httpStatus, url, error)
      }

      // Generic error
      return {
        code: SubtitleErrorCode.UNKNOWN_ERROR,
        message: `Failed to fetch: ${error.message}`,
        httpStatus,
        originalError: error,
        retryable: false,
      }
    }

    return {
      code: SubtitleErrorCode.UNKNOWN_ERROR,
      message: `Unknown error while fetching: ${url}`,
      originalError: error,
      retryable: false,
    }
  }

  /**
   * Convert HTTP status to specific error
   */
  private convertHttpStatusToError(
    status: number,
    url: string,
    originalError: Error,
  ): SubtitleFetchError {
    switch (status) {
      case 401:
        return {
          code: SubtitleErrorCode.UNAUTHORIZED,
          message: `Unauthorized access to: ${url}`,
          httpStatus: status,
          originalError,
          retryable: false,
        }

      case 403:
        return {
          code: SubtitleErrorCode.FORBIDDEN,
          message: `Access forbidden to: ${url}`,
          httpStatus: status,
          originalError,
          retryable: false,
        }

      case 404:
        return {
          code: SubtitleErrorCode.NOT_FOUND,
          message: `Subtitle file not found: ${url}`,
          httpStatus: status,
          originalError,
          retryable: false,
        }

      case 429:
        const retryAfter = this.extractRetryAfter(originalError)
        return {
          code: SubtitleErrorCode.RATE_LIMITED,
          message: `Rate limited while fetching: ${url}`,
          httpStatus: status,
          originalError,
          retryable: true,
          retryAfter,
        }

      case 503:
        return {
          code: SubtitleErrorCode.SERVICE_UNAVAILABLE,
          message: `Service unavailable: ${url}`,
          httpStatus: status,
          originalError,
          retryable: true,
        }

      default:
        if (status >= 500) {
          return {
            code: SubtitleErrorCode.NETWORK_ERROR,
            message: `Server error ${status} while fetching: ${url}`,
            httpStatus: status,
            originalError,
            retryable: true,
          }
        }

        return {
          code: SubtitleErrorCode.UNKNOWN_ERROR,
          message: `HTTP ${status} error while fetching: ${url}`,
          httpStatus: status,
          originalError,
          retryable: false,
        }
    }
  }

  /**
   * Extract retry-after header value
   */
  private extractRetryAfter(error: Error): number | undefined {
    // This would need to be implemented based on the response headers
    // For now, return a default value for rate limiting
    return 60 // 60 seconds default
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Validate URL format
   */
  static validateUrl(url: string): boolean {
    try {
      const urlObj = new URL(url)
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:'
    } catch {
      return false
    }
  }

  /**
   * Extract file extension from URL
   */
  static extractFileExtension(url: string): string | null {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const lastDot = pathname.lastIndexOf('.')

      if (lastDot > 0 && lastDot < pathname.length - 1) {
        return pathname.substring(lastDot + 1).toLowerCase()
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Check if URL is from YouTube domain
   */
  static isYouTubeUrl(url: string): boolean {
    try {
      const urlObj = new URL(url)
      const hostname = urlObj.hostname.toLowerCase()

      return (
        hostname.includes('youtube.com') ||
        hostname.includes('googlevideo.com') ||
        hostname.includes('ytimg.com')
      )
    } catch {
      return false
    }
  }

  /**
   * Cancel any ongoing requests
   */
  cancel(): void {
    this.abortController.abort()
  }
}

// ========================================
// Internal Types
// ========================================

/**
 * Internal fetch configuration
 */
interface FetchConfig {
  readonly timeout: number
  readonly headers: Record<string, string>
  readonly retryConfig: RetryConfig
  readonly corsMode: RequestMode
}

// ========================================
// Factory Functions
// ========================================

/**
 * Create a new fetch utility instance
 */
export function createFetchUtility(): SubtitleFetchUtility {
  return new SubtitleFetchUtility()
}

/**
 * Create a configured fetch request
 */
export function createFetchRequest(
  url: string,
  options: Partial<SubtitleFetchRequest> = {},
): SubtitleFetchRequest {
  return {
    url,
    timeout: DEFAULT_FETCH_TIMEOUT,
    useCache: true,
    retryConfig: DEFAULT_RETRY_CONFIG,
    ...options,
  }
}
