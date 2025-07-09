/**
 * LinguaTube Content Script
 * Runs on YouTube video pages to discover subtitles and enable language learning features
 */

import { subtitleDiscoveryService, SubtitleDiscoveryEvent } from '../youtube';

console.log('[LinguaTube] Content script starting on:', window.location.href);

// Initialize subtitle discovery service
async function initializeSubtitleDiscovery() {
  try {
    console.log('[LinguaTube] Initializing subtitle discovery...');

    // Set up event listeners for subtitle discovery events
    subtitleDiscoveryService.addEventListener(
      SubtitleDiscoveryEvent.TRACKS_DISCOVERED,
      (event) => {
        const result = event.data as any;
        console.log('[LinguaTube] Subtitle tracks discovered:', {
          videoId: event.videoId,
          trackCount: result.tracks?.length || 0,
          languages: result.availableLanguages?.map((lang: any) => lang.code) || []
        });
      }
    );

    subtitleDiscoveryService.addEventListener(
      SubtitleDiscoveryEvent.VIDEO_CHANGED,
      (event) => {
        const data = event.data as any;
        console.log('[LinguaTube] Video changed to:', data.videoId);
      }
    );

    subtitleDiscoveryService.addEventListener(
      SubtitleDiscoveryEvent.DISCOVERY_FAILED,
      (event) => {
        console.warn('[LinguaTube] Subtitle discovery failed:', event.data);
      }
    );

    // Start monitoring for video changes and subtitle discovery
    subtitleDiscoveryService.startMonitoring();

    console.log('[LinguaTube] Subtitle discovery monitoring started');

  } catch (error) {
    console.error('[LinguaTube] Failed to initialize subtitle discovery:', error);
  }
}

// Wait for page to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeSubtitleDiscovery);
} else {
  initializeSubtitleDiscovery();
}
