/**
 * @fileoverview Practical examples showing how to integrate the YouTube Player Utilities
 * with existing components like PlayerInteractionService, SubtitleService, etc.
 * 
 * These examples demonstrate real-world usage patterns and best practices.
 */

import { 
  validateNumber, 
  validateString,
  clamp, 
  isValidVideoElement, 
  throttle,
  debounce,
  withTimeout,
  retry,
  formatTime,
  parseTimeToSeconds,
  validateTimeRange,
  safeQuerySelector,
  waitForElement,
  sanitizeString,
  truncateString,
  mergeObjects,
  isEmpty
} from './index';

// Example: Enhanced PlayerInteractionService methods using utilities
class EnhancedPlayerInteractionService {
  private videoElement: HTMLVideoElement | null = null;
  
  // Enhanced validation using validateNumber utility
  private validateTimeValue(timeInSeconds: number, paramName: string = 'timeInSeconds'): number {
    const result = validateNumber(timeInSeconds, paramName, {
      min: 0,
      finite: true
    });
    
    if (!result.isValid) {
      throw new Error(`Invalid ${paramName}: ${result.error}`);
    }
    
    // Clamp to valid range if we have duration info
    const duration = this.getDuration();
    if (duration > 0) {
      const clampedTime = clamp(timeInSeconds, { min: 0, max: duration });
      if (clampedTime !== timeInSeconds) {
        console.warn(`[PlayerInteractionService] ${paramName} ${timeInSeconds}s clamped to ${clampedTime}s`);
      }
      return clampedTime;
    }
    
    return timeInSeconds;
  }

  // Enhanced volume validation
  public async setVolume(volume: number): Promise<void> {
    const result = validateNumber(volume, 'volume', {
      min: 0,
      max: 1,
      finite: true
    });
    
    if (!result.isValid) {
      throw new Error(`Invalid volume: ${result.error}`);
    }
    
    const clampedVolume = clamp(volume, { min: 0, max: 1 });
    
    if (this.videoElement) {
      this.videoElement.volume = clampedVolume;
    }
  }

  // Enhanced playback rate with validation
  public async setPlaybackRate(rate: number): Promise<void> {
    const result = validateNumber(rate, 'playbackRate', {
      min: 0.25,
      max: 2.0,
      finite: true
    });
    
    if (!result.isValid) {
      throw new Error(`Invalid playback rate: ${result.error}`);
    }
    
    const clampedRate = clamp(rate, { min: 0.25, max: 2.0 });
    
    if (this.videoElement) {
      this.videoElement.playbackRate = clampedRate;
    }
  }

  // Timeout-protected play operation
  public async safePlay(): Promise<void> {
    if (!isValidVideoElement(this.videoElement)) {
      throw new Error('Invalid video element');
    }
    
    try {
      await withTimeout(
        this.videoElement.play(),
        { timeoutMs: 5000, timeoutMessage: 'Play operation timed out' }
      );
    } catch (error) {
      console.error('[PlayerInteractionService] Play failed:', error);
      throw error;
    }
  }

  // Robust seek with validation and clamping
  public async seekTo(timeInSeconds: number): Promise<void> {
    const validatedTime = this.validateTimeValue(timeInSeconds, 'seekTime');
    
    if (!isValidVideoElement(this.videoElement)) {
      throw new Error('Invalid video element');
    }
    
    try {
      this.videoElement.currentTime = validatedTime;
      
      // Wait for seek to complete with timeout
      await withTimeout(
        new Promise<void>((resolve) => {
          const checkSeek = () => {
            if (Math.abs(this.videoElement!.currentTime - validatedTime) < 0.1) {
              resolve();
            } else {
              requestAnimationFrame(checkSeek);
            }
          };
          checkSeek();
        }),
        { timeoutMs: 3000, timeoutMessage: 'Seek operation timed out' }
      );
    } catch (error) {
      console.error('[PlayerInteractionService] Seek failed:', error);
      throw error;
    }
  }

  // Time formatting for UI display
  public getCurrentTimeFormatted(format: 'human' | 'srt' | 'vtt' = 'human'): string {
    const currentTime = this.getCurrentTime();
    return formatTime(currentTime, { format });
  }

  public getDurationFormatted(format: 'human' | 'srt' | 'vtt' = 'human'): string {
    const duration = this.getDuration();
    return formatTime(duration, { format });
  }

  // Debounced state update to prevent excessive calls
  private debouncedStateUpdate = debounce(() => {
    this.updatePlayerState('debounced_update');
  }, 100);

  // Throttled progress update for performance
  private throttledProgressUpdate = throttle((currentTime: number) => {
    this.onProgressUpdate(currentTime);
  }, 100);

  private getCurrentTime(): number {
    return this.videoElement?.currentTime || 0;
  }

  private getDuration(): number {
    return this.videoElement?.duration || 0;
  }

  private updatePlayerState(source: string): void {
    // Implementation...
  }

  private onProgressUpdate(currentTime: number): void {
    // Implementation...
  }
}

// Example: Enhanced SubtitleService using utilities
class EnhancedSubtitleService {
  // Validate subtitle timing with utilities
  public validateSubtitleTiming(startTime: number, endTime: number): boolean {
    const result = validateTimeRange(startTime, endTime);
    
    if (!result.isValid) {
      console.error('[SubtitleService] Invalid subtitle timing:', result.error);
      return false;
    }
    
    return true;
  }

  // Parse and validate subtitle timestamps
  public parseSubtitleTimestamp(timeString: string): number {
    try {
      const seconds = parseTimeToSeconds(timeString);
      
      const result = validateNumber(seconds, 'timestamp', {
        min: 0,
        finite: true
      });
      
      if (!result.isValid) {
        throw new Error(result.error);
      }
      
      return seconds;
    } catch (error) {
      console.error('[SubtitleService] Failed to parse timestamp:', timeString, error);
      throw error;
    }
  }

  // Format subtitle text safely
  public formatSubtitleText(text: string, maxLength: number = 100): string {
    const result = validateString(text, 'subtitle text', {
      nonEmpty: true,
      maxLength: 1000 // Sanity check
    });
    
    if (!result.isValid) {
      console.warn('[SubtitleService] Invalid subtitle text:', result.error);
      return '';
    }
    
    // Sanitize and truncate
    const sanitized = sanitizeString(text);
    return truncateString(sanitized, maxLength);
  }

  // Convert subtitle format with validation
  public convertSubtitleFormat(
    subtitle: { start: string; end: string; text: string },
    outputFormat: 'srt' | 'vtt'
  ): string {
    const startSeconds = this.parseSubtitleTimestamp(subtitle.start);
    const endSeconds = this.parseSubtitleTimestamp(subtitle.end);
    
    if (!this.validateSubtitleTiming(startSeconds, endSeconds)) {
      throw new Error('Invalid subtitle timing');
    }
    
    const formattedStart = formatTime(startSeconds, { 
      format: outputFormat, 
      includeMilliseconds: true 
    });
    const formattedEnd = formatTime(endSeconds, { 
      format: outputFormat, 
      includeMilliseconds: true 
    });
    const formattedText = this.formatSubtitleText(subtitle.text);
    
    if (outputFormat === 'srt') {
      return `${formattedStart} --> ${formattedEnd}\n${formattedText}`;
    } else {
      return `${formattedStart} --> ${formattedEnd}\n${formattedText}`;
    }
  }
}

// Example: Enhanced DOM utilities for YouTube detection
class YouTubeElementService {
  // Robust video element detection
  public async findVideoElement(): Promise<HTMLVideoElement | null> {
    try {
      const videoElement = await safeQuerySelector<HTMLVideoElement>(
        'video[src*="youtube"], video[src*="googlevideo"]',
        {
          timeout: 10000,
          retries: 5,
          fallbackSelectors: [
            'video',
            'iframe[src*="youtube"]',
            '.html5-video-player video'
          ],
          validateElement: (el) => isValidVideoElement(el) && el.duration > 0
        }
      );
      
      return videoElement;
    } catch (error) {
      console.error('[YouTubeElementService] Failed to find video element:', error);
      return null;
    }
  }

  // Wait for YouTube player to be ready
  public async waitForPlayerReady(): Promise<HTMLVideoElement> {
    const videoElement = await waitForElement<HTMLVideoElement>(
      'video',
      {
        timeout: 30000,
        validateElement: (el) => {
          return isValidVideoElement(el) && 
                 el.readyState >= HTMLMediaElement.HAVE_METADATA &&
                 !isNaN(el.duration) &&
                 el.duration > 0;
        }
      }
    );
    
    if (!videoElement) {
      throw new Error('YouTube player failed to load within timeout');
    }
    
    return videoElement;
  }

  // Robust controls detection
  public async findPlayerControls(): Promise<Element | null> {
    return await safeQuerySelector(
      '.ytp-chrome-controls',
      {
        timeout: 5000,
        fallbackSelectors: [
          '.html5-player-chrome',
          '.ytp-player-content',
          '.player-controls'
        ]
      }
    );
  }
}

// Example: Configuration management with validation
class PlayerConfigService {
  private defaultConfig = {
    volume: 1.0,
    playbackRate: 1.0,
    autoplay: false,
    quality: 'auto' as const,
    subtitles: true,
    loop: false
  };

  public validateAndMergeConfig(userConfig: Partial<typeof this.defaultConfig>) {
    const validatedConfig: Partial<typeof this.defaultConfig> = {};
    
    // Validate volume
    if (userConfig.volume !== undefined) {
      const volumeResult = validateNumber(userConfig.volume, 'volume', {
        min: 0,
        max: 1,
        finite: true
      });
      
      if (volumeResult.isValid) {
        validatedConfig.volume = clamp(userConfig.volume, { min: 0, max: 1 });
      } else {
        console.warn('[PlayerConfigService] Invalid volume, using default:', volumeResult.error);
      }
    }
    
    // Validate playback rate
    if (userConfig.playbackRate !== undefined) {
      const rateResult = validateNumber(userConfig.playbackRate, 'playbackRate', {
        min: 0.25,
        max: 2.0,
        finite: true
      });
      
      if (rateResult.isValid) {
        validatedConfig.playbackRate = clamp(userConfig.playbackRate, { min: 0.25, max: 2.0 });
      } else {
        console.warn('[PlayerConfigService] Invalid playback rate, using default:', rateResult.error);
      }
    }
    
    // Validate quality setting
    if (userConfig.quality !== undefined) {
      const qualityResult = validateString(userConfig.quality, 'quality', {
        nonEmpty: true,
        pattern: /^(auto|144p|240p|360p|480p|720p|1080p)$/
      });
      
      if (qualityResult.isValid) {
        validatedConfig.quality = userConfig.quality;
      } else {
        console.warn('[PlayerConfigService] Invalid quality setting, using default:', qualityResult.error);
      }
    }
    
    // Boolean values can be validated and passed through
    if (typeof userConfig.autoplay === 'boolean') {
      validatedConfig.autoplay = userConfig.autoplay;
    }
    
    if (typeof userConfig.subtitles === 'boolean') {
      validatedConfig.subtitles = userConfig.subtitles;
    }
    
    if (typeof userConfig.loop === 'boolean') {
      validatedConfig.loop = userConfig.loop;
    }
    
    // Merge with defaults
    return mergeObjects(this.defaultConfig, validatedConfig);
  }
  
  public isValidConfig(config: unknown): config is typeof this.defaultConfig {
    if (!config || typeof config !== 'object') {
      return false;
    }
    
    const validatedConfig = this.validateAndMergeConfig(config as any);
    return !isEmpty(validatedConfig);
  }
}

// Example: Error handling with retries
class YouTubeAPIService {
  // Retry failed API calls with exponential backoff
  public async fetchVideoInfo(videoId: string): Promise<any> {
    const result = validateString(videoId, 'videoId', {
      nonEmpty: true,
      pattern: /^[a-zA-Z0-9_-]+$/,
      minLength: 11,
      maxLength: 11
    });
    
    if (!result.isValid) {
      throw new Error(`Invalid video ID: ${result.error}`);
    }
    
    return await retry(
      async () => {
        const response = await fetch(`/api/video/${videoId}`);
        if (!response.ok) {
          throw new Error(`API request failed: ${response.status}`);
        }
        return response.json();
      },
      {
        maxAttempts: 3,
        baseDelay: 1000,
        exponentialBackoff: true,
        jitter: true
      }
    );
  }

  // Robust player state polling with throttling
  private throttledStateCheck = throttle(async () => {
    try {
      const state = await this.getCurrentPlayerState();
      this.onStateUpdate(state);
    } catch (error) {
      console.error('[YouTubeAPIService] State check failed:', error);
    }
  }, 500);

  public startStatePolling(): void {
    // Use throttled function to prevent excessive API calls
    setInterval(() => {
      this.throttledStateCheck();
    }, 100);
  }

  private async getCurrentPlayerState(): Promise<any> {
    // Implementation...
    return {};
  }

  private onStateUpdate(state: any): void {
    // Implementation...
  }
}

// Example: Comprehensive error boundary
class PlayerErrorHandler {
  private errorCounts = new Map<string, number>();
  private maxErrors = 5;
  
  // Debounced error reporting to prevent spam
  private debouncedErrorReport = debounce((error: Error, context: string) => {
    this.reportError(error, context);
  }, 1000);

  public handleError(error: Error, context: string): void {
    const errorKey = `${context}:${error.message}`;
    const currentCount = this.errorCounts.get(errorKey) || 0;
    
    if (currentCount >= this.maxErrors) {
      console.warn(`[PlayerErrorHandler] Error threshold reached for ${errorKey}, suppressing`);
      return;
    }
    
    this.errorCounts.set(errorKey, currentCount + 1);
    this.debouncedErrorReport(error, context);
  }

  private reportError(error: Error, context: string): void {
    const sanitizedMessage = sanitizeString(error.message);
    const truncatedMessage = truncateString(sanitizedMessage, 200);
    
    console.error(`[PlayerErrorHandler] ${context}:`, truncatedMessage);
    
    // Could send to error tracking service here
  }

  public clearErrorCounts(): void {
    this.errorCounts.clear();
  }
}

// Export examples for reference
export {
  EnhancedPlayerInteractionService,
  EnhancedSubtitleService,
  YouTubeElementService,
  PlayerConfigService,
  YouTubeAPIService,
  PlayerErrorHandler
};

// Example usage patterns
export const UsageExamples = {
  // Time validation and formatting
  timeHandling: {
    validateAndClamp: (timeInput: string, maxDuration: number) => {
      try {
        const seconds = parseTimeToSeconds(timeInput);
        return clamp(seconds, { min: 0, max: maxDuration });
      } catch (error) {
        console.error('Invalid time input:', error);
        return 0;
      }
    },
    
    formatForUI: (seconds: number) => {
      return formatTime(seconds, { format: 'human' });
    },
    
    formatForSubtitles: (seconds: number, format: 'srt' | 'vtt') => {
      return formatTime(seconds, { format, includeMilliseconds: true });
    }
  },

  // DOM operations
  domOperations: {
    waitForYouTubePlayer: async () => {
      return await waitForElement<HTMLVideoElement>(
        'video',
        {
          timeout: 15000,
          validateElement: (el) => isValidVideoElement(el) && el.duration > 0
        }
      );
    },
    
    findPlayerWithFallbacks: async () => {
      return await safeQuerySelector<HTMLVideoElement>(
        'video[src*="youtube"]',
        {
          fallbackSelectors: ['video', '.html5-video-player video'],
          validateElement: (el) => isValidVideoElement(el)
        }
      );
    }
  },

  // Event handling
  eventHandling: {
    createThrottledScrollHandler: () => {
      return throttle((event: Event) => {
        console.log('Scroll event processed');
      }, 100);
    },
    
    createDebouncedSearchHandler: () => {
      return debounce((query: string) => {
        console.log('Search query:', query);
      }, 300);
    }
  },

  // Configuration management
  configManagement: {
    mergeUserSettings: (defaults: any, userSettings: any) => {
      return mergeObjects(defaults, userSettings);
    },
    
    validatePlayerConfig: (config: any) => {
      if (isEmpty(config)) {
        return null;
      }
      
      // Additional validation logic here
      return config;
    }
  }
}; 