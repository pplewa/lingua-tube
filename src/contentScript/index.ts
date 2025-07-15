/**
 * LinguaTube Content Script
 * Main entry point for the LinguaTube extension on YouTube pages
 */

import { subtitleDiscoveryService } from '../youtube';
import { DualSubtitleManager } from '../ui/DualSubtitleManager';
import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { VocabularyListManager } from '../ui/VocabularyListManager';
import { EnhancedPlaybackControlsComponent } from '../ui/EnhancedPlaybackControlsComponent';
import { PlayerInteractionService } from '../youtube/PlayerInteractionService';
import { SubtitleDiscoveryEvent } from '../youtube/types';
import { storageService } from '../storage';
import { TranslationApiService } from '../translation/TranslationApiService';
import { ConfigService } from '../translation/ConfigService';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';
import { WordLookupPopup } from '../ui/WordLookupPopup';
import { DictionaryApiService } from '../translation/DictionaryApiService';
import { TTSService } from '../translation/TTSService';

Logger.getInstance()?.info('All imports loaded successfully', {
  component: ComponentType.CONTENT_SCRIPT,
});

// ========================================
// Content Script State
// ========================================

interface ContentScriptState {
  isInitialized: boolean;
  currentVideoId: string | null;
  captionObserverCleanup?: () => void;
  components: {
    subtitleManager: DualSubtitleManager | null;
    vocabularyManager: VocabularyManager | null;
    vocabularyListManager: VocabularyListManager | null;
    playbackControls: EnhancedPlaybackControlsComponent | null;
    playerService: PlayerInteractionService | null;
    translationService: TranslationApiService | null;
    wordLookupPopup: WordLookupPopup | null;
    dictionaryService: DictionaryApiService | null;
    ttsService: TTSService | null;
  };
}

// ========================================
// Main Content Script Class
// ========================================

class LinguaTubeContentScript {
  private logger: Logger | null = null;
  private state: ContentScriptState;
  private isDestroyed = false;
  private retryTimeout: number | null = null;
  private initializationAttempts = 0;

  constructor() {
    this.logger = Logger.getInstance();
    this.logger?.info('Creating LinguaTubeContentScript instance', {
      component: ComponentType.CONTENT_SCRIPT,
    });
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
    };

    this.logger?.info('LinguaTubeContentScript constructor completed', {
      component: ComponentType.CONTENT_SCRIPT,
    });
    this.logger?.info('LinguaTube Content Script starting', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'constructor',
      metadata: {
        url: window.location.href,
        timestamp: Date.now(),
      },
    });
  }

  // ========================================
  // Main Initialization
  // ========================================

  public async initialize(): Promise<boolean> {
    this.logger?.info('Starting initialization...', { component: ComponentType.CONTENT_SCRIPT });
    try {
      if (this.state.isInitialized) {
        this.logger?.info('Already initialized, skipping', {
          component: ComponentType.CONTENT_SCRIPT,
        });
        return true;
      }

      this.initializationAttempts++;
      this.logger?.info('Initialization attempt', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: { attempt: this.initializationAttempts },
      });
      this.logger?.info('Starting LinguaTube initialization', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize',
        metadata: { attempt: this.initializationAttempts },
      });

      // Wait for YouTube player to be available
      this.logger?.info('Waiting for YouTube player...', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      const playerReady = await this.waitForYouTubePlayer();
      if (!playerReady) {
        this.logger?.error('YouTube player not available', {
          component: ComponentType.CONTENT_SCRIPT,
        });
        throw new Error('YouTube player not available');
      }
      this.logger?.info('YouTube player ready', { component: ComponentType.CONTENT_SCRIPT });

      // Initialize core services
      this.logger?.info('Initializing core services...', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      await this.initializeCoreServices();
      this.logger?.info('Core services initialized', { component: ComponentType.CONTENT_SCRIPT });

      // Initialize UI components
      this.logger?.info('Initializing UI components...', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      await this.initializeUIComponents();
      this.logger?.info('UI components initialized', { component: ComponentType.CONTENT_SCRIPT });

      // Setup basic event listeners
      this.logger?.info('Setting up event listeners...', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      this.setupBasicEventListeners();
      this.logger?.info('Event listeners set up', { component: ComponentType.CONTENT_SCRIPT });

      this.state.isInitialized = true;
      this.logger?.info('✅ Initialization completed successfully!', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      this.logger?.info('LinguaTube initialization completed successfully', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize_complete',
        metadata: { attempts: this.initializationAttempts },
      });

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger?.error(
        '❌ Initialization failed',
        {
          component: ComponentType.CONTENT_SCRIPT,
          action: 'initialize_error',
          metadata: {
            attempt: this.initializationAttempts,
            error: errorMessage,
          },
        },
        error instanceof Error ? error : undefined,
      );

      // Simple retry logic
      if (this.initializationAttempts < 3 && !this.isDestroyed) {
        this.logger?.info('Scheduling retry', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: {
            retryDelay: 2000 * this.initializationAttempts,
            attempt: this.initializationAttempts,
          },
        });
        this.retryTimeout = window.setTimeout(() => {
          this.initialize();
        }, 2000 * this.initializationAttempts);
      }

      return false;
    }
  }

  // ========================================
  // Core Services Initialization
  // ========================================

  private async initializeCoreServices(): Promise<void> {
    // Initialize storage service
    await storageService.initialize();
    this.logger?.debug('Storage service initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'storage_ready',
    });

    // Initialize player interaction service
    this.state.components.playerService = PlayerInteractionService.getInstance();
    await this.state.components.playerService.initialize();
    this.logger?.debug('Player service initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'player_ready',
    });

    // Initialize vocabulary manager
    this.state.components.vocabularyManager = VocabularyManager.getInstance();
    this.logger?.debug('Vocabulary manager initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'vocabulary_ready',
    });

    // Initialize translation service if configured
    const configService = new ConfigService();
    const isConfigured = await configService.isConfigured();
    if (isConfigured) {
      this.state.components.translationService = new TranslationApiService();
      this.logger?.debug('Translation service initialized', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'translation_ready',
      });
    }
  }

  // ========================================
  // UI Components Initialization
  // ========================================

  private async initializeUIComponents(): Promise<void> {
    if (!this.state.components.playerService) {
      throw new Error('Player service not available');
    }

    // Initialize additional services needed for WordLookupPopup
    this.state.components.dictionaryService = new DictionaryApiService();
    this.state.components.ttsService = new TTSService();

    // Initialize word lookup popup
    this.state.components.wordLookupPopup = new WordLookupPopup(
      this.state.components.dictionaryService,
      this.state.components.translationService || new TranslationApiService(),
      this.state.components.ttsService,
      storageService,
      this.state.components.vocabularyManager || VocabularyManager.getInstance(),
    );

    // Initialize dual subtitle manager with word lookup popup
    this.state.components.subtitleManager = new DualSubtitleManager(
      this.state.components.playerService,
      storageService,
      this.state.components.wordLookupPopup,
    );
    await this.state.components.subtitleManager.initialize();
    this.logger?.debug('Subtitle manager initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'subtitle_manager_ready',
    });

    // Initialize vocabulary list manager
    try {
      this.state.components.vocabularyListManager = VocabularyListManager.getInstance();
      await this.state.components.vocabularyListManager.initialize();
      this.logger?.debug('Vocabulary list manager initialized', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'vocabulary_list_ready',
      });
    } catch (error) {
      this.logger?.warn('Vocabulary list manager initialization failed - continuing without it', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'vocabulary_list_warning',
      });
    }

    // Initialize enhanced playback controls
    try {
      this.state.components.playbackControls = new EnhancedPlaybackControlsComponent(
        this.state.components.playerService,
        storageService,
      );
      await this.state.components.playbackControls.initialize();
      this.logger?.debug('Enhanced playback controls initialized', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'playback_controls_ready',
      });
    } catch (error) {
      this.logger?.warn(
        'Enhanced playback controls initialization failed - continuing without them',
        {
          component: ComponentType.CONTENT_SCRIPT,
          action: 'playback_controls_warning',
        },
      );
    }
  }

  // ========================================
  // Event Listeners Setup
  // ========================================

  private setupBasicEventListeners(): void {
    // Start subtitle discovery monitoring
    subtitleDiscoveryService.startMonitoring();
    this.logger?.debug('Subtitle discovery monitoring started', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'subtitle_discovery_started',
    });

    // Listen for subtitle discovery events
    this.setupSubtitleDiscoveryEventListeners();

    // Listen for page navigation changes
    this.setupNavigationListener();
  }

  private setupSubtitleDiscoveryEventListeners(): void {
    // Listen for when subtitles are discovered
    subtitleDiscoveryService.addEventListener(
      SubtitleDiscoveryEvent.TRACKS_DISCOVERED,
      async (event: any) => {
        this.logger?.info('Subtitles discovered, loading into player service...', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { event },
        });

        if (!this.state.components.playerService) {
          this.logger?.warn('Player service not available for subtitle loading', {
            component: ComponentType.CONTENT_SCRIPT,
          });
          return;
        }

        // Get the tracks from the event data property
        const tracks = event.data?.tracks || event.tracks || [];
        this.logger?.debug('Available tracks', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { tracksCount: tracks.length, tracks },
        });

        // Enhanced debugging for language detection
        this.logger?.debug('🔍 Subtitle Track Language Analysis', {
          component: ComponentType.CONTENT_SCRIPT,
        });
        tracks.forEach((track: any, index: number) => {
          this.logger?.debug('Track details', {
            component: ComponentType.CONTENT_SCRIPT,
            metadata: {
              index,
              languageCode: track.languageCode,
              languageName: track.languageName,
              name: track.name,
              isAutoGenerated: track.isAutoGenerated,
              vssId: track.vssId,
            },
          });
        });

        if (tracks.length === 0) {
          this.logger?.info('No tracks available in event data', {
            component: ComponentType.CONTENT_SCRIPT,
          });
          return;
        }

        // Get the first available subtitle track (prioritize human-created over auto-generated)
        const preferredTrack =
          tracks.find((track: any) => track.languageCode === 'th') || tracks[0];
        const nativeTrack = tracks.find((track: any) => track.languageCode === 'en') || tracks[0];
        this.logger?.info('Selected track', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: {
            languageCode: preferredTrack?.languageCode,
            name: preferredTrack?.name,
            isAutoGenerated: preferredTrack?.isAutoGenerated,
          },
        });

        if (preferredTrack) {
          try {
            // Update language settings based on selected subtitle track
            await this.updateLanguageSettings(preferredTrack.languageCode);

            //
            const subtitleTrack = await this.fetchSubtitleData(preferredTrack, nativeTrack);

            this.state.components.playerService.loadSubtitleTrack(subtitleTrack);

            // Skip API fetch - directly start DOM-based subtitle observation
            this.logger?.info('Starting DOM-based subtitle observation', {
              component: ComponentType.CONTENT_SCRIPT,
              metadata: { languageCode: preferredTrack.languageCode },
            });
            // this.startDOMSubtitleObservation(preferredTrack)
          } catch (error) {
            this.logger?.error(
              'Failed to start subtitle observation',
              {
                component: ComponentType.CONTENT_SCRIPT,
              },
              error instanceof Error ? error : undefined,
            );
          }
        } else {
          this.logger?.info('No suitable subtitle tracks found', {
            component: ComponentType.CONTENT_SCRIPT,
          });
        }
      },
    );

    // Listen for video changes to clear old subtitles
    subtitleDiscoveryService.addEventListener(SubtitleDiscoveryEvent.VIDEO_CHANGED, () => {
      this.logger?.info('Video changed, clearing subtitle track', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      if (this.state.components.playerService) {
        this.state.components.playerService.clearSubtitleTrack();
      }
    });
  }

  /**
   * Update user language settings when a new subtitle track is selected
   */
  private async updateLanguageSettings(subtitleLanguageCode: string): Promise<void> {
    try {
      this.logger?.info('Updating language settings for subtitle language', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: { subtitleLanguageCode },
      });

      // Get current settings
      const settingsResult = await storageService.getSettings();
      if (!settingsResult.success || !settingsResult.data) {
        this.logger?.warn('Could not load current settings for language update', {
          component: ComponentType.CONTENT_SCRIPT,
        });
        return;
      }

      const currentSettings = settingsResult.data;

      const updatedSettings = {
        ...currentSettings,
        languages: {
          ...currentSettings.languages,
          sourceLanguage: subtitleLanguageCode,
        },
      };

      // Save the updated settings
      const saveResult = await storageService.saveSettings(updatedSettings);
      if (saveResult.success) {
        this.logger?.info('✅ Set source language to auto for automatic detection', {
          component: ComponentType.CONTENT_SCRIPT,
        });

        // Propagate the language change to the subtitle manager if it exists
        if (this.state.components.subtitleManager) {
          this.state.components.subtitleManager.setLanguages(
            currentSettings.languages.sourceLanguage,
            currentSettings.languages.nativeLanguage,
          );
          this.logger?.info('Updated DualSubtitleManager with auto language detection', {
            component: ComponentType.CONTENT_SCRIPT,
          });
        }
      } else {
        this.logger?.error('Failed to save language settings', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { error: saveResult.error },
        });
      }
    } catch (error) {
      this.logger?.error(
        'Error updating language settings',
        { component: ComponentType.CONTENT_SCRIPT },
        error instanceof Error ? error : undefined,
      );
    }
  }

  private async fetchSubtitleData(track: any, nativeTrack: any): Promise<any> {
    try {
      this.logger?.info('Fetching subtitle data for track', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          languageCode: track?.languageCode,
          name: track?.name,
        },
      });
      this.logger?.debug('Track baseUrl', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: { baseUrl: track?.baseUrl },
      });
      const pot = (await chrome.storage.local.get(['pot']))?.pot;

      if (!pot) {
        this.logger?.info('No PO TOKEN found, skipping subtitle fetch', {
          component: ComponentType.CONTENT_SCRIPT,
        });
        return null;
      }

      // Parse as YouTube subtitle data if it has the right structure
      if (this.state.components.playerService && track.baseUrl) {
        this.logger?.info('Starting fetch from YouTube API...', {
          component: ComponentType.CONTENT_SCRIPT,
        });

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
        ]);
        const [response, nativeResponse] = responses;
        this.logger?.debug('Fetch response status', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { status: response.status, statusText: response.statusText },
        });
        this.logger?.debug('Response headers', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { headers: Object.fromEntries(response.headers.entries()) },
        });

        if (!response.ok) {
          this.logger?.error('Failed to fetch subtitles', {
            component: ComponentType.CONTENT_SCRIPT,
            metadata: { status: response.status, statusText: response.statusText },
          });
          return null;
        }

        const textElements: any[] = (await response.json())?.events ?? [];
        const nativeTextElements: any[] = (await nativeResponse.json())?.events ?? [];
        const cues: any[] = [];
        this.logger?.info('Found text elements', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { textElementsCount: textElements.length },
        });

        textElements.forEach((element, index) => {
          const start = element.tStartMs;
          const dur = element.dDurationMs;
          const text =
            element?.segs
              ?.reduce((reducer: string, e: any) => {
                reducer = `${reducer}${e.utf8}`;
                return reducer;
              }, '')
              .trim() || '';
          const nativeText =
            nativeTrack.baseUrl === track.baseUrl
              ? ''
              : nativeTextElements
                  .find((e) => e.tStartMs === start)
                  ?.segs?.reduce((reducer: string, e: any) => {
                    reducer = `${reducer}${e.utf8}`;
                    return reducer;
                  }, '')
                  .trim() || '';

          if (text) {
            cues.push({
              id: `cue_${index}`,
              startTime: start / 1000,
              endTime: (start + dur) / 1000,
              text: text,
              nativeText: nativeText,
              language: track.languageCode || 'unknown',
              confidence: track.isAutoGenerated ? 0.85 : 1.0,
            });
          }
        });

        this.logger?.info('Successfully parsed subtitle cues', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { cuesCount: cues.length },
        });

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
        };

        this.logger?.info('Created subtitle track', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: {
            trackId: subtitleTrack.id,
            language: subtitleTrack.language,
            cuesCount: subtitleTrack.cues.length,
          },
        });
        return subtitleTrack;
      }

      this.logger?.info('No baseUrl available or player service not ready', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      return null;
    } catch (error) {
      this.logger?.error(
        'Error fetching subtitle data',
        { component: ComponentType.CONTENT_SCRIPT },
        error instanceof Error ? error : undefined,
      );
      return null;
    }
  }

  private setupNavigationListener(): void {
    let currentUrl = window.location.href;

    const checkForNavigation = () => {
      if (window.location.href !== currentUrl) {
        const newVideoId = this.extractVideoId(window.location.href);
        if (newVideoId !== this.state.currentVideoId) {
          this.handleVideoChange(newVideoId);
        }
        currentUrl = window.location.href;
      }
    };

    // Check for navigation changes every 2 seconds
    setInterval(checkForNavigation, 2000);
  }

  // ========================================
  // Utility Methods
  // ========================================

  private async waitForYouTubePlayer(): Promise<boolean> {
    const maxAttempts = 30; // 30 seconds
    let attempts = 0;

    this.logger?.info('Waiting for YouTube video element...', {
      component: ComponentType.CONTENT_SCRIPT,
    });

    while (attempts < maxAttempts) {
      const videoElement = document.querySelector('video') as HTMLVideoElement;
      this.logger?.debug('Player detection attempt', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          attempt: attempts + 1,
          videoElementFound: !!videoElement,
        },
      });

      if (videoElement) {
        this.logger?.debug('Video element readyState', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { readyState: videoElement.readyState },
        });
        if (videoElement.readyState >= 1) {
          this.logger?.info('✓ YouTube player ready!', {
            component: ComponentType.CONTENT_SCRIPT,
            action: 'player_detected',
            metadata: { attempts: attempts + 1 },
          });
          return true;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    this.logger?.error('❌ YouTube player detection timeout', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'player_timeout',
      metadata: { maxAttempts },
    });
    return false;
  }

  private extractVideoId(url: string): string | null {
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  }

  private handleVideoChange(newVideoId: string | null): void {
    this.state.currentVideoId = newVideoId;
    this.logger?.info('Video changed', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'video_change',
      metadata: { newVideoId },
    });

    // Notify components about video change if they support it
    // Note: This is simplified - in a full implementation,
    // components would have standardized video change handlers
  }

  // ========================================
  // Cleanup
  // ========================================

  public destroy(): void {
    if (this.isDestroyed) return;

    this.logger?.info('Destroying LinguaTube content script', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'destroy',
    });

    this.isDestroyed = true;

    // Clear retry timeout
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    // Destroy components
    try {
      this.state.components.subtitleManager?.destroy();
      this.state.components.vocabularyListManager?.destroy();
      this.state.components.playbackControls?.destroy();
      this.state.components.wordLookupPopup?.destroy();
      this.state.components.playerService?.shutdown();
    } catch (error) {
      this.logger?.warn('Error during component cleanup', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'cleanup_warning',
      });
    }

    // Stop subtitle discovery
    subtitleDiscoveryService.stopMonitoring();

    this.logger?.info('LinguaTube content script destroyed', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'destroy_complete',
    });
  }
}

// ========================================
// Module Initialization
// ========================================

const moduleLogger = Logger.getInstance();
moduleLogger?.info('Module initialization starting...', {
  component: ComponentType.CONTENT_SCRIPT,
});
moduleLogger?.debug('Document ready state', {
  component: ComponentType.CONTENT_SCRIPT,
  metadata: { readyState: document.readyState },
});

let contentScript: LinguaTubeContentScript | null = null;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  moduleLogger?.info('Document still loading, waiting for DOMContentLoaded', {
    component: ComponentType.CONTENT_SCRIPT,
  });
  document.addEventListener('DOMContentLoaded', () => {
    moduleLogger?.info('DOMContentLoaded event fired', { component: ComponentType.CONTENT_SCRIPT });
    initializeContentScript();
  });
} else {
  moduleLogger?.info('Document already ready, initializing immediately', {
    component: ComponentType.CONTENT_SCRIPT,
  });
  initializeContentScript();
}

async function initializeContentScript(): Promise<void> {
  moduleLogger?.info('initializeContentScript called', { component: ComponentType.CONTENT_SCRIPT });
  moduleLogger?.debug('Current URL', {
    component: ComponentType.CONTENT_SCRIPT,
    metadata: { url: window.location.href },
  });

  try {
    // Only initialize on YouTube video pages
    if (!window.location.href.includes('youtube.com/watch')) {
      moduleLogger?.info('Not a YouTube video page, skipping initialization', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      moduleLogger?.debug('Expected URL pattern: youtube.com/watch', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      return;
    }

    moduleLogger?.info('✓ YouTube video page detected, proceeding with initialization', {
      component: ComponentType.CONTENT_SCRIPT,
    });
    contentScript = new LinguaTubeContentScript();
    await contentScript.initialize();
  } catch (error) {
    moduleLogger?.error(
      'Content script initialization failed',
      { component: ComponentType.CONTENT_SCRIPT },
      error instanceof Error ? error : undefined,
    );
  }
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  contentScript?.destroy();
});

// Export for potential external access
if (typeof window !== 'undefined') {
  (window as any).linguaTubeContentScript = contentScript;
}
