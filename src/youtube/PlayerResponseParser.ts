/**
 * YouTube Player Response Parser
 * Extracts and parses ytInitialPlayerResponse from YouTube pages
 */

import {
  PlayerResponseParseResult,
  YTPlayerCaptions,
  YTVideoDetails,
  YouTubePageContext,
} from './types'
import { Logger } from '../logging/Logger'
import { ComponentType } from '../logging/types'

/**
 * Parser for extracting YouTube player response data
 */
export class YouTubePlayerResponseParser {
  private static readonly RETRY_ATTEMPTS = 3
  private static readonly RETRY_DELAY = 500
  private static readonly PARSER_TIMEOUT = 5000
  private static readonly logger = Logger.getInstance()

  /**
   * Main method to extract and parse ytInitialPlayerResponse
   */
  static async parsePlayerResponse(): Promise<PlayerResponseParseResult> {
    try {
      this.logger?.info('Starting YouTube player response parsing...', {
        component: ComponentType.YOUTUBE_INTEGRATION,
      })

      // Verify we're on a YouTube video page
      const pageContext = this.getPageContext()
      if (!pageContext.isVideoPage) {
        return {
          success: false,
          error: 'Not on a YouTube video page',
        }
      }

      // Try multiple extraction strategies
      const playerResponse = await this.extractPlayerResponseWithRetry()

      if (!playerResponse) {
        return {
          success: false,
          error: 'ytInitialPlayerResponse not found after all attempts',
        }
      }

      // Parse the response
      const parseResult = this.parseResponseData(playerResponse)

      this.logger?.info('Player response parsed successfully', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          videoId: parseResult.videoDetails?.videoId,
          captionTracks:
            parseResult.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0,
        },
      })

      return parseResult
    } catch (error) {
      this.logger?.error('Player response parsing failed', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      return {
        success: false,
        error: `Parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        rawResponse: null,
      }
    }
  }

  /**
   * Extract player response with retry logic
   */
  private static async extractPlayerResponseWithRetry(): Promise<any> {
    for (let attempt = 1; attempt <= this.RETRY_ATTEMPTS; attempt++) {
      this.logger?.info(`Player response extraction attempt ${attempt}/${this.RETRY_ATTEMPTS}`, {
        component: ComponentType.YOUTUBE_INTEGRATION,
      })

      // Try different extraction methods
      const playerResponse =
        this.extractFromWindow() || this.extractFromScripts() || (await this.extractWithDelay())

      if (playerResponse) {
        this.logger?.info('Player response extracted successfully', {
          component: ComponentType.YOUTUBE_INTEGRATION,
        })
        return playerResponse
      }

      // Wait before retry (except last attempt)
      if (attempt < this.RETRY_ATTEMPTS) {
        await this.delay(this.RETRY_DELAY * attempt)
      }
    }

    return null
  }

  /**
   * Extract from window.ytInitialPlayerResponse
   */
  private static extractFromWindow(): any {
    try {
      // @ts-ignore - YouTube's global variable
      if (window.ytInitialPlayerResponse) {
        this.logger?.info('Found ytInitialPlayerResponse on window object', {
          component: ComponentType.YOUTUBE_INTEGRATION,
        })
        // @ts-ignore
        return window.ytInitialPlayerResponse
      }
    } catch (error) {
      this.logger?.error('Window extraction failed', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
    return null
  }

  /**
   * Extract from script tags in the page
   */
  private static extractFromScripts(): any {
    try {
      const scripts = document.querySelectorAll('script')

      for (const script of scripts) {
        const content = script.textContent || script.innerHTML

        // Look for ytInitialPlayerResponse assignment
        const match = content.match(/var\s+ytInitialPlayerResponse\s*=\s*({.+?});/)
        if (match) {
          this.logger?.info('Found ytInitialPlayerResponse in script tag', {
            component: ComponentType.YOUTUBE_INTEGRATION,
          })
          return JSON.parse(match[1])
        }

        // Alternative pattern
        const match2 = content.match(/ytInitialPlayerResponse\s*=\s*({.+?});/)
        if (match2) {
          this.logger?.info('Found ytInitialPlayerResponse (alternative pattern)', {
            component: ComponentType.YOUTUBE_INTEGRATION,
          })
          return JSON.parse(match2[1])
        }

        // Another common pattern
        const match3 = content.match(/"ytInitialPlayerResponse":\s*({.+?})(?:,"webPageType")/)
        if (match3) {
          this.logger?.info('Found ytInitialPlayerResponse (JSON pattern)', {
            component: ComponentType.YOUTUBE_INTEGRATION,
          })
          return JSON.parse(match3[1])
        }
      }
    } catch (error) {
      this.logger?.error('Script extraction failed', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
    }
    return null
  }

  /**
   * Extract with a short delay (for dynamic loading)
   */
  private static async extractWithDelay(): Promise<any> {
    await this.delay(1000)
    return this.extractFromWindow() || this.extractFromScripts()
  }

  /**
   * Parse the raw player response data
   */
  private static parseResponseData(rawResponse: any): PlayerResponseParseResult {
    try {
      if (!rawResponse || typeof rawResponse !== 'object') {
        return {
          success: false,
          error: 'Invalid player response format',
          rawResponse,
        }
      }

      // Extract captions data
      const captions = this.extractCaptionsData(rawResponse)

      // Extract video details
      const videoDetails = this.extractVideoDetails(rawResponse)

      return {
        success: true,
        captions,
        videoDetails,
        rawResponse,
      }
    } catch (error) {
      return {
        success: false,
        error: `Response parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        rawResponse,
      }
    }
  }

  /**
   * Extract captions data from player response
   */
  private static extractCaptionsData(response: any): YTPlayerCaptions | undefined {
    try {
      // Multiple possible paths for captions data
      const possiblePaths = [
        response.captions,
        response.playerResponse?.captions,
        response.contents?.videoDetails?.captions,
      ]

      for (const captions of possiblePaths) {
        if (captions?.playerCaptionsTracklistRenderer) {
          this.logger?.info('Found captions data', {
            component: ComponentType.YOUTUBE_INTEGRATION,
          })
          return captions as YTPlayerCaptions
        }
      }

      this.logger?.info('No captions data found in player response', {
        component: ComponentType.YOUTUBE_INTEGRATION,
      })
      return undefined
    } catch (error) {
      this.logger?.error('Captions extraction failed', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      return undefined
    }
  }

  /**
   * Extract video details from player response
   */
  private static extractVideoDetails(response: any): YTVideoDetails | undefined {
    try {
      const videoDetails = response.videoDetails || response.playerResponse?.videoDetails

      if (!videoDetails) {
        this.logger?.info('No video details found in player response', {
          component: ComponentType.YOUTUBE_INTEGRATION,
        })
        return undefined
      }

      return {
        videoId: videoDetails.videoId || '',
        title: videoDetails.title || '',
        lengthSeconds: videoDetails.lengthSeconds || '0',
        channelId: videoDetails.channelId || '',
        isLive: videoDetails.isLive || false,
        isUpcoming: videoDetails.isUpcoming || false,
      }
    } catch (error) {
      this.logger?.error('Video details extraction failed', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      return undefined
    }
  }

  /**
   * Get current page context
   */
  static getPageContext(): YouTubePageContext {
    const url = window.location.href
    const isVideoPage = url.includes('/watch?v=') || url.includes('/shorts/')

    let videoId: string | undefined
    let playlistId: string | undefined

    if (isVideoPage) {
      // Extract video ID from URL
      const videoMatch = url.match(/[?&]v=([^&]+)/)
      if (videoMatch) {
        videoId = videoMatch[1]
      }

      // Extract playlist ID if present
      const playlistMatch = url.match(/[?&]list=([^&]+)/)
      if (playlistMatch) {
        playlistId = playlistMatch[1]
      }

      // Handle YouTube Shorts
      const shortsMatch = url.match(/\/shorts\/([^?&]+)/)
      if (shortsMatch) {
        videoId = shortsMatch[1]
      }
    }

    return {
      isVideoPage,
      videoId,
      playlistId,
      timestamp: Date.now(),
      url,
    }
  }

  /**
   * Check if player response is available
   */
  static isPlayerResponseAvailable(): boolean {
    try {
      // @ts-ignore
      return !!(window.ytInitialPlayerResponse || this.extractFromScripts())
    } catch {
      return false
    }
  }

  /**
   * Wait for player response to become available
   */
  static async waitForPlayerResponse(timeoutMs: number = this.PARSER_TIMEOUT): Promise<boolean> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      if (this.isPlayerResponseAvailable()) {
        return true
      }
      await this.delay(100)
    }

    return false
  }

  /**
   * Get current video ID from URL or player response
   */
  static getCurrentVideoId(): string | null {
    // Try URL first
    const context = this.getPageContext()
    if (context.videoId) {
      return context.videoId
    }

    // Try player response
    try {
      // @ts-ignore
      const response = window.ytInitialPlayerResponse
      return response?.videoDetails?.videoId || null
    } catch {
      return null
    }
  }

  /**
   * Get current video title
   */
  static getCurrentVideoTitle(): string | null {
    try {
      // Try document title first
      const title = document.title
      if (title && title !== 'YouTube') {
        return title.replace(' - YouTube', '')
      }

      // Try player response
      // @ts-ignore
      const response = window.ytInitialPlayerResponse
      return response?.videoDetails?.title || null
    } catch {
      return null
    }
  }

  /**
   * Check if we're on a valid YouTube video page
   */
  static isValidVideoPage(): boolean {
    const context = this.getPageContext()
    return context.isVideoPage && !!context.videoId
  }

  /**
   * Simple delay utility
   */
  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Clear any cached data (useful for page navigation)
   */
  static clearCache(): void {
    // Clear any internal caches if needed
    this.logger?.info('Player response parser cache cleared', {
      component: ComponentType.YOUTUBE_INTEGRATION,
    })
  }
}
