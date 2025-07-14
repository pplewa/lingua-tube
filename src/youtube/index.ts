/**
 * LinguaTube YouTube Subtitle Discovery Module
 * Main export file providing clean API for YouTube subtitle discovery
 */

// Export all types and interfaces
export * from './types';

// Export parser components
export { YouTubePlayerResponseParser } from './PlayerResponseParser';
export { SubtitleTrackProcessor } from './SubtitleTrackProcessor';

// Export main service
export {
  LinguaTubeSubtitleDiscoveryService,
  subtitleDiscoveryService,
} from './SubtitleDiscoveryService';

// Re-export singleton as default
export { subtitleDiscoveryService as default } from './SubtitleDiscoveryService';
