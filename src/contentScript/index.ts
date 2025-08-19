/**
 * LinguaTube Content Script
 * Main entry point for the LinguaTube extension on YouTube pages
 */

import { subtitleDiscoveryService } from '../youtube';
import { DualSubtitleManager } from '../ui/DualSubtitleManager';
import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { vocabularyObserver } from '../vocabulary/VocabularyObserver';
import { VocabularyListManager } from '../ui/VocabularyListManager';
import { EnhancedPlaybackControlsComponent, ControlsEventData, ControlsEventCallback } from '../ui/EnhancedPlaybackControlsComponent';
import { VocabularyItem } from '../storage/types';
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
      // Enable addon only when query param is present (?lt=1 or ?linguatube=1)
      const params = new URLSearchParams(
        window.location.hash.substring(1) // any_hash_key=any_value
      );
      const enabledParam = params.get('lt') ?? params.get('linguatube') ?? params.get('lingua');
      const shouldEnable = enabledParam === '1' || enabledParam === 'true' || enabledParam === 'on';
      if (!shouldEnable) {
        this.logger?.info('LinguaTube disabled for this video (missing ?lt=1 param). Skipping init.', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { url: window.location.href },
        });
        return false;
      }

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

    // Initialize vocabulary observer
    await vocabularyObserver.initialize();
    this.logger?.debug('Vocabulary observer initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'vocabulary_observer_ready',
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

    // Set up vocabulary mode communication bridge
    this.setupVocabularyModeBridge();

    // Set up vocabulary list communication bridge  
    this.setupVocabularyListBridge();
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
          tracks.find((track: any) => track.languageCode === 'th') || {
            ...tracks[0],
            languageCode: 'th',
            baseUrl: tracks[0].baseUrl + '&tlang=th',
            isAutoGenerated: false,
          };
        const nativeTrack = tracks.find((track: any) => track.languageCode === 'en') || {
          ...tracks[0],
          languageCode: 'en',
          baseUrl: tracks[0].baseUrl + '&tlang=en',
          isAutoGenerated: false,
        };
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
        // Fetch both tracks but ensure we don't hammer the endpoint: small stagger
        const responses = await Promise.all([
          fetch(track.baseUrl + `&pot=${pot}&fmt=json3&c=WEB`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
            headers: {
              Accept: 'application/xml, text/xml, */*',
              // Mimic browser headers to avoid server heuristics distinguishing our requests
              'accept-language': navigator.language || 'en-US,en;q=0.9',
              'cache-control': 'no-cache',
              pragma: 'no-cache',
              'sec-ch-ua': (navigator as any).userAgentData
                ? (navigator as any).userAgentData.brands
                    .map((b: any) => `${b.brand};v="${b.version}"`)
                    .join(', ')
                : '"Not;A=Brand";v="99", "Chromium";v="120"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"' + (navigator.platform || 'macOS') + '"',
              'x-browser-channel': 'stable',
              'x-browser-year': new Date().getFullYear().toString(),
              // IMPORTANT: let the browser set the real UA; do NOT set custom UA
            },
          }),
          fetch(nativeTrack.baseUrl + `&pot=${pot}&fmt=json3&c=WEB`, {
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
            headers: {
              Accept: 'application/xml, text/xml, */*',
              'accept-language': navigator.language || 'en-US,en;q=0.9',
              'cache-control': 'no-cache',
              pragma: 'no-cache',
              'sec-ch-ua': (navigator as any).userAgentData
                ? (navigator as any).userAgentData.brands
                    .map((b: any) => `${b.brand};v="${b.version}"`)
                    .join(', ')
                : '"Not;A=Brand";v="99", "Chromium";v="120"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"' + (navigator.platform || 'macOS') + '"',
              'x-browser-channel': 'stable',
              'x-browser-year': new Date().getFullYear().toString(),
              // no custom UA
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
          if (response.status === 429) {
            this.logger?.warn('YouTube subtitles rate-limited (429). Falling back to DOM subtitles.', {
              component: ComponentType.CONTENT_SCRIPT,
            });
            try {
              // Fallback: rely on DualSubtitleComponent DOM observation path only
              // Build a minimal empty track to keep the manager running
              return {
                id: `track_${track.languageCode}_${Date.now()}`,
                language: track.languageCode || 'unknown',
                label: track.name?.simpleText || track.languageCode || 'Unknown',
                kind: 'subtitles',
                isDefault: false,
                isAutoGenerated: track.kind === 'asr',
                cues: [],
                source: 'youtube',
              };
            } catch {}
          }
          this.logger?.error('Failed to fetch subtitles', {
            component: ComponentType.CONTENT_SCRIPT,
            metadata: { status: response.status, statusText: response.statusText },
          });
          return null;
        }

        let textJson: any = {};
        try {
          textJson = await response.json();
        } catch {}
        let nativeJson: any = {};
        try {
          nativeJson = await nativeResponse.json();
        } catch {}
        const textElements: any[] = textJson?.events ?? [];
        const nativeTextElements: any[] = nativeJson?.events ?? [];
        const cues: any[] = [];
        const groups: Array<{ startTime: number; endTime: number; text: string }> = [];
        this.logger?.info('Found text elements', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: { textElementsCount: textElements.length },
        });

        // Process subtitle cues with improved handling for auto-generated subtitles
        const isAutoGenerated = track.kind === 'asr';
        let cueIndex = 0;

        textElements.forEach((element, eventIndex) => {
          const start = element.tStartMs;
          const dur = element.dDurationMs;
          const segments = element?.segs || [];
          
          // Find corresponding native text segments
          const nativeElement = nativeTrack.baseUrl === track.baseUrl 
            ? null 
            : nativeTextElements.find((e) => e.tStartMs === start);
          const nativeSegments = nativeElement?.segs || [];

          {
                                     // For non-auto-generated subtitles, combine all segments into one cue
            const text = segments
              .map((seg: { utf8: string; tOffsetMs?: number }) => seg.utf8)
              .join('');
            
            const nativeText = nativeSegments
              .map((seg: { utf8: string; tOffsetMs?: number }) => seg.utf8)
              .join('');

            if (text) {
              cues.push({
                id: `cue_${cueIndex++}`,
                startTime: start / 1000,
                endTime: (start + dur) / 1000,
                text: text,
                nativeText: nativeText,
                language: track.languageCode || 'unknown',
                confidence: isAutoGenerated ? 0.85 : 1.0,
                // CRITICAL: include YouTube's per-segment timing so UI can highlight words
                segments: segments.map((s: any) => ({
                  utf8: s?.utf8 || '',
                  tOffsetMs: typeof s?.tOffsetMs === 'number' ? s.tOffsetMs : undefined,
                })),
                nativeSegments: nativeSegments.map((s: any) => ({
                  utf8: s?.utf8 || '',
                  tOffsetMs: typeof s?.tOffsetMs === 'number' ? s.tOffsetMs : undefined,
                })),
              });
              groups.push({
                startTime: start / 1000,
                endTime: (start + dur) / 1000,
                text: text.replace(/\n+/g, '\n').trim(),
              });
            }
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
          groups: groups,
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
          // Respect enable param on navigation
          const params = new URLSearchParams(window.location.search);
          const enabledParam = params.get('lt') ?? params.get('linguatube') ?? params.get('lingua');
          const shouldEnable = enabledParam === '1' || enabledParam === 'true' || enabledParam === 'on';
          if (shouldEnable) {
            this.handleVideoChange(newVideoId);
          } else {
            this.logger?.info('LinguaTube disabled on navigated video (missing ?lt=1). Clearing track.', {
              component: ComponentType.CONTENT_SCRIPT,
            });
            if (this.state.components.playerService) {
              this.state.components.playerService.clearSubtitleTrack();
            }
          }
        }
        currentUrl = window.location.href;
      }
    };

    // Check for navigation changes every 2 seconds
    setInterval(checkForNavigation, 2000);
  }

  private setupVocabularyModeBridge(): void {
    // Create communication bridge between Enhanced Playback Controls and DualSubtitleComponent
    if (!this.state.components.playbackControls || !this.state.components.subtitleManager) {
      this.logger?.warn('Cannot setup vocabulary mode bridge - components not available', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          hasPlaybackControls: !!this.state.components.playbackControls,
          hasSubtitleManager: !!this.state.components.subtitleManager,
        },
      });
      return;
    }

    const subtitleComponent = this.state.components.subtitleManager.getSubtitleComponent();
    if (!subtitleComponent) {
      this.logger?.warn('Cannot setup vocabulary mode bridge - subtitle component not available', {
        component: ComponentType.CONTENT_SCRIPT,
      });
      return;
    }

    // Set the DualSubtitleManager reference in Enhanced Playback Controls for subtitle toggle functionality
    this.state.components.playbackControls.setDualSubtitleManager(this.state.components.subtitleManager);

    // Listen for vocabulary mode events from Enhanced Playback Controls
    this.state.components.playbackControls.addEventListener((event) => {
      if (event.type === 'vocabulary_mode') {
        const isEnabled = Boolean(event.value);
        
        this.logger?.debug('Vocabulary mode event received - updating subtitle component', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: {
            enabled: isEnabled,
            timestamp: event.timestamp,
          },
        });

        // Update DualSubtitleComponent vocabulary mode
        subtitleComponent.setVocabularyMode(isEnabled);
      }
    });

    this.logger?.debug('Vocabulary mode communication bridge established', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'vocabulary_bridge_ready',
    });

    // Initial sync: push current controls state to subtitle component so UI and behavior match
    try {
      const current = this.state.components.playbackControls.getState();
      subtitleComponent.setVocabularyMode(!!current.vocabularyModeActive);
      this.logger?.debug('Vocabulary mode initial sync applied', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: { vocabularyModeActive: current.vocabularyModeActive },
      });
    } catch {}
  }

  private setupVocabularyListBridge(): void {
    // Create communication bridge between Enhanced Playback Controls and VocabularyListManager
    if (!this.state.components.playbackControls || !this.state.components.vocabularyListManager) {
      this.logger?.warn('Cannot setup vocabulary list bridge - components not available', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          hasPlaybackControls: !!this.state.components.playbackControls,
          hasVocabularyListManager: !!this.state.components.vocabularyListManager,
        },
      });
      return;
    }

    // Create a container for the vocabulary list positioned relative to the playback controls
    this.createVocabularyListContainer();

    // Set up custom word selection handler for subtitle navigation
    this.setupVocabularyWordNavigation();

    // Listen for vocabulary list events from Enhanced Playback Controls
    this.state.components.playbackControls.addEventListener((event) => {
      if (event.type === 'vocabulary_list') {
        const isVisible = Boolean(event.value);
        
        this.logger?.debug('Vocabulary list event received - updating visibility', {
          component: ComponentType.CONTENT_SCRIPT,
          metadata: {
            visible: isVisible,
            timestamp: event.timestamp,
          },
        });

        // Show or hide the vocabulary list
        if (isVisible) {
          this.showVocabularyList();
        } else {
          this.hideVocabularyList();
        }
      }
    });

    this.logger?.debug('Vocabulary list communication bridge established', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'vocabulary_list_bridge_ready',
    });

    // Initial sync: apply current controls visibility to the manager
    try {
      const current = this.state.components.playbackControls.getState();
      if (current.vocabularyListVisible) {
        this.showVocabularyList();
      } else {
        this.hideVocabularyList();
      }
      this.logger?.debug('Vocabulary list initial sync applied', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: { vocabularyListVisible: current.vocabularyListVisible },
      });
    } catch {}
  }

  private vocabularyListContainer: HTMLElement | null = null;

  private createVocabularyListContainer(): void {
    // Create container for vocabulary list with responsive positioning
    this.vocabularyListContainer = document.createElement('div');
    this.vocabularyListContainer.id = 'linguatube-vocabulary-list-container';
    
    // Apply initial responsive styling
    this.applyResponsiveVocabularyListStyling();
    
    // Add media query listener for responsive updates
    this.setupVocabularyListResponsiveListeners();

    document.body.appendChild(this.vocabularyListContainer);

    this.logger?.debug('Responsive vocabulary list container created', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'vocabulary_list_container_created',
      metadata: {
        initialScreenWidth: window.innerWidth,
        initialScreenHeight: window.innerHeight,
      },
    });
  }

  private applyResponsiveVocabularyListStyling(): void {
    if (!this.vocabularyListContainer) return;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const isSmallScreen = screenWidth < 1024;
    const isVerySmallScreen = screenWidth < 768;
    const isLandscape = screenWidth > screenHeight;

    // Determine responsive dimensions and positioning
    let width: string;
    let maxHeight: string;
    let position: { [key: string]: string };

    if (isVerySmallScreen) {
      // Mobile: Use bottom overlay
      width = 'calc(100vw - 20px)';
      maxHeight = '50vh';
      position = {
        position: 'fixed',
        bottom: '80px',
        left: '10px',
        right: '10px',
        top: 'auto',
        transform: 'none',
      };
    } else if (isSmallScreen) {
      // Small screens: Use narrower sidebar
      width = '320px';
      maxHeight = '70vh';
      position = {
        position: 'fixed',
        top: '50%',
        right: '10px',
        transform: 'translateY(-50%)',
      };
    } else {
      // Large screens: Use full sidebar
      width = '400px';
      maxHeight = '80vh';
      position = {
        position: 'fixed',
        top: '50%',
        right: '20px',
        transform: 'translateY(-50%)',
      };
    }

    // Apply styles with responsive calculations without touching visibility/opacity
    this.vocabularyListContainer.style.cssText = `
      ${Object.entries(position).map(([key, value]) => `${key}: ${value}`).join('; ')};
      width: ${width};
      max-height: ${maxHeight};
      z-index: 2147483647;
      box-sizing: border-box;
    `;

    // Ensure it remains visible/interactive across resizes
    this.vocabularyListContainer.style.opacity = '1';
    this.vocabularyListContainer.style.visibility = 'visible';
    this.vocabularyListContainer.style.pointerEvents = 'auto';
    this.vocabularyListContainer.style.removeProperty('transition');

    this.logger?.debug('Applied responsive vocabulary list styling', {
      component: ComponentType.CONTENT_SCRIPT,
      metadata: {
        screenWidth,
        screenHeight,
        isSmallScreen,
        isVerySmallScreen,
        isLandscape,
        appliedWidth: width,
        appliedMaxHeight: maxHeight,
      },
    });
  }

  private vocabularyListResizeHandler: (() => void) | null = null;
  private vocabularyListFullscreenHandler: (() => void) | null = null;

  private setupVocabularyListResponsiveListeners(): void {
    // Debounced resize handler
    let resizeTimeout: number;
    this.vocabularyListResizeHandler = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = window.setTimeout(() => {
        this.applyResponsiveVocabularyListStyling();
        this.adjustVocabularyListForPlayerMode();
      }, 250);
    };

    // Fullscreen change handler
    this.vocabularyListFullscreenHandler = () => {
      // Small delay to allow DOM to update
      setTimeout(() => {
        this.adjustVocabularyListForPlayerMode();
      }, 100);
    };

    // Add event listeners
    window.addEventListener('resize', this.vocabularyListResizeHandler);
    document.addEventListener('fullscreenchange', this.vocabularyListFullscreenHandler);
    document.addEventListener('webkitfullscreenchange', this.vocabularyListFullscreenHandler);
    document.addEventListener('mozfullscreenchange', this.vocabularyListFullscreenHandler);

    this.logger?.debug('Vocabulary list responsive listeners setup complete', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'responsive_listeners_ready',
    });
  }

  private adjustVocabularyListForPlayerMode(): void {
    if (!this.vocabularyListContainer) return;

    // Detect YouTube player modes
    const isFullscreen = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement
    );
    
    const theaterModeElement = document.querySelector('#player-theater-container, .ytp-size-large');
    const isTheaterMode = !!theaterModeElement;
    
    // Apply mode-specific adjustments
    if (isFullscreen) {
      // Fullscreen mode: Position relative to fullscreen container
      this.vocabularyListContainer.style.position = 'fixed';
      this.vocabularyListContainer.style.top = '50%';
      this.vocabularyListContainer.style.right = '20px';
      this.vocabularyListContainer.style.transform = 'translateY(-50%)';
      this.vocabularyListContainer.style.maxHeight = '90vh';
      this.vocabularyListContainer.style.width = '380px';
    } else if (isTheaterMode) {
      // Theater mode: Adjust for wider player
      this.vocabularyListContainer.style.position = 'fixed';
      this.vocabularyListContainer.style.top = '50%';
      this.vocabularyListContainer.style.right = '15px';
      this.vocabularyListContainer.style.transform = 'translateY(-50%)';
      this.vocabularyListContainer.style.maxHeight = '75vh';
    } else {
      // Normal mode: Reapply responsive styling
      this.applyResponsiveVocabularyListStyling();
    }

    this.logger?.debug('Adjusted vocabulary list for player mode', {
      component: ComponentType.CONTENT_SCRIPT,
      metadata: {
        isFullscreen,
        isTheaterMode,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
      },
    });
  }

  private async showVocabularyList(): Promise<void> {
    if (!this.vocabularyListContainer || !this.state.components.vocabularyListManager) {
      return;
    }

    try {
      // Show the vocabulary list using the manager
      await this.state.components.vocabularyListManager.show(this.vocabularyListContainer);

      // Ensure container is visible and not overridden by stale styles
      this.vocabularyListContainer.style.opacity = '1';
      this.vocabularyListContainer.style.visibility = 'visible';
      this.vocabularyListContainer.style.pointerEvents = 'auto';
      this.vocabularyListContainer.style.removeProperty('transition');

      this.logger?.debug('Vocabulary list shown', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'vocabulary_list_shown',
      });
    } catch (error) {
      this.logger?.error('Failed to show vocabulary list', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private hideVocabularyList(): void {
    if (!this.vocabularyListContainer || !this.state.components.vocabularyListManager) {
      return;
    }

    try {
      // Hide the vocabulary list using the manager
      this.state.components.vocabularyListManager.hide();

      // Keep container visible and interactive; content manager controls UI
      this.vocabularyListContainer.style.opacity = '1';
      this.vocabularyListContainer.style.visibility = 'visible';
      this.vocabularyListContainer.style.pointerEvents = 'auto';

      this.logger?.debug('Vocabulary list hidden', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'vocabulary_list_hidden',
      });
    } catch (error) {
      this.logger?.error('Failed to hide vocabulary list', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private setupVocabularyWordNavigation(): void {
    if (!this.state.components.vocabularyListManager || !this.state.components.playerService) {
      this.logger?.warn('Cannot setup vocabulary word navigation - components not available', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          hasVocabularyListManager: !!this.state.components.vocabularyListManager,
          hasPlayerService: !!this.state.components.playerService,
        },
      });
      return;
    }

    // Set up custom word selection handler for navigation
    this.state.components.vocabularyListManager.setWordSelectHandler((word) => {
      this.handleVocabularyWordSelect(word);
    });

    // Set up vocabulary change synchronization
    this.setupVocabularyChangeSynchronization();

    this.logger?.debug('Vocabulary word navigation setup complete', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'vocabulary_word_navigation_ready',
    });
  }

  private vocabularyChangeHandler: (() => void) | null = null;

  private setupVocabularyChangeSynchronization(): void {
    // Set up listener for vocabulary changes to keep the list synchronized
    this.vocabularyChangeHandler = () => {
      this.syncVocabularyListWithManager();
    };

    // Listen for vocabulary changes from the vocabulary observer
    try {
      const vocabularyObserver = (window as any).linguaTubeVocabularyObserver;
      if (vocabularyObserver && typeof vocabularyObserver.addListener === 'function') {
        vocabularyObserver.addListener(this.vocabularyChangeHandler);
        
        this.logger?.debug('Vocabulary change synchronization setup complete', {
          component: ComponentType.CONTENT_SCRIPT,
          action: 'vocabulary_sync_ready',
        });
      } else {
        this.logger?.warn('Vocabulary observer not available for synchronization', {
          component: ComponentType.CONTENT_SCRIPT,
        });
      }
    } catch (error) {
      this.logger?.error('Failed to setup vocabulary change synchronization', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async syncVocabularyListWithManager(): Promise<void> {
    // Refresh the vocabulary list when vocabulary data changes
    if (!this.state.components.vocabularyListManager || !this.vocabularyListContainer) {
      return;
    }

    try {
      // Only refresh if the vocabulary list is currently visible
      if (this.vocabularyListContainer.style.opacity === '1') {
        const activeComponent = (this.state.components.vocabularyListManager as any).state?.activeComponent;
        if (activeComponent && typeof activeComponent.refresh === 'function') {
          await activeComponent.refresh();
          
          this.logger?.debug('Vocabulary list refreshed due to vocabulary changes', {
            component: ComponentType.CONTENT_SCRIPT,
            action: 'vocabulary_list_synchronized',
          });
        }
      }
    } catch (error) {
      this.logger?.error('Failed to synchronize vocabulary list with manager', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private handleVocabularyWordSelect(word: VocabularyItem): void {
    if (!this.state.components.playerService) {
      this.logger?.warn('Cannot navigate to word - player service not available', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: { word: word.word },
      });
      return;
    }

    this.logger?.info('Vocabulary word selected - seeking to timestamp', {
      component: ComponentType.CONTENT_SCRIPT,
      metadata: {
        word: word.word,
        timestamp: word.timestamp,
        videoId: word.videoId,
        context: word.context,
      },
    });

    try {
      const currentVideoId = this.extractVideoId(window.location.href);
      // If the word belongs to a different video, navigate there first
      if (word.videoId && currentVideoId !== word.videoId) {
        const params = new URLSearchParams(window.location.search);
        params.set('v', word.videoId);
        // Navigate directly to saved timestamp in seconds
        if (typeof word.timestamp === 'number' && !isNaN(word.timestamp)) {
          const seconds = Math.max(0, Math.floor(word.timestamp));
          params.set('t', seconds.toString());
        }
        const newUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        window.location.assign(newUrl);
        return; // Further actions will happen after navigation
      }

      // Same video: seek directly to the saved timestamp (seconds)
      if (typeof word.timestamp === 'number' && !isNaN(word.timestamp)) {
        const seconds = Math.max(0, Math.floor(word.timestamp));
        this.state.components.playerService.seek(seconds);
      }

      // Show visual feedback
      this.showWordNavigationFeedback(word);
    } catch (error) {
      this.logger?.error('Failed to seek to vocabulary word timestamp', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          word: word.word,
          timestamp: word.timestamp,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private showWordNavigationFeedback(word: VocabularyItem): void {
    // Create a temporary feedback element to show which word was navigated to
    const feedback = document.createElement('div');
    feedback.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
    `;

    const minutes = Math.floor(word.timestamp / 60);
    const seconds = Math.floor(word.timestamp % 60);
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    feedback.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span>📍</span>
        <span>Navigated to "<strong>${word.word}</strong>" at ${timeStr}</span>
      </div>
    `;

    document.body.appendChild(feedback);

    // Animate in
    requestAnimationFrame(() => {
      feedback.style.opacity = '1';
    });

    // Remove after 3 seconds
    setTimeout(() => {
      feedback.style.opacity = '0';
      setTimeout(() => {
        if (feedback.parentNode) {
          feedback.parentNode.removeChild(feedback);
        }
      }, 200);
    }, 3000);

    this.logger?.debug('Word navigation feedback shown', {
      component: ComponentType.CONTENT_SCRIPT,
      metadata: { word: word.word, timestamp: word.timestamp },
    });
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

  private vocabularyListWasVisibleBeforeVideoChange: boolean = false;

  private handleVideoChange(newVideoId: string | null): void {
    this.state.currentVideoId = newVideoId;
    this.logger?.info('Video changed', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'video_change',
      metadata: { newVideoId },
    });

    // Handle vocabulary list state during video transitions
    this.handleVocabularyListStateOnVideoChange();

    // Notify components about video change if they support it
    // Note: This is simplified - in a full implementation,
    // components would have standardized video change handlers
  }

  private handleVocabularyListStateOnVideoChange(): void {
    if (!this.vocabularyListContainer || !this.state.components.vocabularyListManager) {
      return;
    }

    // Remember if vocabulary list was visible before video change
    this.vocabularyListWasVisibleBeforeVideoChange = 
      this.vocabularyListContainer.style.opacity === '1';

    // Temporarily hide vocabulary list during video transition
    if (this.vocabularyListWasVisibleBeforeVideoChange) {
      this.hideVocabularyList();

      this.logger?.debug('Vocabulary list hidden during video change', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          wasVisible: this.vocabularyListWasVisibleBeforeVideoChange,
          newVideoId: this.state.currentVideoId,
        },
      });

      // Set up restoration after video loads
      this.scheduleVocabularyListRestoration();
    }
  }

  private vocabularyListRestorationTimeout: number | null = null;

  private scheduleVocabularyListRestoration(): void {
    // Clear any existing restoration timeout
    if (this.vocabularyListRestorationTimeout) {
      clearTimeout(this.vocabularyListRestorationTimeout);
    }

    // Schedule restoration after video loading completes (with enhanced state)
    this.vocabularyListRestorationTimeout = window.setTimeout(() => {
      this.attemptVocabularyListRestoration();
    }, 2000); // Wait 2 seconds for video to load

    this.logger?.debug('Vocabulary list restoration scheduled', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'vocabulary_restoration_scheduled',
    });
  }

  private async attemptVocabularyListRestoration(): Promise<void> {
    // Only restore if it was visible before the video change and toggle is still active
    if (!this.vocabularyListWasVisibleBeforeVideoChange || 
        !this.state.components.playbackControls) {
      return;
    }

    try {
      // Check if vocabulary list toggle is still active in playback controls
      const controlsState = this.state.components.playbackControls.getState();
      if (controlsState.vocabularyListVisible) {
        await this.showVocabularyList();
        
        this.logger?.debug('Vocabulary list restored after video change', {
          component: ComponentType.CONTENT_SCRIPT,
          action: 'vocabulary_restoration_completed',
          metadata: {
            newVideoId: this.state.currentVideoId,
          },
        });
      }
    } catch (error) {
      this.logger?.error('Failed to restore vocabulary list after video change', {
        component: ComponentType.CONTENT_SCRIPT,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          newVideoId: this.state.currentVideoId,
        },
      });
    }

    // Reset the flag
    this.vocabularyListWasVisibleBeforeVideoChange = false;
    this.vocabularyListRestorationTimeout = null;
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

    // Clean up vocabulary list container
    if (this.vocabularyListContainer && this.vocabularyListContainer.parentNode) {
      this.vocabularyListContainer.parentNode.removeChild(this.vocabularyListContainer);
      this.vocabularyListContainer = null;
    }

    // Clean up vocabulary list responsive listeners
    if (this.vocabularyListResizeHandler) {
      window.removeEventListener('resize', this.vocabularyListResizeHandler);
      this.vocabularyListResizeHandler = null;
    }

    if (this.vocabularyListFullscreenHandler) {
      document.removeEventListener('fullscreenchange', this.vocabularyListFullscreenHandler);
      document.removeEventListener('webkitfullscreenchange', this.vocabularyListFullscreenHandler);
      document.removeEventListener('mozfullscreenchange', this.vocabularyListFullscreenHandler);
      this.vocabularyListFullscreenHandler = null;
    }

    // Clean up vocabulary change synchronization
    if (this.vocabularyChangeHandler) {
      try {
        const vocabularyObserver = (window as any).linguaTubeVocabularyObserver;
        if (vocabularyObserver && typeof vocabularyObserver.removeListener === 'function') {
          vocabularyObserver.removeListener(this.vocabularyChangeHandler);
        }
      } catch (error) {
        this.logger?.warn('Error cleaning up vocabulary change handler', {
          component: ComponentType.CONTENT_SCRIPT,
        });
      }
      this.vocabularyChangeHandler = null;
    }

    // Clean up vocabulary list restoration timeout
    if (this.vocabularyListRestorationTimeout) {
      clearTimeout(this.vocabularyListRestorationTimeout);
      this.vocabularyListRestorationTimeout = null;
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
