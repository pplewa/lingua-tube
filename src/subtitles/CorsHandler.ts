/**
 * LinguaTube CORS Handler
 * Handles cross-origin requests for subtitle files with multiple fallback strategies
 */

import { SubtitleErrorCode, SubtitleFetchError, FetchConfig } from './types'
import { Logger } from '../logging/Logger'
import { ComponentType } from '../logging/types'

/**
 * CORS handling strategy
 */
export type CorsStrategy =
  | 'extension' // Use Chrome extension permissions
  | 'background' // Use background script to make request
  | 'proxy' // Use proxy service (if available)
  | 'content_script' // Use content script to make request from YouTube context
  | 'direct' // Direct fetch (may fail due to CORS)

/**
 * CORS configuration
 */
export interface CorsConfig {
  readonly strategies: CorsStrategy[]
  readonly timeout: number
  readonly retryOnCorsError: boolean
  readonly enableLogging: boolean
  readonly proxyEndpoint?: string
}

/**
 * CORS request result
 */
export interface CorsRequestResult {
  readonly success: boolean
  readonly data?: string
  readonly error?: SubtitleFetchError
  readonly strategy: CorsStrategy
  readonly url: string
  readonly responseHeaders?: Record<string, string>
  readonly statusCode?: number
}

/**
 * Default CORS configuration
 */
export const DEFAULT_CORS_CONFIG: CorsConfig = {
  strategies: ['extension', 'background', 'content_script', 'direct'],
  timeout: 30000,
  retryOnCorsError: true,
  enableLogging: true,
}

/**
 * CORS handler implementation
 */
export class CorsHandler {
  private readonly config: CorsConfig
  private readonly logger = Logger.getInstance()

  constructor(config: Partial<CorsConfig> = {}) {
    this.config = { ...DEFAULT_CORS_CONFIG, ...config }
  }

  // ========================================
  // Main CORS Handling
  // ========================================

  /**
   * Fetch URL with CORS handling
   */
  async fetchWithCorsHandling(
    url: string,
    options: Partial<FetchConfig> = {},
  ): Promise<CorsRequestResult> {
    const startTime = Date.now()
    this.logger.info('Fetching with CORS handling', {
      component: ComponentType.SUBTITLE_MANAGER,
      url,
      metadata: { strategies: this.config.strategies }
    })

    for (const strategy of this.config.strategies) {
      try {
        this.logger.debug('Trying CORS strategy', {
          component: ComponentType.SUBTITLE_MANAGER,
          url,
          metadata: { strategy }
        })

        const result = await this.executeStrategy(strategy, url, options)

        if (result.success) {
          const duration = Date.now() - startTime
          this.logger.info('CORS strategy succeeded', {
            component: ComponentType.SUBTITLE_MANAGER,
            url,
            metadata: {
              strategy,
              duration,
              statusCode: result.statusCode,
              dataLength: result.data?.length
            }
          })
          return result
        }

        // Log failure but continue to next strategy
        this.logger.warn('CORS strategy failed', {
          component: ComponentType.SUBTITLE_MANAGER,
          url,
          metadata: {
            strategy,
            errorCode: result.error?.code,
            errorMessage: result.error?.message,
            retryable: result.error?.retryable
          }
        })

        // If this was a CORS error and we should retry, continue
        if (result.error?.code === SubtitleErrorCode.CORS_ERROR && this.config.retryOnCorsError) {
          continue
        }

        // For other errors that aren't retryable, break
        if (result.error && !result.error.retryable) {
          this.logger.info('Non-retryable error, stopping strategy attempts', {
            component: ComponentType.SUBTITLE_MANAGER,
            url,
            metadata: {
              strategy,
              errorCode: result.error.code,
              errorMessage: result.error.message
            }
          })
          return result
        }
      } catch (error) {
        this.logger.error('CORS strategy threw error', {
          component: ComponentType.SUBTITLE_MANAGER,
          url,
          metadata: {
            strategy,
            error: error instanceof Error ? error.message : String(error)
          }
        })

        // Continue to next strategy
        continue
      }
    }

    // All strategies failed
    const totalDuration = Date.now() - startTime
    this.logger.error('All CORS strategies failed', {
      component: ComponentType.SUBTITLE_MANAGER,
      url,
      metadata: {
        totalDuration,
        strategiesAttempted: this.config.strategies.length,
        strategies: this.config.strategies
      }
    })

    return {
      success: false,
      error: {
        code: SubtitleErrorCode.CORS_ERROR,
        message: 'All CORS handling strategies failed',
        retryable: false,
      },
      strategy: 'direct',
      url,
    }
  }

  // ========================================
  // Strategy Implementations
  // ========================================

  /**
   * Execute specific CORS strategy
   */
  private async executeStrategy(
    strategy: CorsStrategy,
    url: string,
    options: Partial<FetchConfig>,
  ): Promise<CorsRequestResult> {
    switch (strategy) {
      case 'extension':
        return this.fetchWithExtensionPermissions(url, options)

      case 'background':
        return this.fetchWithBackgroundScript(url, options)

      case 'content_script':
        return this.fetchWithContentScript(url, options)

      case 'proxy':
        return this.fetchWithProxy(url, options)

      case 'direct':
        return this.fetchDirect(url, options)

      default:
        throw new Error(`Unknown CORS strategy: ${strategy}`)
    }
  }

  /**
   * Fetch using Chrome extension permissions
   */
  private async fetchWithExtensionPermissions(
    url: string,
    options: Partial<FetchConfig>,
  ): Promise<CorsRequestResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/vtt,text/plain,application/xml,text/xml,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
          ...options.headers,
        },
        credentials: 'omit', // Don't send cookies for CORS
        mode: 'cors', // Explicitly request CORS
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          success: false,
          error: {
            code:
              response.status === 404 ? SubtitleErrorCode.NOT_FOUND : SubtitleErrorCode.HTTP_ERROR,
            message: `HTTP ${response.status}: ${response.statusText}`,
            httpStatus: response.status,
            retryable: response.status >= 500 || response.status === 408 || response.status === 429,
          },
          strategy: 'extension',
          url,
          statusCode: response.status,
        }
      }

      const data = await response.text()
      const responseHeaders = this.extractHeaders(response)

      return {
        success: true,
        data,
        strategy: 'extension',
        url,
        responseHeaders,
        statusCode: response.status,
      }
    } catch (error) {
      return {
        success: false,
        error: this.convertFetchError(error),
        strategy: 'extension',
        url,
      }
    }
  }

  /**
   * Fetch using background script
   */
  private async fetchWithBackgroundScript(
    url: string,
    options: Partial<FetchConfig>,
  ): Promise<CorsRequestResult> {
    try {
      // Send message to background script to make the request
      const response = await chrome.runtime.sendMessage({
        type: 'FETCH_SUBTITLE',
        url,
        options: {
          timeout: this.config.timeout,
          headers: options.headers,
        },
      })

      if (response.success) {
        return {
          success: true,
          data: response.data,
          strategy: 'background',
          url,
          responseHeaders: response.headers,
          statusCode: response.statusCode,
        }
      } else {
        return {
          success: false,
          error: response.error,
          strategy: 'background',
          url,
        }
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: SubtitleErrorCode.EXTENSION_ERROR,
          message: 'Background script communication failed',
          originalError: error,
          retryable: true,
        },
        strategy: 'background',
        url,
      }
    }
  }

  /**
   * Fetch using content script context
   */
  private async fetchWithContentScript(
    url: string,
    options: Partial<FetchConfig>,
  ): Promise<CorsRequestResult> {
    try {
      // Inject fetch into YouTube page context to bypass some CORS restrictions
      const script = `
        (async function() {
          try {
            const response = await fetch('${url}', {
              method: 'GET',
              headers: {
                'Accept': 'text/vtt,text/plain,application/xml,text/xml,*/*',
                'Cache-Control': 'no-cache'
              },
              credentials: 'same-origin'
            });
            
            if (!response.ok) {
              return {
                success: false,
                error: {
                  code: 'HTTP_ERROR',
                  message: 'HTTP ' + response.status + ': ' + response.statusText,
                  httpStatus: response.status
                }
              };
            }
            
            const text = await response.text();
            return {
              success: true,
              data: text,
              statusCode: response.status
            };
          } catch (error) {
            return {
              success: false,
              error: {
                code: 'NETWORK_ERROR',
                message: error.message
              }
            };
          }
        })();
      `

      // Execute in page context
      const result = await this.executeInPageContext(script)

      return {
        success: result.success,
        data: result.data,
        error: result.error,
        strategy: 'content_script',
        url,
        statusCode: result.statusCode,
      }
    } catch (error) {
      return {
        success: false,
        error: {
          code: SubtitleErrorCode.CONTENT_SCRIPT_ERROR,
          message: 'Content script execution failed',
          originalError: error,
          retryable: false,
        },
        strategy: 'content_script',
        url,
      }
    }
  }

  /**
   * Fetch using proxy service
   */
  private async fetchWithProxy(
    url: string,
    options: Partial<FetchConfig>,
  ): Promise<CorsRequestResult> {
    if (!this.config.proxyEndpoint) {
      return {
        success: false,
        error: {
          code: SubtitleErrorCode.CONFIG_ERROR,
          message: 'Proxy endpoint not configured',
          retryable: false,
        },
        strategy: 'proxy',
        url,
      }
    }

    try {
      const proxyUrl = `${this.config.proxyEndpoint}?url=${encodeURIComponent(url)}`

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

      const response = await fetch(proxyUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'text/plain,application/json,*/*',
          ...options.headers,
        },
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: SubtitleErrorCode.PROXY_ERROR,
            message: `Proxy failed: HTTP ${response.status}`,
            httpStatus: response.status,
            retryable: response.status >= 500,
          },
          strategy: 'proxy',
          url,
        }
      }

      const data = await response.text()

      return {
        success: true,
        data,
        strategy: 'proxy',
        url,
        statusCode: response.status,
      }
    } catch (error) {
      return {
        success: false,
        error: this.convertFetchError(error),
        strategy: 'proxy',
        url,
      }
    }
  }

  /**
   * Direct fetch (may fail due to CORS)
   */
  private async fetchDirect(
    url: string,
    options: Partial<FetchConfig>,
  ): Promise<CorsRequestResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'text/vtt,text/plain,application/xml,text/xml,*/*',
          ...options.headers,
        },
        mode: 'cors',
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          success: false,
          error: {
            code:
              response.status === 404 ? SubtitleErrorCode.NOT_FOUND : SubtitleErrorCode.HTTP_ERROR,
            message: `HTTP ${response.status}: ${response.statusText}`,
            httpStatus: response.status,
            retryable: response.status >= 500,
          },
          strategy: 'direct',
          url,
          statusCode: response.status,
        }
      }

      const data = await response.text()
      const responseHeaders = this.extractHeaders(response)

      return {
        success: true,
        data,
        strategy: 'direct',
        url,
        responseHeaders,
        statusCode: response.status,
      }
    } catch (error) {
      return {
        success: false,
        error: this.convertFetchError(error),
        strategy: 'direct',
        url,
      }
    }
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Execute script in page context
   */
  private async executeInPageContext(script: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const scriptElement = document.createElement('script')
      scriptElement.textContent = `
        (async function() {
          try {
            const result = await (${script});
            window.postMessage({
              type: 'LINGUA_TUBE_FETCH_RESULT',
              result
            }, '*');
          } catch (error) {
            window.postMessage({
              type: 'LINGUA_TUBE_FETCH_RESULT',
              error: {
                message: error.message,
                code: 'SCRIPT_ERROR'
              }
            }, '*');
          }
        })();
      `

      const messageHandler = (event: MessageEvent) => {
        if (event.data?.type === 'LINGUA_TUBE_FETCH_RESULT') {
          window.removeEventListener('message', messageHandler)
          document.head.removeChild(scriptElement)

          if (event.data.error) {
            reject(new Error(event.data.error.message))
          } else {
            resolve(event.data.result)
          }
        }
      }

      window.addEventListener('message', messageHandler)

      // Timeout after 30 seconds
      setTimeout(() => {
        window.removeEventListener('message', messageHandler)
        document.head.removeChild(scriptElement)
        reject(new Error('Script execution timeout'))
      }, 30000)

      document.head.appendChild(scriptElement)
    })
  }

  /**
   * Extract headers from Response object
   */
  private extractHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {}

    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })

    return headers
  }

  /**
   * Convert fetch error to SubtitleFetchError
   */
  private convertFetchError(error: unknown): SubtitleFetchError {
    if (error instanceof Error) {
      let code = SubtitleErrorCode.NETWORK_ERROR
      let retryable = true

      const message = error.message.toLowerCase()

      if (message.includes('cors')) {
        code = SubtitleErrorCode.CORS_ERROR
        retryable = false
      } else if (message.includes('abort')) {
        code = SubtitleErrorCode.TIMEOUT
      } else if (message.includes('network')) {
        code = SubtitleErrorCode.NETWORK_ERROR
      }

      return {
        code,
        message: error.message,
        originalError: error,
        retryable,
      }
    }

    return {
      code: SubtitleErrorCode.UNKNOWN_ERROR,
      message: 'Unknown fetch error',
      originalError: error,
      retryable: true,
    }
  }

  /**
   * Get CORS configuration
   */
  getConfig(): CorsConfig {
    return { ...this.config }
  }

  /**
   * Create new CORS handler with updated configuration
   */
  withConfig(config: Partial<CorsConfig>): CorsHandler {
    return new CorsHandler({ ...this.config, ...config })
  }

  /**
   * Test CORS strategy for a given URL
   */
  async testStrategy(
    strategy: CorsStrategy,
    url: string,
  ): Promise<{ success: boolean; error?: string; timing: number }> {
    const startTime = Date.now()

    try {
      const result = await this.executeStrategy(strategy, url, {})
      const timing = Date.now() - startTime

      return {
        success: result.success,
        error: result.error?.message,
        timing,
      }
    } catch (error) {
      const timing = Date.now() - startTime

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timing,
      }
    }
  }
}

// ========================================
// Factory Functions and Utilities
// ========================================

/**
 * Create CORS handler with default configuration
 */
export function createCorsHandler(config?: Partial<CorsConfig>): CorsHandler {
  return new CorsHandler(config)
}

/**
 * Create CORS handler optimized for Chrome extensions
 */
export function createExtensionCorsHandler(): CorsHandler {
  return new CorsHandler({
    strategies: ['extension', 'background'],
    timeout: 15000,
    retryOnCorsError: false,
    enableLogging: true,
  })
}

/**
 * Create CORS handler with all strategies
 */
export function createComprehensiveCorsHandler(proxyEndpoint?: string): CorsHandler {
  return new CorsHandler({
    strategies: ['extension', 'background', 'content_script', 'proxy', 'direct'],
    timeout: 30000,
    retryOnCorsError: true,
    enableLogging: true,
    proxyEndpoint,
  })
}

/**
 * Quick CORS fetch function
 */
export async function corsAwareFetch(url: string, options?: Partial<FetchConfig>): Promise<string> {
  const corsHandler = createExtensionCorsHandler()
  const result = await corsHandler.fetchWithCorsHandling(url, options)

  if (result.success && result.data) {
    return result.data
  }

  throw result.error || new Error('CORS fetch failed')
}

/**
 * Default CORS handler instance
 */
export const corsHandler = createExtensionCorsHandler()
