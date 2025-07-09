/**
 * YouTube Subtitle Discovery Service
 * Main service for discovering and managing YouTube subtitle tracks
 */

import {
  SubtitleDiscoveryService,
  SubtitleDiscoveryResult,
  SubtitleTrack,
  SubtitleDiscoveryConfig,
  SubtitleDiscoveryEvent,
  SubtitleDiscoveryEventData,
  SubtitleDiscoveryError,
  SubtitleErrorCode,
  DEFAULT_DISCOVERY_CONFIG,
  LanguageInfo
} from './types';
import { YouTubePlayerResponseParser } from './PlayerResponseParser';
import { SubtitleTrackProcessor } from './SubtitleTrackProcessor';

/**
 * Main implementation of the subtitle discovery service
 */
export class LinguaTubeSubtitleDiscoveryService implements SubtitleDiscoveryService {
  private config: SubtitleDiscoveryConfig;
  private eventListeners: Map<SubtitleDiscoveryEvent, Array<(event: SubtitleDiscoveryEventData) => void>>;
  private isMonitoringActive = false;
  private currentVideoId: string | null = null;
  private currentTracks: SubtitleTrack[] = [];
  private observer: MutationObserver | null = null;

  constructor(config: Partial<SubtitleDiscoveryConfig> = {}) {
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
    this.eventListeners = new Map();
    this.initializeEventListeners();
  }

  // ========================================
  // Core Discovery Methods
  // ========================================

  async discoverSubtitles(): Promise<SubtitleDiscoveryResult> {
    try {
      console.log('[LinguaTube] Starting subtitle discovery...');

      // Verify we're on a valid video page
      if (!YouTubePlayerResponseParser.isValidVideoPage()) {
        const error: SubtitleDiscoveryError = {
          code: SubtitleErrorCode.INVALID_VIDEO_PAGE,
          message: 'Not on a valid YouTube video page',
          recoverable: false
        };
        return this.createErrorResult(error);
      }

             // Get video context
       const videoId = YouTubePlayerResponseParser.getCurrentVideoId();
       const videoTitle = YouTubePlayerResponseParser.getCurrentVideoTitle();

       // Wait for player response if needed
       const available = await YouTubePlayerResponseParser.waitForPlayerResponse(this.config.observerTimeout);
       if (!available) {
         const error: SubtitleDiscoveryError = {
           code: SubtitleErrorCode.PLAYER_NOT_LOADED,
           message: 'YouTube player not loaded within timeout',
           recoverable: true
         };
         return this.createErrorResult(error, videoId || undefined, videoTitle || undefined);
       }

      // Parse player response
      const parseResult = await YouTubePlayerResponseParser.parsePlayerResponse();
      if (!parseResult.success) {
        const error: SubtitleDiscoveryError = {
          code: SubtitleErrorCode.PLAYER_RESPONSE_MISSING,
          message: parseResult.error || 'Failed to parse player response',
          recoverable: true
        };
        return this.createErrorResult(error, videoId, videoTitle);
      }

      // Check if captions are available
      if (!parseResult.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        const error: SubtitleDiscoveryError = {
          code: SubtitleErrorCode.CAPTIONS_NOT_AVAILABLE,
          message: 'No subtitle tracks available for this video',
          recoverable: false
        };
        return this.createErrorResult(error, videoId, videoTitle);
      }

      // Process subtitle tracks
      const tracks = SubtitleTrackProcessor.processSubtitleTracks(parseResult.captions);
      const filteredTracks = this.applyConfigFilters(tracks);
      const languageInfo = SubtitleTrackProcessor.getLanguageInfo(filteredTracks);

      // Update internal state
      this.currentVideoId = videoId;
      this.currentTracks = filteredTracks;

      // Create successful result
      const result: SubtitleDiscoveryResult = {
        success: true,
        tracks: filteredTracks,
        availableLanguages: languageInfo,
        videoId: videoId || undefined,
        videoTitle: videoTitle || undefined,
        timestamp: Date.now()
      };

      // Emit event
      this.emitEvent(SubtitleDiscoveryEvent.TRACKS_DISCOVERED, result);

      console.log(`[LinguaTube] Successfully discovered ${filteredTracks.length} subtitle tracks`);
      return result;

    } catch (error) {
      console.error('[LinguaTube] Subtitle discovery failed:', error);
      const discoveryError: SubtitleDiscoveryError = {
        code: SubtitleErrorCode.UNKNOWN_ERROR,
        message: `Discovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        recoverable: true,
        details: { originalError: error }
      };
      return this.createErrorResult(discoveryError);
    }
  }

  async getAvailableSubtitleTracks(): Promise<SubtitleTrack[]> {
    if (this.currentTracks.length === 0) {
      const result = await this.discoverSubtitles();
      return result.success ? result.tracks : [];
    }
    return this.currentTracks;
  }

  async getSubtitleTrackByLanguage(languageCode: string): Promise<SubtitleTrack | null> {
    const tracks = await this.getAvailableSubtitleTracks();
    return tracks.find(track => track.languageCode === languageCode) || null;
  }

  async getPreferredSubtitleTrack(languageCodes: string[]): Promise<SubtitleTrack | null> {
    const tracks = await this.getAvailableSubtitleTracks();
    return SubtitleTrackProcessor.findBestTrack(tracks, languageCodes, true);
  }

  // ========================================
  // Track Analysis Methods
  // ========================================

  isAutoGenerated(track: SubtitleTrack): boolean {
    return track.isAutoGenerated;
  }

  isTranslatable(track: SubtitleTrack): boolean {
    return track.isTranslatable;
  }

  getTrackQuality(track: SubtitleTrack): 'high' | 'medium' | 'low' {
    // Manual captions are always high quality
    if (!track.isAutoGenerated) {
      return 'high';
    }

    // For auto-generated tracks, use confidence if available
    if (track.confidence !== undefined) {
      if (track.confidence >= 0.8) return 'high';
      if (track.confidence >= 0.7) return 'medium';
      return 'low';
    }

    // Fallback based on language support
    const commonLanguages = ['en', 'es', 'fr', 'de', 'ja', 'ko', 'zh'];
    return commonLanguages.includes(track.languageCode) ? 'medium' : 'low';
  }

  // ========================================
  // Page Monitoring Methods
  // ========================================

  startMonitoring(): void {
    if (this.isMonitoringActive) {
      console.log('[LinguaTube] Monitoring already active');
      return;
    }

    console.log('[LinguaTube] Starting subtitle discovery monitoring...');
    this.isMonitoringActive = true;

    // Set up mutation observer for page changes
    this.observer = new MutationObserver(this.handleMutations.bind(this));
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href']
    });

    // Initial discovery
    this.handleVideoChange();
  }

  stopMonitoring(): void {
    if (!this.isMonitoringActive) {
      return;
    }

    console.log('[LinguaTube] Stopping subtitle discovery monitoring...');
    this.isMonitoringActive = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  isMonitoring(): boolean {
    return this.isMonitoringActive;
  }

  // ========================================
  // Event Handling Methods
  // ========================================

  addEventListener(type: SubtitleDiscoveryEvent, listener: (event: SubtitleDiscoveryEventData) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  removeEventListener(type: SubtitleDiscoveryEvent, listener: (event: SubtitleDiscoveryEventData) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  // ========================================
  // Configuration Methods
  // ========================================

  updateConfig(config: Partial<SubtitleDiscoveryConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[LinguaTube] Configuration updated:', this.config);
  }

  getConfig(): SubtitleDiscoveryConfig {
    return { ...this.config };
  }

  // ========================================
  // Utility Methods
  // ========================================

  getCurrentVideoId(): string | null {
    return this.currentVideoId || YouTubePlayerResponseParser.getCurrentVideoId();
  }

  getCurrentVideoTitle(): string | null {
    return YouTubePlayerResponseParser.getCurrentVideoTitle();
  }

  isVideoPage(): boolean {
    return YouTubePlayerResponseParser.isValidVideoPage();
  }

  async refresh(): Promise<SubtitleDiscoveryResult> {
    // Clear cached data
    this.currentTracks = [];
    this.currentVideoId = null;
    YouTubePlayerResponseParser.clearCache();
    
    // Rediscover subtitles
    return this.discoverSubtitles();
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private initializeEventListeners(): void {
    // Initialize all event listener arrays
    for (const eventType of Object.values(SubtitleDiscoveryEvent)) {
      this.eventListeners.set(eventType, []);
    }
  }

  private emitEvent<T = unknown>(type: SubtitleDiscoveryEvent, data: T): void {
    const eventData: SubtitleDiscoveryEventData<T> = {
      type,
      data,
      videoId: this.currentVideoId || undefined,
      timestamp: Date.now()
    };

    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(eventData);
        } catch (error) {
          console.error('[LinguaTube] Event listener error:', error);
        }
      });
    }
  }

  private createErrorResult(
    error: SubtitleDiscoveryError,
    videoId?: string | null,
    videoTitle?: string | null
  ): SubtitleDiscoveryResult {
    const result: SubtitleDiscoveryResult = {
      success: false,
      tracks: [],
      availableLanguages: [],
      videoId: videoId || undefined,
      videoTitle: videoTitle || undefined,
      error,
      timestamp: Date.now()
    };

    this.emitEvent(SubtitleDiscoveryEvent.DISCOVERY_FAILED, error);
    return result;
  }

  private applyConfigFilters(tracks: SubtitleTrack[]): SubtitleTrack[] {
    return SubtitleTrackProcessor.filterTracks(tracks, {
      includeAutoGenerated: this.config.includeAutoGenerated,
      includeTranslatable: this.config.includeTranslatable
    });
  }

  private handleMutations(mutations: MutationRecord[]): void {
    let shouldCheck = false;

    for (const mutation of mutations) {
      // Check for URL changes (YouTube SPA navigation)
      if (mutation.type === 'attributes' && mutation.attributeName === 'href') {
        shouldCheck = true;
        break;
      }

      // Check for added nodes that might indicate video changes
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (element.matches('ytd-player, #movie_player, .video-stream')) {
              shouldCheck = true;
              break;
            }
          }
        }
        if (shouldCheck) break;
      }
    }

    if (shouldCheck) {
      // Debounce the check
      clearTimeout(this.videoChangeTimeout);
      this.videoChangeTimeout = window.setTimeout(() => {
        this.handleVideoChange();
      }, 500);
    }
  }

  private videoChangeTimeout: number | undefined;

  private async handleVideoChange(): Promise<void> {
    const newVideoId = YouTubePlayerResponseParser.getCurrentVideoId();
    
    if (newVideoId && newVideoId !== this.currentVideoId) {
      console.log('[LinguaTube] Video change detected:', newVideoId);
      this.emitEvent(SubtitleDiscoveryEvent.VIDEO_CHANGED, { videoId: newVideoId });
      
      // Clear current state
      this.currentTracks = [];
      this.currentVideoId = null;
      
      // Trigger new discovery (with delay for page to load)
      setTimeout(async () => {
        try {
          await this.discoverSubtitles();
        } catch (error) {
          console.error('[LinguaTube] Auto-discovery failed after video change:', error);
        }
      }, 1000);
    }
  }
}

// Export singleton instance
export const subtitleDiscoveryService = new LinguaTubeSubtitleDiscoveryService(); 