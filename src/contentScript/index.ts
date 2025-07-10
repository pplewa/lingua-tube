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
import { storageService } from '../storage';
import { TranslationApiService } from '../translation/TranslationApiService';
import { ConfigService } from '../translation/ConfigService';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';

// ========================================
// Content Script State
// ========================================

interface ContentScriptState {
  isInitialized: boolean;
  currentVideoId: string | null;
  components: {
    subtitleManager: DualSubtitleManager | null;
    vocabularyManager: VocabularyManager | null;
    vocabularyListManager: VocabularyListManager | null;
    playbackControls: EnhancedPlaybackControlsComponent | null;
    playerService: PlayerInteractionService | null;
    translationService: TranslationApiService | null;
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
        translationService: null
      }
    };

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
    try {
      if (this.state.isInitialized) {
        this.logger.warn('Content script already initialized');
        return true;
      }

      this.initializationAttempts++;
      this.logger.info('Starting LinguaTube initialization', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize',
        metadata: { attempt: this.initializationAttempts }
      });

      // Wait for YouTube player to be available
      const playerReady = await this.waitForYouTubePlayer();
      if (!playerReady) {
        throw new Error('YouTube player not available');
      }

      // Initialize core services
      await this.initializeCoreServices();

      // Initialize UI components
      await this.initializeUIComponents();

      // Setup basic event listeners
      this.setupBasicEventListeners();

      this.state.isInitialized = true;
      this.logger.info('LinguaTube initialization completed successfully', {
        component: ComponentType.CONTENT_SCRIPT,
        action: 'initialize_complete',
        metadata: { attempts: this.initializationAttempts }
      });

      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
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

    // Initialize dual subtitle manager
    this.state.components.subtitleManager = new DualSubtitleManager(
      this.state.components.playerService,
      storageService,
      this.state.components.translationService || new TranslationApiService()
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

    // Listen for page navigation changes
    this.setupNavigationListener();
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

    while (attempts < maxAttempts) {
      const videoElement = document.querySelector('video') as HTMLVideoElement;
      if (videoElement && videoElement.readyState >= 1) {
        this.logger.debug('YouTube player detected', {
          component: ComponentType.CONTENT_SCRIPT,
          action: 'player_detected',
          metadata: { attempts: attempts + 1 }
        });
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

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

let contentScript: LinguaTubeContentScript | null = null;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
}

async function initializeContentScript(): Promise<void> {
  try {
    // Only initialize on YouTube video pages
    if (!window.location.href.includes('youtube.com/watch')) {
      return;
    }

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
