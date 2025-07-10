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

console.log('[LinguaTube] All imports loaded successfully');

// ========================================
// Content Script State
// ========================================

interface ContentScriptState {
  isInitialized: boolean;
  currentVideoId: string | null;
  captionObserverCleanup?: () => void;
  currentDOMTrack?: any;
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
  private logger: Logger;
  private state: ContentScriptState;
  private isDestroyed = false;
  private retryTimeout: number | null = null;
  private initializationAttempts = 0;

  constructor() {
    console.log('[LinguaTube] Creating LinguaTubeContentScript instance');
    this.logger = Logger.getInstance();
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
        ttsService: null
      }
    };

    console.log('[LinguaTube] LinguaTubeContentScript constructor completed');
    this.logger.info('LinguaTube Content Script starting', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'constructor',
      metadata: {
        url: window.location.href,
        timestamp: Date.now()
      }
    });
  }

  // ========================================
  // Main Initialization
  // ========================================

  public async initialize(): Promise<boolean> {
    console.log('[LinguaTube] Starting initialization...');
    try {
      if (this.state.isInitialized) {
        console.log('[LinguaTube] Already initialized, skipping');
        this.logger.warn('Content script already initialized');
        return true;
      }

      this.initializationAttempts++;
      console.log('[LinguaTube] Initialization attempt:', this.initializationAttempts);
      this.logger.info('Starting LinguaTube initialization', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize',
        metadata: { attempt: this.initializationAttempts }
      });

      // Wait for YouTube player to be available
      console.log('[LinguaTube] Waiting for YouTube player...');
      const playerReady = await this.waitForYouTubePlayer();
      if (!playerReady) {
        console.error('[LinguaTube] YouTube player not available');
        throw new Error('YouTube player not available');
      }
      console.log('[LinguaTube] YouTube player ready');

      // Initialize core services
      console.log('[LinguaTube] Initializing core services...');
      await this.initializeCoreServices();
      console.log('[LinguaTube] Core services initialized');

      // Initialize UI components
      console.log('[LinguaTube] Initializing UI components...');
      await this.initializeUIComponents();
      console.log('[LinguaTube] UI components initialized');

      // Setup basic event listeners
      console.log('[LinguaTube] Setting up event listeners...');
      this.setupBasicEventListeners();
      console.log('[LinguaTube] Event listeners set up');

      this.state.isInitialized = true;
      console.log('[LinguaTube] ✅ Initialization completed successfully!');
      this.logger.info('LinguaTube initialization completed successfully', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize_complete',
        metadata: { attempts: this.initializationAttempts }
      });

      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[LinguaTube] ❌ Initialization failed:', errorMessage);
      this.logger.error('LinguaTube initialization failed', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize_error',
        metadata: {
          attempt: this.initializationAttempts,
          error: errorMessage
        }
      });

      // Simple retry logic
      if (this.initializationAttempts < 3 && !this.isDestroyed) {
        console.log('[LinguaTube] Scheduling retry in', 2000 * this.initializationAttempts, 'ms');
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
    this.logger.debug('Storage service initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'storage_ready'
    });

    // Initialize player interaction service
    this.state.components.playerService = PlayerInteractionService.getInstance();
    await this.state.components.playerService.initialize();
    this.logger.debug('Player service initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'player_ready'
    });

    // Initialize vocabulary manager
    this.state.components.vocabularyManager = VocabularyManager.getInstance();
    this.logger.debug('Vocabulary manager initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'vocabulary_ready'
    });

    // Initialize translation service if configured
    const configService = new ConfigService();
    const isConfigured = await configService.isConfigured();
    if (isConfigured) {
      this.state.components.translationService = new TranslationApiService();
      this.logger.debug('Translation service initialized', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'translation_ready'
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
      storageService
    );

    // Initialize dual subtitle manager with word lookup popup
    this.state.components.subtitleManager = new DualSubtitleManager(
      this.state.components.playerService,
      storageService,
      this.state.components.translationService || new TranslationApiService(),
      this.state.components.wordLookupPopup
    );
    await this.state.components.subtitleManager.initialize();
    this.logger.debug('Subtitle manager initialized', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'subtitle_manager_ready'
    });

    // Initialize vocabulary list manager
    try {
      this.state.components.vocabularyListManager = VocabularyListManager.getInstance();
      await this.state.components.vocabularyListManager.initialize();
      this.logger.debug('Vocabulary list manager initialized', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'vocabulary_list_ready'
      });
    } catch (error) {
      this.logger.warn('Vocabulary list manager initialization failed - continuing without it', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'vocabulary_list_warning'
      });
    }

    // Initialize enhanced playback controls
    try {
      this.state.components.playbackControls = new EnhancedPlaybackControlsComponent(
        this.state.components.playerService,
        storageService
      );
      await this.state.components.playbackControls.initialize();
      this.logger.debug('Enhanced playback controls initialized', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'playback_controls_ready'
      });
    } catch (error) {
      this.logger.warn('Enhanced playback controls initialization failed - continuing without them', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'playback_controls_warning'
      });
    }
  }

  // ========================================
  // Event Listeners Setup
  // ========================================

  private setupBasicEventListeners(): void {
    // Start subtitle discovery monitoring
    subtitleDiscoveryService.startMonitoring();
    this.logger.debug('Subtitle discovery monitoring started', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'subtitle_discovery_started'
    });

    // Listen for subtitle discovery events
    this.setupSubtitleDiscoveryEventListeners();

    // Listen for page navigation changes
    this.setupNavigationListener();
  }

  private setupSubtitleDiscoveryEventListeners(): void {
    // Listen for when subtitles are discovered
    subtitleDiscoveryService.addEventListener(SubtitleDiscoveryEvent.TRACKS_DISCOVERED, async (event: any) => {
      console.log('[LinguaTube] Subtitles discovered, loading into player service...', event);
      
      if (!this.state.components.playerService) {
        console.warn('[LinguaTube] Player service not available for subtitle loading');
        return;
      }

      // Get the tracks from the event data property
      const tracks = event.data?.tracks || event.tracks || [];
      console.log('[LinguaTube] Available tracks:', tracks);
      
      // Enhanced debugging for language detection
      console.log(`[LinguaTube] 🔍 Subtitle Track Language Analysis:`);
      tracks.forEach((track: any, index: number) => {
        console.log(`[LinguaTube] Track ${index}:`, {
          languageCode: track.languageCode,
          languageName: track.languageName,
          name: track.name,
          isAutoGenerated: track.isAutoGenerated,
          vssId: track.vssId
        });
      });
      
      if (tracks.length === 0) {
        console.log('[LinguaTube] No tracks available in event data');
        return;
      }

      // Get the first available subtitle track (prioritize human-created over auto-generated)
      const preferredTrack = tracks.find((track: any) => !track.isAutoGenerated) || tracks[0];
      console.log('[LinguaTube] Selected track:', preferredTrack);
      
      if (preferredTrack) {
        try {
          // Update language settings based on selected subtitle track
          await this.updateLanguageSettings(preferredTrack.languageCode);
          
          // Skip API fetch - directly start DOM-based subtitle observation
          console.log(`[LinguaTube] Starting DOM-based subtitle observation for: ${preferredTrack.languageCode}`);
          this.startDOMSubtitleObservation(preferredTrack);
        } catch (error) {
          console.error('[LinguaTube] Failed to start subtitle observation:', error);
        }
      } else {
        console.log('[LinguaTube] No suitable subtitle tracks found');
      }
    });

    // Listen for video changes to clear old subtitles
    subtitleDiscoveryService.addEventListener(SubtitleDiscoveryEvent.VIDEO_CHANGED, () => {
      console.log('[LinguaTube] Video changed, clearing subtitle track');
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
      console.log(`[LinguaTube] Updating language settings for subtitle language: ${subtitleLanguageCode}`);
      
      // Get current settings
      const settingsResult = await storageService.getSettings();
      if (!settingsResult.success || !settingsResult.data) {
        console.warn('[LinguaTube] Could not load current settings for language update');
        return;
      }

      const currentSettings = settingsResult.data;
      
      // Use 'auto' for source language to let translation API handle detection
      const updatedSettings = {
        ...currentSettings,
        languages: {
          ...currentSettings.languages,
          sourceLanguage: 'auto' // Let translation API auto-detect the language
        }
      };

      // Save the updated settings
      const saveResult = await storageService.saveSettings(updatedSettings);
      if (saveResult.success) {
        console.log(`[LinguaTube] ✅ Set source language to 'auto' for automatic detection`);
        
        // Propagate the language change to the subtitle manager if it exists
        if (this.state.components.subtitleManager) {
          this.state.components.subtitleManager.setLanguages(
            'auto',
            currentSettings.languages.nativeLanguage
          );
          console.log('[LinguaTube] Updated DualSubtitleManager with auto language detection');
        }
      } else {
        console.error('[LinguaTube] Failed to save language settings:', saveResult.error);
      }
    } catch (error) {
      console.error('[LinguaTube] Error updating language settings:', error);
    }
  }



  private async fetchSubtitleData(track: any): Promise<any> {
    try {
      console.log('[LinguaTube] Fetching subtitle data for track:', track);
      console.log('[LinguaTube] Track baseUrl:', track.baseUrl);
      
      // Parse as YouTube subtitle data if it has the right structure
      if (this.state.components.playerService && track.baseUrl) {
        console.log('[LinguaTube] Starting fetch from YouTube API...');
        
        // Fetch the subtitle content from YouTube
        const response = await fetch(track.baseUrl, {
          method: 'GET',
          mode: 'cors',
          credentials: 'omit',
          headers: {
            'Accept': 'application/xml, text/xml, */*',
            'User-Agent': 'Mozilla/5.0 (compatible; LinguaTube)'
          }
        });
        console.log('[LinguaTube] Fetch response status:', response.status, response.statusText);
        console.log('[LinguaTube] Response headers:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
          console.error('[LinguaTube] Failed to fetch subtitles:', response.status, response.statusText);
          return null;
        }
        
        const xmlText = await response.text();
        console.log('[LinguaTube] Received XML length:', xmlText.length);
        console.log('[LinguaTube] First 200 chars of XML:', xmlText.substring(0, 200));
        
        // If we got an empty response, YouTube is blocking us - try alternative approach
        if (xmlText.length === 0) {
          console.log('[LinguaTube] Empty response from YouTube API - trying alternative approach...');
          return await this.tryAlternativeSubtitleApproach(track);
        }
        
        // Parse XML subtitle format (YouTube uses TTML/XML format)
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        
        // Check for XML parsing errors
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) {
          console.error('[LinguaTube] XML parsing error:', parserError.textContent);
          return null;
        }
        
        const cues: any[] = [];
        
        // Extract subtitle cues from XML (try both 'text' and 'p' elements)
        const textElements = xmlDoc.querySelectorAll('text, p');
        console.log('[LinguaTube] Found', textElements.length, 'text elements');
        
        textElements.forEach((element, index) => {
          const start = parseFloat(element.getAttribute('start') || element.getAttribute('t') || '0');
          const dur = parseFloat(element.getAttribute('dur') || element.getAttribute('d') || '0');
          const text = element.textContent?.trim() || '';
          
          console.log(`[LinguaTube] Processing cue ${index}: start=${start}, dur=${dur}, text="${text.substring(0, 50)}..."`);
          
          if (text) {
            cues.push({
              id: `cue_${index}`,
              startTime: start,
              endTime: start + dur,
              text: text,
              language: track.languageCode || 'unknown',
              confidence: track.isAutoGenerated ? 0.85 : 1.0
            });
          }
        });

        console.log('[LinguaTube] Successfully parsed', cues.length, 'subtitle cues');

        // Create a subtitle track object
        const subtitleTrack = {
          id: `track_${track.languageCode}_${Date.now()}`,
          language: track.languageCode || 'unknown',
          label: track.name?.simpleText || track.languageCode || 'Unknown',
          kind: 'subtitles',
          isDefault: false,
          isAutoGenerated: track.kind === 'asr',
          cues: cues,
          source: 'youtube'
        };
        
        console.log('[LinguaTube] Created subtitle track:', subtitleTrack);
        return subtitleTrack;
      }
      
      console.log('[LinguaTube] No baseUrl available or player service not ready');
      return null;
    } catch (error) {
      console.error('[LinguaTube] Error fetching subtitle data:', error);
      return null;
    }
  }

  private startDOMSubtitleObservation(track: any): void {
    console.log('[LinguaTube] Setting up DOM-based subtitle observation...');
    
    if (!this.state.components.playerService) {
      console.error('[LinguaTube] Player service not available for DOM observation');
      return;
    }

    // Create and load initial empty track (once)
    this.state.currentDOMTrack = {
      id: `dom_track_${track.languageCode}_${Date.now()}`,
      language: track.languageCode || 'unknown',
      label: track.languageName || 'Unknown Language',
      kind: 'subtitles' as const,
      isDefault: false,
      isAutoGenerated: track.kind === 'asr',
      cues: [], // Start empty
      source: 'youtube' as const,
      originalTrack: track
    };

    // Load track once initially
    console.log('[LinguaTube] Loading initial DOM track...');
    this.state.components.playerService.loadSubtitleTrack(this.state.currentDOMTrack);

    // Start observing YouTube's caption elements with caption state detection
    this.setupYouTubeCaptionObserver();
  }

  private setupYouTubeCaptionObserver(): void {
    console.log('[LinguaTube] Setting up simplified YouTube caption observer...');

    if (!this.state.currentDOMTrack) {
      console.error('[LinguaTube] No DOM track available for population');
      return;
    }

    let lastCaptionText = '';
    let cueId = 0;

    const syncWithNativeCaptions = () => {
      try {
        // Check if YouTube captions are enabled
        const captionButton = document.querySelector('.ytp-subtitles-button') as HTMLElement;
        const isCaptionsEnabled = captionButton?.getAttribute('aria-pressed') === 'true';
        
        if (!isCaptionsEnabled) {
          // Clear overlay if captions are disabled
          if (lastCaptionText) {
            this.sendCaptionEvent('cue_end', lastCaptionText, cueId);
            lastCaptionText = '';
          }
          return;
        }

                 // Get current caption text directly from YouTube's caption window
         const captionWindow = document.querySelector('.caption-window');
         const currentCaptionText = captionWindow?.textContent?.trim() || '';
         
         // Also check if video is paused (captions should still show when paused)
         const videoElement = document.querySelector('video') as HTMLVideoElement;
         const isPaused = videoElement?.paused || false;

                 // Handle caption text changes
         if (currentCaptionText !== lastCaptionText) {
           console.log(`[LinguaTube] Caption sync: "${lastCaptionText}" → "${currentCaptionText}" (paused: ${isPaused})`);
           
           // Check if this is a true word-by-word extension (very strict)
           const isExtension = lastCaptionText && 
             currentCaptionText.length > lastCaptionText.length &&
             currentCaptionText.startsWith(lastCaptionText.trim()) &&
             (currentCaptionText.length - lastCaptionText.length) < 50; // Max 50 chars added
           
           // Detect if we have duplicate/accumulated text (error state)
           const hasDuplicates = currentCaptionText.length > 200 || 
             (currentCaptionText.match(/\./g) || []).length > 3;
           
           if (hasDuplicates) {
             console.log('[LinguaTube] Detected duplicate/accumulated text, clearing...');
             // Force clear and restart
             if (lastCaptionText) {
               this.sendCaptionEvent('cue_end', lastCaptionText, cueId);
             }
             lastCaptionText = '';
             return; // Skip this update to reset
           }
           
           if (isExtension) {
             // True word extension - update in-place without clearing (no flicker!)
             console.log('[LinguaTube] True extension detected, updating in-place...');
             this.sendCaptionEvent('cue_update', currentCaptionText, cueId);
           } else {
             // New sentence or different content
             console.log('[LinguaTube] New caption content...');
             
             // Clear previous caption if we had one
             if (lastCaptionText) {
               this.sendCaptionEvent('cue_end', lastCaptionText, cueId);
             }

             // Show new caption if we have one
             if (currentCaptionText) {
               this.sendCaptionEvent('cue_start', currentCaptionText, ++cueId);
             }
           }

           lastCaptionText = currentCaptionText;
         }
         
         // CRITICAL: Keep caption visible when paused
         // Only refresh if we just paused (not on every mutation when already paused)
         if (isPaused && lastCaptionText && currentCaptionText) {
           const videoElement = document.querySelector('video') as HTMLVideoElement;
           if (videoElement && !videoElement.dataset.linguaTubePausedHandled) {
             // Mark as handled to prevent spam
             videoElement.dataset.linguaTubePausedHandled = 'true';
             console.log('[LinguaTube] Video paused, ensuring caption stays visible...');
             this.sendCaptionEvent('cue_update', currentCaptionText, cueId);
           }
         } else if (!isPaused) {
           // Clear the pause flag when playing
           const videoElement = document.querySelector('video') as HTMLVideoElement;
           if (videoElement) {
             delete videoElement.dataset.linguaTubePausedHandled;
           }
         }
      } catch (error) {
        console.error('[LinguaTube] Error syncing captions:', error);
      }
    };

    // Watch for changes in the caption window only
    const captionObserver = new MutationObserver(() => {
      syncWithNativeCaptions();
    });

    // Find and observe the caption container
    const findAndObserveCaptionContainer = () => {
      const captionContainer = document.querySelector('.caption-window') || 
                              document.querySelector('.ytp-caption-window-container') ||
                              document.querySelector('#movie_player');
      
      if (captionContainer) {
        captionObserver.observe(captionContainer, {
          childList: true,
          subtree: true,
          characterData: true
        });
        console.log('[LinguaTube] Simplified caption observer started');
        
        // Initial sync
        syncWithNativeCaptions();
        return true;
      }
      return false;
    };

    // Try to find caption container immediately, or wait a bit
    if (!findAndObserveCaptionContainer()) {
      setTimeout(findAndObserveCaptionContainer, 1000);
    }

    // Also watch for caption button state changes
    const buttonObserver = new MutationObserver(() => {
      syncWithNativeCaptions();
    });

    const captionButton = document.querySelector('.ytp-subtitles-button');
    if (captionButton) {
      buttonObserver.observe(captionButton, {
        attributes: true,
        attributeFilter: ['aria-pressed']
      });
    }

    // Watch for play/pause state changes to ensure captions stay visible when paused
    const videoElement = document.querySelector('video') as HTMLVideoElement;
    const handlePauseStateChange = () => {
      setTimeout(() => {
        // Small delay to ensure state is updated
        syncWithNativeCaptions();
      }, 100);
    };

    if (videoElement) {
      videoElement.addEventListener('play', handlePauseStateChange);
      videoElement.addEventListener('pause', handlePauseStateChange);
    }

    // Store cleanup function
    this.state.captionObserverCleanup = () => {
      console.log('[LinguaTube] Cleaning up simplified caption observer...');
      captionObserver.disconnect();
      buttonObserver.disconnect();
      if (videoElement) {
        videoElement.removeEventListener('play', handlePauseStateChange);
        videoElement.removeEventListener('pause', handlePauseStateChange);
      }
    };
  }

  private sendCaptionEvent(type: 'cue_start' | 'cue_end' | 'cue_update', text: string, cueId: number): void {
    if (!this.state.components.playerService) return;

    const videoElement = document.querySelector('video') as HTMLVideoElement;
    const currentTime = videoElement?.currentTime || 0;

    const cue = {
      id: `dom_cue_${cueId}`,
      text: text,
      startTime: currentTime,
      endTime: currentTime + 5,
      language: this.state.currentDOMTrack?.language || 'unknown',
      confidence: 0.9
    };

    // Send the event as specified type
    const event = {
      type: type,
      cue,
      activeCues: (type === 'cue_start' || type === 'cue_update') ? [{
        ...cue,
        isActive: true,
        timeRemaining: 5,
        displayOrder: 0,
        adjustedStartTime: cue.startTime,
        adjustedEndTime: cue.endTime
      }] : [],
      timestamp: Date.now()
    };

    const playerService = this.state.components.playerService as any;
    if (playerService.subtitleSyncListeners) {
      playerService.subtitleSyncListeners.forEach((listener: any) => {
        try {
          listener(event);
        } catch (error) {
          console.error('[LinguaTube] Error sending caption event:', error);
        }
      });
    }
  }

  private async tryAlternativeSubtitleApproach(track: any): Promise<any> {
    console.log('[LinguaTube] Attempting alternative subtitle extraction...');
    
    try {
      // Alternative 1: Try to hook into YouTube's existing caption system
      const captionWindow = document.querySelector('.caption-window');
      if (captionWindow) {
        console.log('[LinguaTube] Found existing caption window, creating mock track...');
        
        // Create a basic track structure that will trigger subtitle sync
        const mockTrack = {
          id: `mock_track_${track.languageCode}_${Date.now()}`,
          language: track.languageCode || 'unknown',
          label: track.languageName || 'Unknown Language',
          kind: 'subtitles',
          isDefault: false,
          isAutoGenerated: track.kind === 'asr',
          cues: [], // Start with empty cues - will be populated by observing YouTube's captions
          source: 'youtube_dom',
          originalTrack: track
        };

        console.log('[LinguaTube] Created mock track for DOM observation:', mockTrack);
        return mockTrack;
      }

      // Alternative 2: If no captions visible, create a minimal track for sync purposes
      console.log('[LinguaTube] No caption window found, creating minimal sync track...');
      return {
        id: `sync_track_${track.languageCode}_${Date.now()}`,
        language: track.languageCode || 'unknown', 
        label: track.languageName || 'Unknown Language',
        kind: 'subtitles',
        isDefault: false,
        isAutoGenerated: track.kind === 'asr',
        cues: [],
        source: 'sync_fallback',
        originalTrack: track
      };

    } catch (error) {
      console.error('[LinguaTube] Alternative subtitle approach failed:', error);
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

    console.log('[LinguaTube] Waiting for YouTube video element...');

    while (attempts < maxAttempts) {
      const videoElement = document.querySelector('video') as HTMLVideoElement;
      console.log(`[LinguaTube] Attempt ${attempts + 1}: videoElement found:`, !!videoElement);
      
      if (videoElement) {
        console.log('[LinguaTube] Video element readyState:', videoElement.readyState);
        if (videoElement.readyState >= 1) {
          console.log('[LinguaTube] ✓ YouTube player ready!');
          this.logger.debug('YouTube player detected', {
            component: ComponentType.CONTENT_SCRIPT,
            action: 'player_detected',
            metadata: { attempts: attempts + 1 }
          });
          return true;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    console.error('[LinguaTube] ❌ YouTube player detection timeout after', maxAttempts, 'attempts');
    this.logger.error('YouTube player detection timeout', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'player_timeout',
      metadata: { maxAttempts }
    });
    return false;
  }

  private extractVideoId(url: string): string | null {
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  }

  private handleVideoChange(newVideoId: string | null): void {
    this.state.currentVideoId = newVideoId;
    this.logger.info('Video changed', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'video_change',
      metadata: { newVideoId }
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

    this.logger.info('Destroying LinguaTube content script', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'destroy'
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
      this.logger.warn('Error during component cleanup', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'cleanup_warning'
      });
    }

    // Stop subtitle discovery
    subtitleDiscoveryService.stopMonitoring();

    this.logger.info('LinguaTube content script destroyed', {
      component: ComponentType.CONTENT_SCRIPT,
      action: 'destroy_complete'
    });
  }
}

// ========================================
// Module Initialization
// ========================================

console.log('[LinguaTube] Module initialization starting...');
console.log('[LinguaTube] Document ready state:', document.readyState);

let contentScript: LinguaTubeContentScript | null = null;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  console.log('[LinguaTube] Document still loading, waiting for DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[LinguaTube] DOMContentLoaded event fired');
    initializeContentScript();
  });
} else {
  console.log('[LinguaTube] Document already ready, initializing immediately');
  initializeContentScript();
}

async function initializeContentScript(): Promise<void> {
  console.log('[LinguaTube] initializeContentScript called');
  console.log('[LinguaTube] Current URL:', window.location.href);
  
  try {
    // Only initialize on YouTube video pages
    if (!window.location.href.includes('youtube.com/watch')) {
      console.log('[LinguaTube] Not a YouTube video page, skipping initialization');
      console.log('[LinguaTube] Expected URL pattern: youtube.com/watch');
      return;
    }

    console.log('[LinguaTube] ✓ YouTube video page detected, proceeding with initialization');
    contentScript = new LinguaTubeContentScript();
    await contentScript.initialize();
  } catch (error) {
    console.error('[LinguaTube] Content script initialization failed:', error);
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
