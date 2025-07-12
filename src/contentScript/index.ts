/**
 * LinguaTube Content Script
 * Main entry point for the LinguaTube extension on YouTube pages
 */

import { subtitleDiscoveryService } from '../youtube'
import { DualSubtitleManager } from '../ui/DualSubtitleManager'
import { VocabularyManager } from '../vocabulary/VocabularyManager'
import { VocabularyListManager } from '../ui/VocabularyListManager'
import { EnhancedPlaybackControlsComponent } from '../ui/EnhancedPlaybackControlsComponent'
import { PlayerInteractionService } from '../youtube/PlayerInteractionService'
import { SubtitleDiscoveryEvent } from '../youtube/types'
import { storageService } from '../storage'
import { TranslationApiService } from '../translation/TranslationApiService'
import { ConfigService } from '../translation/ConfigService'
import { Logger } from '../logging/Logger'
import { ComponentType } from '../logging/types'
import { WordLookupPopup } from '../ui/WordLookupPopup'
import { DictionaryApiService } from '../translation/DictionaryApiService'
import { TTSService } from '../translation/TTSService'

console.log('[LinguaTube] All imports loaded successfully')

// ========================================
// Content Script State
// ========================================

interface ContentScriptState {
  isInitialized: boolean
  currentVideoId: string | null
  captionObserverCleanup?: () => void
  components: {
    subtitleManager: DualSubtitleManager | null
    vocabularyManager: VocabularyManager | null
    vocabularyListManager: VocabularyListManager | null
    playbackControls: EnhancedPlaybackControlsComponent | null
    playerService: PlayerInteractionService | null
    translationService: TranslationApiService | null
    wordLookupPopup: WordLookupPopup | null
    dictionaryService: DictionaryApiService | null
    ttsService: TTSService | null
  }
}

// ========================================
// Main Content Script Class
// ========================================

class LinguaTubeContentScript {
  private logger: Logger
  private state: ContentScriptState
  private isDestroyed = false
  private retryTimeout: number | null = null
  private initializationAttempts = 0

  constructor() {
    console.log('[LinguaTube] Creating LinguaTubeContentScript instance')
    this.logger = Logger.getInstance()
    this.state = {
      isInitialized: false,
      currentVideoId: null,
      components: {
        subtitleManager: null,
        vocabularyManager: null,
        vocabularyListManager: null,
        playbackControls: null,
        playerService: null,
        translationService: null,
        wordLookupPopup: null,
        dictionaryService: null,
        ttsService: null,
      },
    }

    console.log('[LinguaTube] LinguaTubeContentScript constructor completed')
    this.logger.info('LinguaTube Content Script starting', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'constructor',
      metadata: {
        url: window.location.href,
        timestamp: Date.now(),
      },
    })
  }

  // ========================================
  // Main Initialization
  // ========================================

  public async initialize(): Promise<boolean> {
    console.log('[LinguaTube] Starting initialization...')
    try {
      if (this.state.isInitialized) {
        console.log('[LinguaTube] Already initialized, skipping')
        this.logger.warn('Content script already initialized')
        return true
      }

      this.initializationAttempts++
      console.log('[LinguaTube] Initialization attempt:', this.initializationAttempts)
      this.logger.info('Starting LinguaTube initialization', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize',
        metadata: { attempt: this.initializationAttempts },
      })

      // Wait for YouTube player to be available
      console.log('[LinguaTube] Waiting for YouTube player...')
      const playerReady = await this.waitForYouTubePlayer()
      if (!playerReady) {
        console.error('[LinguaTube] YouTube player not available')
        throw new Error('YouTube player not available')
      }
      console.log('[LinguaTube] YouTube player ready')

      // Initialize core services
      console.log('[LinguaTube] Initializing core services...')
      await this.initializeCoreServices()
      console.log('[LinguaTube] Core services initialized')

      // Initialize UI components
      console.log('[LinguaTube] Initializing UI components...')
      await this.initializeUIComponents()
      console.log('[LinguaTube] UI components initialized')

      // Setup basic event listeners
      console.log('[LinguaTube] Setting up event listeners...')
      this.setupBasicEventListeners()
      console.log('[LinguaTube] Event listeners set up')

      this.state.isInitialized = true
      console.log('[LinguaTube] ✅ Initialization completed successfully!')
      this.logger.info('LinguaTube initialization completed successfully', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize_complete',
        metadata: { attempts: this.initializationAttempts },
      })

      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[LinguaTube] ❌ Initialization failed:', errorMessage)
      this.logger.error('LinguaTube initialization failed', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize_error',
        metadata: {
          attempt: this.initializationAttempts,
          error: errorMessage,
        },
      })

      // Simple retry logic
      if (this.initializationAttempts < 3 && !this.isDestroyed) {
        console.log('[LinguaTube] Scheduling retry in', 2000 * this.initializationAttempts, 'ms')
        this.retryTimeout = window.setTimeout(() => {
          this.initialize()
        }, 2000 * this.initializationAttempts)
      }

      return false
    }
  }

  // ========================================
  // Core Services Initialization
  // ========================================

  private async initializeCoreServices(): Promise<void> {
    // Initialize storage service
    await storageService.initialize()
    this.logger.debug('Storage service initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'storage_ready',
    })

    // Initialize player interaction service
    this.state.components.playerService = PlayerInteractionService.getInstance()
    await this.state.components.playerService.initialize()
    this.logger.debug('Player service initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'player_ready',
    })

    // Initialize vocabulary manager
    this.state.components.vocabularyManager = VocabularyManager.getInstance()
    this.logger.debug('Vocabulary manager initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'vocabulary_ready',
    })

    // Initialize translation service if configured
    const configService = new ConfigService()
    const isConfigured = await configService.isConfigured()
    if (isConfigured) {
      this.state.components.translationService = new TranslationApiService()
      this.logger.debug('Translation service initialized', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'translation_ready',
      })
    }
  }

  // ========================================
  // UI Components Initialization
  // ========================================

  private async initializeUIComponents(): Promise<void> {
    if (!this.state.components.playerService) {
      throw new Error('Player service not available')
    }

    // Initialize additional services needed for WordLookupPopup
    this.state.components.dictionaryService = new DictionaryApiService()
    this.state.components.ttsService = new TTSService()

    // Initialize word lookup popup
    this.state.components.wordLookupPopup = new WordLookupPopup(
      this.state.components.dictionaryService,
      this.state.components.translationService || new TranslationApiService(),
      this.state.components.ttsService,
      storageService,
    )

    // Initialize dual subtitle manager with word lookup popup
    this.state.components.subtitleManager = new DualSubtitleManager(
      this.state.components.playerService,
      storageService,
      this.state.components.translationService || new TranslationApiService(),
      this.state.components.wordLookupPopup,
    )
    await this.state.components.subtitleManager.initialize()
    this.logger.debug('Subtitle manager initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'subtitle_manager_ready',
    })

    // Initialize vocabulary list manager
    try {
      this.state.components.vocabularyListManager = VocabularyListManager.getInstance()
      await this.state.components.vocabularyListManager.initialize()
      this.logger.debug('Vocabulary list manager initialized', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'vocabulary_list_ready',
      })
    } catch (error) {
      this.logger.warn('Vocabulary list manager initialization failed - continuing without it', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'vocabulary_list_warning',
      })
    }

    // Initialize enhanced playback controls
    try {
      this.state.components.playbackControls = new EnhancedPlaybackControlsComponent(
        this.state.components.playerService,
        storageService,
      )
      await this.state.components.playbackControls.initialize()
      this.logger.debug('Enhanced playback controls initialized', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'playback_controls_ready',
      })
    } catch (error) {
      this.logger.warn(
        'Enhanced playback controls initialization failed - continuing without them',
        {
          component: ComponentType.CONTENT_SCRIPT,
          action: 'playback_controls_warning',
        },
      )
    }
  }

  // ========================================
  // Event Listeners Setup
  // ========================================

  private setupBasicEventListeners(): void {
    // Start subtitle discovery monitoring
    subtitleDiscoveryService.startMonitoring()
    this.logger.debug('Subtitle discovery monitoring started', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'subtitle_discovery_started',
    })

    // Listen for subtitle discovery events
    this.setupSubtitleDiscoveryEventListeners()

    // Listen for page navigation changes
    this.setupNavigationListener()
  }

  private setupSubtitleDiscoveryEventListeners(): void {
    // Listen for when subtitles are discovered
    subtitleDiscoveryService.addEventListener(
      SubtitleDiscoveryEvent.TRACKS_DISCOVERED,
      async (event: any) => {
        console.log('[LinguaTube] Subtitles discovered, loading into player service...', event)

        if (!this.state.components.playerService) {
          console.warn('[LinguaTube] Player service not available for subtitle loading')
          return
        }

        // Get the tracks from the event data property
        const tracks = event.data?.tracks || event.tracks || []
        console.log('[LinguaTube] Available tracks:', tracks)

        // Enhanced debugging for language detection
        console.log(`[LinguaTube] 🔍 Subtitle Track Language Analysis:`)
        tracks.forEach((track: any, index: number) => {
          console.log(`[LinguaTube] Track ${index}:`, {
            languageCode: track.languageCode,
            languageName: track.languageName,
            name: track.name,
            isAutoGenerated: track.isAutoGenerated,
            vssId: track.vssId,
          })
        })

        if (tracks.length === 0) {
          console.log('[LinguaTube] No tracks available in event data')
          return
        }

        // Get the first available subtitle track (prioritize human-created over auto-generated)
        const preferredTrack = tracks.find((track: any) => track.languageCode === 'th') || tracks[0]
        const nativeTrack = tracks.find((track: any) => track.languageCode === 'en') || tracks[0]
        console.log('[LinguaTube] Selected track:', preferredTrack)

        if (preferredTrack) {
          try {
            // Update language settings based on selected subtitle track
            await this.updateLanguageSettings(preferredTrack.languageCode)

            //
            const subtitleTrack = await this.fetchSubtitleData(preferredTrack, nativeTrack)

            this.state.components.playerService.loadSubtitleTrack(subtitleTrack)

            // Skip API fetch - directly start DOM-based subtitle observation
            console.log(
              `[LinguaTube] Starting DOM-based subtitle observation for: ${preferredTrack.languageCode}`,
            )
            // this.startDOMSubtitleObservation(preferredTrack)
          } catch (error) {
            console.error('[LinguaTube] Failed to start subtitle observation:', error)
          }
        } else {
          console.log('[LinguaTube] No suitable subtitle tracks found')
        }
      },
    )

    // Listen for video changes to clear old subtitles
    subtitleDiscoveryService.addEventListener(SubtitleDiscoveryEvent.VIDEO_CHANGED, () => {
      console.log('[LinguaTube] Video changed, clearing subtitle track')
      if (this.state.components.playerService) {
        this.state.components.playerService.clearSubtitleTrack()
      }
    })
  }

  /**
   * Update user language settings when a new subtitle track is selected
   */
  private async updateLanguageSettings(subtitleLanguageCode: string): Promise<void> {
    try {
      console.log(
        `[LinguaTube] Updating language settings for subtitle language: ${subtitleLanguageCode}`,
      )

      // Get current settings
      const settingsResult = await storageService.getSettings()
      if (!settingsResult.success || !settingsResult.data) {
        console.warn('[LinguaTube] Could not load current settings for language update')
        return
      }

      const currentSettings = settingsResult.data

      // Use 'auto' for source language to let translation API handle detection
      const updatedSettings = {
        ...currentSettings,
        languages: {
          ...currentSettings.languages,
          sourceLanguage: 'auto', // Let translation API auto-detect the language
        },
      }

      // Save the updated settings
      const saveResult = await storageService.saveSettings(updatedSettings)
      if (saveResult.success) {
        console.log(`[LinguaTube] ✅ Set source language to 'auto' for automatic detection`)

        // Propagate the language change to the subtitle manager if it exists
        if (this.state.components.subtitleManager) {
          this.state.components.subtitleManager.setLanguages(
            'auto',
            currentSettings.languages.nativeLanguage,
          )
          console.log('[LinguaTube] Updated DualSubtitleManager with auto language detection')
        }
      } else {
        console.error('[LinguaTube] Failed to save language settings:', saveResult.error)
      }
    } catch (error) {
      console.error('[LinguaTube] Error updating language settings:', error)
    }
  }

  private async fetchSubtitleData(track: any, nativeTrack: any): Promise<any> {
    try {
      console.log('[LinguaTube] Fetching subtitle data for track:', track)
      console.log('[LinguaTube] Track baseUrl:', track.baseUrl)
      const pot = (await chrome.storage.local.get(['pot']))?.pot

      if (!pot) {
        console.log('[LinguaTube] No PO TOKEN found, skipping subtitle fetch')
        return null
      }

      // Parse as YouTube subtitle data if it has the right structure
      if (this.state.components.playerService && track.baseUrl) {
        console.log('[LinguaTube] Starting fetch from YouTube API...')

        // Fetch the subtitle content from YouTube
        const responses = await Promise.all([
          fetch(track.baseUrl + `&pot=${pot}&fmt=json3&c=WEB`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
            headers: {
              Accept: 'application/xml, text/xml, */*',
              'User-Agent': 'Mozilla/5.0 (compatible; LinguaTube)',
            },
          }),
          fetch(nativeTrack.baseUrl + `&pot=${pot}&fmt=json3&c=WEB`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
            headers: {
              Accept: 'application/xml, text/xml, */*',
              'User-Agent': 'Mozilla/5.0 (compatible; LinguaTube)',
            },
          }),
        ])
        const [response, nativeResponse] = responses
        console.log('[LinguaTube] Fetch response status:', response.status, response.statusText)
        console.log(
          '[LinguaTube] Response headers:',
          Object.fromEntries(response.headers.entries()),
        )

        if (!response.ok) {
          console.error(
            '[LinguaTube] Failed to fetch subtitles:',
            response.status,
            response.statusText,
          )
          return null
        }

        const textElements: any[] = (await response.json())?.events ?? []
        const nativeTextElements: any[] = (await nativeResponse.json())?.events ?? []
        const cues: any[] = []
        const nativeCues: any[] = []
        console.log('[LinguaTube] Found', textElements.length, 'text elements')

        textElements.forEach((element, index) => {
          const start = element.tStartMs
          const dur = element.dDurationMs
          const text = element.segs?.[0]?.utf8?.trim() || ''
          const nativeText = nativeTextElements[index]?.segs?.[0]?.utf8?.trim() || ''

          if (text) {
            cues.push({
              id: `cue_${index}`,
              startTime: start / 1000,
              endTime: (start + dur) / 1000,
              text: text,
              nativeText: nativeText,
              language: track.languageCode || 'unknown',
              confidence: track.isAutoGenerated ? 0.85 : 1.0,
            })
          }
        })

        console.log('[LinguaTube] Successfully parsed', cues.length, 'subtitle cues')

        // Create a subtitle track object
        const subtitleTrack = {
          id: `track_${track.languageCode}_${Date.now()}`,
          language: track.languageCode || 'unknown',
          label: track.name?.simpleText || track.languageCode || 'Unknown',
          kind: 'subtitles',
          isDefault: false,
          isAutoGenerated: track.kind === 'asr',
          cues: cues,
          source: 'youtube',
        }

        console.log('[LinguaTube] Created subtitle track:', subtitleTrack)
        return subtitleTrack
      }

      console.log('[LinguaTube] No baseUrl available or player service not ready')
      return null
    } catch (error) {
      console.error('[LinguaTube] Error fetching subtitle data:', error)
      return null
    }
  }

  private setupNavigationListener(): void {
    let currentUrl = window.location.href

    const checkForNavigation = () => {
      if (window.location.href !== currentUrl) {
        const newVideoId = this.extractVideoId(window.location.href)
        if (newVideoId !== this.state.currentVideoId) {
          this.handleVideoChange(newVideoId)
        }
        currentUrl = window.location.href
      }
    }

    // Check for navigation changes every 2 seconds
    setInterval(checkForNavigation, 2000)
  }

  // ========================================
  // Utility Methods
  // ========================================

  private async waitForYouTubePlayer(): Promise<boolean> {
    const maxAttempts = 30 // 30 seconds
    let attempts = 0

    console.log('[LinguaTube] Waiting for YouTube video element...')

    while (attempts < maxAttempts) {
      const videoElement = document.querySelector('video') as HTMLVideoElement
      console.log(`[LinguaTube] Attempt ${attempts + 1}: videoElement found:`, !!videoElement)

      if (videoElement) {
        console.log('[LinguaTube] Video element readyState:', videoElement.readyState)
        if (videoElement.readyState >= 1) {
          console.log('[LinguaTube] ✓ YouTube player ready!')
          this.logger.debug('YouTube player detected', {
            component: ComponentType.CONTENT_SCRIPT,
            action: 'player_detected',
            metadata: { attempts: attempts + 1 },
          })
          return true
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
      attempts++
    }

    console.error('[LinguaTube] ❌ YouTube player detection timeout after', maxAttempts, 'attempts')
    this.logger.error('YouTube player detection timeout', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'player_timeout',
      metadata: { maxAttempts },
    })
    return false
  }

  private extractVideoId(url: string): string | null {
    const match = url.match(/[?&]v=([^&]+)/)
    return match ? match[1] : null
  }

  private handleVideoChange(newVideoId: string | null): void {
    this.state.currentVideoId = newVideoId
    this.logger.info('Video changed', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'video_change',
      metadata: { newVideoId },
    })

    // Notify components about video change if they support it
    // Note: This is simplified - in a full implementation,
    // components would have standardized video change handlers
  }

  // ========================================
  // Cleanup
  // ========================================

  public destroy(): void {
    if (this.isDestroyed) return

    this.logger.info('Destroying LinguaTube content script', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'destroy',
    })

    this.isDestroyed = true

    // Clear retry timeout
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }

    // Destroy components
    try {
      this.state.components.subtitleManager?.destroy()
      this.state.components.vocabularyListManager?.destroy()
      this.state.components.playbackControls?.destroy()
      this.state.components.wordLookupPopup?.destroy()
      this.state.components.playerService?.shutdown()
    } catch (error) {
      this.logger.warn('Error during component cleanup', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'cleanup_warning',
      })
    }

    // Stop subtitle discovery
    subtitleDiscoveryService.stopMonitoring()

    this.logger.info('LinguaTube content script destroyed', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'destroy_complete',
    })
  }
}

// ========================================
// Module Initialization
// ========================================

console.log('[LinguaTube] Module initialization starting...')
console.log('[LinguaTube] Document ready state:', document.readyState)

let contentScript: LinguaTubeContentScript | null = null

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  console.log('[LinguaTube] Document still loading, waiting for DOMContentLoaded')
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[LinguaTube] DOMContentLoaded event fired')
    initializeContentScript()
  })
} else {
  console.log('[LinguaTube] Document already ready, initializing immediately')
  initializeContentScript()
}

async function initializeContentScript(): Promise<void> {
  console.log('[LinguaTube] initializeContentScript called')
  console.log('[LinguaTube] Current URL:', window.location.href)

  try {
    // Only initialize on YouTube video pages
    if (!window.location.href.includes('youtube.com/watch')) {
      console.log('[LinguaTube] Not a YouTube video page, skipping initialization')
      console.log('[LinguaTube] Expected URL pattern: youtube.com/watch')
      return
    }

    console.log('[LinguaTube] ✓ YouTube video page detected, proceeding with initialization')
    contentScript = new LinguaTubeContentScript()
    await contentScript.initialize()
  } catch (error) {
    console.error('[LinguaTube] Content script initialization failed:', error)
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  contentScript?.destroy()
})

// Export for potential external access
if (typeof window !== 'undefined') {
  ;(window as any).linguaTubeContentScript = contentScript
}
