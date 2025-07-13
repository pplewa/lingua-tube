/**
 * Sentence Looping Service for LinguaTube
 * Provides precise sentence-level looping functionality for language learning,
 * integrating with subtitle timing data and enhanced playback controls.
 */

import {
  PlayerInteractionService,
  SubtitleSyncEvent,
  ActiveSubtitleCue,
} from '../youtube/PlayerInteractionService';
import { StorageService } from '../storage';
import { UserSettings } from '../storage/types';
import { SubtitleSegment } from '../subtitles/types';
import { Logger } from '../logging';
import { ComponentType } from '../logging/types';

// ========================================
// Types and Interfaces
// ========================================

export interface SentenceLoopConfig {
  readonly enabled: boolean;
  readonly autoLoop: boolean;
  readonly loopCount: number; // 0 = infinite
  readonly pauseBetweenLoops: number; // milliseconds
  readonly showVisualIndicator: boolean;
  readonly highlightCurrentSentence: boolean;
  readonly seekBackOffset: number; // seconds to seek back before sentence start
  readonly seekForwardOffset: number; // seconds to seek forward after sentence end
  readonly minLoopDuration: number; // minimum loop duration in seconds
  readonly maxLoopDuration: number; // maximum loop duration in seconds
  readonly fadeInDuration: number; // fade in duration after seek
  readonly fadeOutDuration: number; // fade out duration before seek
}

export interface SentenceLoop {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
  readonly subtitleId?: string;
  readonly isActive: boolean;
  readonly currentIteration: number;
  readonly maxIterations: number;
  readonly createdAt: number;
  readonly lastActivated: number;
}

export interface SentenceSelection {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly segments: SubtitleSegment[];
  readonly combinedText: string;
  readonly totalDuration: number;
}

export interface LoopEvent {
  readonly type:
    | 'loop_created'
    | 'loop_started'
    | 'loop_iteration'
    | 'loop_completed'
    | 'loop_cancelled';
  readonly loop: SentenceLoop;
  readonly timestamp: number;
  readonly iteration?: number;
  readonly totalIterations?: number;
}

export type LoopEventCallback = (event: LoopEvent) => void;

// ========================================
// Constants and Configuration
// ========================================

const DEFAULT_CONFIG: SentenceLoopConfig = {
  enabled: true,
  autoLoop: false,
  loopCount: 3,
  pauseBetweenLoops: 500,
  showVisualIndicator: true,
  highlightCurrentSentence: true,
  seekBackOffset: 0.1,
  seekForwardOffset: 0.1,
  minLoopDuration: 1.0,
  maxLoopDuration: 30.0,
  fadeInDuration: 0.2,
  fadeOutDuration: 0.1,
};

// ========================================
// Sentence Detection Utilities
// ========================================

class SentenceDetector {
  private static readonly SENTENCE_ENDINGS = /[.!?]+\s*$/;
  private static readonly SENTENCE_STARTERS = /^[A-Z]/;
  private static readonly PAUSE_INDICATORS = /[,;:]\s*$/;

  /**
   * Detect sentence boundaries in subtitle segments
   */
  static detectSentences(segments: SubtitleSegment[]): SentenceSelection[] {
    const sentences: SentenceSelection[] = [];
    let currentSentence: SubtitleSegment[] = [];
    let startIndex = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      currentSentence.push(segment);

      // Check if this segment ends a sentence
      if (this.isSegmentSentenceEnd(segment, segments[i + 1])) {
        sentences.push(this.createSentenceSelection(startIndex, i, currentSentence));
        currentSentence = [];
        startIndex = i + 1;
      }
    }

    // Handle remaining segments
    if (currentSentence.length > 0) {
      sentences.push(
        this.createSentenceSelection(startIndex, segments.length - 1, currentSentence),
      );
    }

    return sentences;
  }

  private static isSegmentSentenceEnd(current: SubtitleSegment, next?: SubtitleSegment): boolean {
    const text = current.text.trim();

    // Check for sentence ending punctuation
    if (this.SENTENCE_ENDINGS.test(text)) {
      return true;
    }

    // Check for significant pause (gap between segments)
    if (next) {
      const gap = next.startTime - current.endTime;
      if (gap > 1.0) {
        // 1 second gap suggests sentence boundary
        return true;
      }
    }

    // Check for capitalization change
    if (next && this.SENTENCE_STARTERS.test(next.text.trim())) {
      return true;
    }

    return false;
  }

  private static createSentenceSelection(
    startIndex: number,
    endIndex: number,
    segments: SubtitleSegment[],
  ): SentenceSelection {
    const combinedText = segments
      .map((s) => s.text)
      .join(' ')
      .trim();
    const totalDuration = segments[segments.length - 1].endTime - segments[0].startTime;

    return {
      startIndex,
      endIndex,
      segments: [...segments],
      combinedText,
      totalDuration,
    };
  }

  /**
   * Find sentence containing a specific time
   */
  static findSentenceAtTime(
    sentences: SentenceSelection[],
    time: number,
  ): SentenceSelection | null {
    return (
      sentences.find((sentence) => {
        const startTime = sentence.segments[0].startTime;
        const endTime = sentence.segments[sentence.segments.length - 1].endTime;
        return time >= startTime && time <= endTime;
      }) || null
    );
  }

  /**
   * Find sentence containing a specific subtitle segment
   */
  static findSentenceBySegment(
    sentences: SentenceSelection[],
    segmentId: string,
  ): SentenceSelection | null {
    return (
      sentences.find((sentence) => sentence.segments.some((segment) => segment.id === segmentId)) ||
      null
    );
  }
}

// ========================================
// Main Sentence Looping Service
// ========================================

export class SentenceLoopingService {
  private playerService: PlayerInteractionService;
  private storageService: StorageService;

  private config: SentenceLoopConfig = { ...DEFAULT_CONFIG };
  private currentLoop: SentenceLoop | null = null;
  private availableSentences: SentenceSelection[] = [];
  private subtitleSegments: SubtitleSegment[] = [];

  private loopMonitorInterval: number | null = null;
  private pauseTimeout: number | null = null;
  private fadeTimeout: number | null = null;

  private eventListeners: Set<LoopEventCallback> = new Set();
  private subtitleSyncHandler: (event: SubtitleSyncEvent) => void;

  private isInitialized: boolean = false;
  private isLooping: boolean = false;
  private originalVolume: number = 1.0;
  private readonly logger = Logger.getInstance();

  constructor(
    playerService: PlayerInteractionService,
    storageService: StorageService,
    initialConfig?: Partial<SentenceLoopConfig>,
  ) {
    this.playerService = playerService;
    this.storageService = storageService;

    if (initialConfig) {
      this.config = { ...this.config, ...initialConfig };
    }

    this.subtitleSyncHandler = this.handleSubtitleSync.bind(this);
    this.loadConfigFromStorage();
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  public async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) {
        this.logger?.warn('Already initialized', {
          component: ComponentType.SUBTITLE_MANAGER,
        });
        return true;
      }

      // Set up subtitle sync listener
      this.playerService.addSubtitleSyncListener(this.subtitleSyncHandler);

      // Load initial subtitle data
      await this.refreshSubtitleData();

      this.isInitialized = true;
      this.logger?.info('Initialized successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          configEnabled: this.config.enabled,
          autoLoop: this.config.autoLoop,
          loopCount: this.config.loopCount,
        },
      });
      return true;
    } catch (error) {
      this.logger?.error('Initialization failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  public destroy(): void {
    try {
      // Stop any active loops
      this.stopCurrentLoop();

      // Remove event listeners
      this.playerService.removeSubtitleSyncListener(this.subtitleSyncHandler);

      // Clear intervals and timeouts
      this.clearLoopMonitoring();
      this.clearTimeouts();

      // Clear listeners
      this.eventListeners.clear();

      this.isInitialized = false;
      this.logger?.info('Destroyed successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
      });
    } catch (error) {
      this.logger?.error('Destroy failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // ========================================
  // Configuration Management
  // ========================================

  private async loadConfigFromStorage(): Promise<void> {
    try {
      const result = await this.storageService.getSettings();
      if (result.success && result.data) {
        this.updateConfigFromSettings(result.data);
      }
    } catch (error) {
      this.logger?.warn('Failed to load config from storage', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private updateConfigFromSettings(settings: UserSettings): void {
    // Update config based on user settings
    this.config = {
      ...this.config,
      enabled: settings.playback.enableSentenceLoop,
      autoLoop: settings.playback.enableAutoReplay,
      pauseBetweenLoops: 500, // Could be added to settings
      showVisualIndicator: settings.ui.animationsEnabled,
      highlightCurrentSentence: true, // Could be added to settings
    };
  }

  public updateConfig(newConfig: Partial<SentenceLoopConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Apply immediate changes if needed
    if (!newConfig.enabled && this.isLooping) {
      this.stopCurrentLoop();
    }
  }

  // ========================================
  // Subtitle Data Management
  // ========================================

  private handleSubtitleSync(event: SubtitleSyncEvent): void {
    switch (event.type) {
      case 'track_change':
        this.refreshSubtitleData();
        break;
      case 'cue_start':
        if (this.config.autoLoop && !this.isLooping) {
          this.handleAutomaticLooping(event.cue);
        }
        break;
    }
  }

  private async refreshSubtitleData(): Promise<void> {
    try {
      // Get current subtitle segments from player service
      const currentTrack = this.playerService.getCurrentSubtitleTrack();
      if (!currentTrack || !currentTrack.cues) {
        this.subtitleSegments = [];
        this.availableSentences = [];
        return;
      }

      // Convert SubtitleCue to SubtitleSegment format
      this.subtitleSegments = currentTrack.cues.map((cue) => ({
        id: cue.id,
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cue.text,
        styling: cue.styling
          ? {
              color: cue.styling.color,
              backgroundColor: cue.styling.backgroundColor,
              fontSize: cue.styling.fontSize,
              fontFamily: cue.styling.fontFamily,
              fontWeight: cue.styling.fontWeight,
              textDecoration: cue.styling.textDecoration,
            }
          : undefined,
        position: cue.position
          ? {
              line: cue.position.line,
              position: cue.position.position,
              align: cue.position.align === 'center' ? 'middle' : cue.position.align,
              vertical: cue.position.vertical,
            }
          : undefined,
        metadata: {
          language: cue.language,
          confidence: cue.confidence,
        },
      }));
      this.availableSentences = SentenceDetector.detectSentences(this.subtitleSegments);

      this.logger?.debug('Subtitle data refreshed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          sentenceCount: this.availableSentences.length,
          segmentCount: this.subtitleSegments.length,
          hasCurrentTrack: !!currentTrack,
        },
      });
    } catch (error) {
      this.logger?.error('Failed to refresh subtitle data', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.subtitleSegments = [];
      this.availableSentences = [];
    }
  }

  // ========================================
  // Loop Creation and Management
  // ========================================

  public createLoopFromCurrentTime(): SentenceLoop | null {
    if (!this.config.enabled) {
      this.logger?.warn('Service is disabled', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          action: 'createLoopFromCurrentTime',
        },
      });
      return null;
    }

    const currentTime = this.playerService.getCurrentTime();
    return this.createLoopAtTime(currentTime);
  }

  public createLoopAtTime(time: number): SentenceLoop | null {
    const sentence = SentenceDetector.findSentenceAtTime(this.availableSentences, time);
    if (!sentence) {
      this.logger?.warn('No sentence found at time', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          time,
          availableSentencesCount: this.availableSentences.length,
        },
      });
      return null;
    }

    return this.createLoopFromSentence(sentence);
  }

  public createLoopFromSubtitleId(subtitleId: string): SentenceLoop | null {
    const sentence = SentenceDetector.findSentenceBySegment(this.availableSentences, subtitleId);
    if (!sentence) {
      this.logger?.warn('No sentence found for subtitle ID', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          subtitleId,
          availableSentencesCount: this.availableSentences.length,
        },
      });
      return null;
    }

    return this.createLoopFromSentence(sentence);
  }

  private createLoopFromSentence(sentence: SentenceSelection): SentenceLoop | null {
    const startTime = sentence.segments[0].startTime - this.config.seekBackOffset;
    const endTime =
      sentence.segments[sentence.segments.length - 1].endTime + this.config.seekForwardOffset;
    const duration = endTime - startTime;

    // Validate loop duration
    if (duration < this.config.minLoopDuration) {
      this.logger?.warn('Loop duration too short', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          duration,
          minDuration: this.config.minLoopDuration,
          sentenceText: sentence.combinedText.substring(0, 50),
        },
      });
      return null;
    }

    if (duration > this.config.maxLoopDuration) {
      this.logger?.warn('Loop duration too long', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          duration,
          maxDuration: this.config.maxLoopDuration,
          sentenceText: sentence.combinedText.substring(0, 50),
        },
      });
      return null;
    }

    const loop: SentenceLoop = {
      id: this.generateLoopId(),
      startTime: Math.max(0, startTime),
      endTime,
      text: sentence.combinedText,
      subtitleId: sentence.segments[0].id,
      isActive: false,
      currentIteration: 0,
      maxIterations: this.config.loopCount,
      createdAt: Date.now(),
      lastActivated: 0,
    };

    this.logger?.info('Created loop', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        loopId: loop.id,
        startTime: loop.startTime,
        endTime: loop.endTime,
        duration: loop.endTime - loop.startTime,
        maxIterations: loop.maxIterations,
        text: loop.text.substring(0, 50),
      },
    });
    this.emitEvent({ type: 'loop_created', loop, timestamp: Date.now() });

    return loop;
  }

  public activateLoop(loop: SentenceLoop): boolean {
    if (!this.config.enabled) {
      this.logger?.warn('Service is disabled', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          action: 'activateLoop',
          loopId: loop.id,
        },
      });
      return false;
    }

    // Stop any existing loop
    this.stopCurrentLoop();

    // Set new current loop
    this.currentLoop = {
      ...loop,
      isActive: true,
      currentIteration: 0,
      lastActivated: Date.now(),
    };

    // Start looping
    this.startLooping();

    return true;
  }

  // ========================================
  // Loop Execution
  // ========================================

  private startLooping(): void {
    if (!this.currentLoop) return;

    this.isLooping = true;
    this.originalVolume = this.playerService.getVolume();

    // Seek to loop start
    this.seekToLoopStart();

    // Start monitoring
    this.setupLoopMonitoring();

    this.emitEvent({
      type: 'loop_started',
      loop: this.currentLoop,
      timestamp: Date.now(),
    });

    this.logger?.info('Started looping', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        loopId: this.currentLoop.id,
        startTime: this.currentLoop.startTime,
        endTime: this.currentLoop.endTime,
        maxIterations: this.currentLoop.maxIterations,
        text: this.currentLoop.text.substring(0, 50),
      },
    });
  }

  private seekToLoopStart(): void {
    if (!this.currentLoop) return;

    try {
      this.playerService.seek(this.currentLoop.startTime);

      // Apply fade in if configured
      if (this.config.fadeInDuration > 0) {
        this.applyFadeIn();
      }
    } catch (error) {
      this.logger?.error('Failed to seek to loop start', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          loopId: this.currentLoop?.id,
          startTime: this.currentLoop?.startTime,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private setupLoopMonitoring(): void {
    this.clearLoopMonitoring();

    this.loopMonitorInterval = window.setInterval(() => {
      this.checkLoopProgress();
    }, 100); // Check every 100ms
  }

  private checkLoopProgress(): void {
    if (!this.currentLoop || !this.isLooping) {
      this.clearLoopMonitoring();
      return;
    }

    const currentTime = this.playerService.getCurrentTime();

    // Check if we've reached the end of the loop
    if (currentTime >= this.currentLoop.endTime) {
      this.handleLoopIteration();
    }

    // Check if user has seeked outside the loop
    if (
      currentTime < this.currentLoop.startTime - 1.0 ||
      currentTime > this.currentLoop.endTime + 1.0
    ) {
      this.logger?.info('User seeked outside loop, stopping', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          loopId: this.currentLoop.id,
          currentTime,
          loopStartTime: this.currentLoop.startTime,
          loopEndTime: this.currentLoop.endTime,
        },
      });
      this.stopCurrentLoop();
    }
  }

  private handleLoopIteration(): void {
    if (!this.currentLoop) return;

    this.currentLoop = {
      ...this.currentLoop,
      currentIteration: this.currentLoop.currentIteration + 1,
    };

    this.emitEvent({
      type: 'loop_iteration',
      loop: this.currentLoop,
      timestamp: Date.now(),
      iteration: this.currentLoop.currentIteration,
      totalIterations: this.currentLoop.maxIterations,
    });

    // Check if we've completed all iterations
    if (
      this.currentLoop.maxIterations > 0 &&
      this.currentLoop.currentIteration >= this.currentLoop.maxIterations
    ) {
      this.completeLoop();
      return;
    }

    // Continue looping
    if (this.config.pauseBetweenLoops > 0) {
      this.pauseBeforeNextIteration();
    } else {
      this.seekToLoopStart();
    }
  }

  private pauseBeforeNextIteration(): void {
    if (!this.currentLoop) return;

    // Pause playback
    this.playerService.pause();

    // Apply fade out if configured
    if (this.config.fadeOutDuration > 0) {
      this.applyFadeOut();
    }

    // Resume after pause duration
    this.pauseTimeout = window.setTimeout(() => {
      if (this.isLooping && this.currentLoop) {
        this.playerService.play();
        this.seekToLoopStart();
      }
    }, this.config.pauseBetweenLoops);
  }

  private completeLoop(): void {
    if (!this.currentLoop) return;

    const completedLoop = this.currentLoop;

    this.emitEvent({
      type: 'loop_completed',
      loop: completedLoop,
      timestamp: Date.now(),
      iteration: completedLoop.currentIteration,
      totalIterations: completedLoop.maxIterations,
    });

    this.stopCurrentLoop();
    this.logger?.info('Loop completed', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        loopId: completedLoop.id,
        finalIteration: completedLoop.currentIteration,
        maxIterations: completedLoop.maxIterations,
        text: completedLoop.text.substring(0, 50),
      },
    });
  }

  public stopCurrentLoop(): void {
    if (!this.isLooping || !this.currentLoop) return;

    const stoppedLoop = this.currentLoop;

    // Clear monitoring and timeouts
    this.clearLoopMonitoring();
    this.clearTimeouts();

    // Reset state
    this.isLooping = false;
    this.currentLoop = null;

    // Restore original volume
    this.playerService.setVolume(this.originalVolume);

    this.emitEvent({
      type: 'loop_cancelled',
      loop: stoppedLoop,
      timestamp: Date.now(),
    });

    this.logger?.info('Stopped loop', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        loopId: stoppedLoop.id,
        iteration: stoppedLoop.currentIteration,
        maxIterations: stoppedLoop.maxIterations,
        text: stoppedLoop.text.substring(0, 50),
      },
    });
  }

  // ========================================
  // Audio Effects
  // ========================================

  private applyFadeIn(): void {
    if (!this.config.fadeInDuration) return;

    const steps = 10;
    const stepDuration = (this.config.fadeInDuration * 1000) / steps;
    const volumeStep = this.originalVolume / steps;

    let currentStep = 0;
    this.playerService.setVolume(0);

    const fadeInterval = setInterval(() => {
      currentStep++;
      const newVolume = Math.min(this.originalVolume, currentStep * volumeStep);
      this.playerService.setVolume(newVolume);

      if (currentStep >= steps) {
        clearInterval(fadeInterval);
      }
    }, stepDuration);
  }

  private applyFadeOut(): void {
    if (!this.config.fadeOutDuration) return;

    const steps = 5;
    const stepDuration = (this.config.fadeOutDuration * 1000) / steps;
    const volumeStep = this.originalVolume / steps;

    let currentStep = 0;

    const fadeInterval = setInterval(() => {
      currentStep++;
      const newVolume = Math.max(0, this.originalVolume - currentStep * volumeStep);
      this.playerService.setVolume(newVolume);

      if (currentStep >= steps) {
        clearInterval(fadeInterval);
      }
    }, stepDuration);
  }

  // ========================================
  // Automatic Looping
  // ========================================

  private handleAutomaticLooping(cue?: ActiveSubtitleCue): void {
    if (!this.config.autoLoop || !cue) return;

    // Create loop from current subtitle cue
    const loop = this.createLoopFromSubtitleId(cue.id);
    if (loop) {
      this.activateLoop(loop);
    }
  }

  // ========================================
  // Public API Methods
  // ========================================

  public getCurrentLoop(): SentenceLoop | null {
    return this.currentLoop;
  }

  public isCurrentlyLooping(): boolean {
    return this.isLooping;
  }

  public getAvailableSentences(): SentenceSelection[] {
    return [...this.availableSentences];
  }

  public getSentenceAtTime(time: number): SentenceSelection | null {
    return SentenceDetector.findSentenceAtTime(this.availableSentences, time);
  }

  public addEventListener(callback: LoopEventCallback): void {
    this.eventListeners.add(callback);
  }

  public removeEventListener(callback: LoopEventCallback): void {
    this.eventListeners.delete(callback);
  }

  // ========================================
  // Utility Methods
  // ========================================

  private clearLoopMonitoring(): void {
    if (this.loopMonitorInterval) {
      clearInterval(this.loopMonitorInterval);
      this.loopMonitorInterval = null;
    }
  }

  private clearTimeouts(): void {
    if (this.pauseTimeout) {
      clearTimeout(this.pauseTimeout);
      this.pauseTimeout = null;
    }

    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout);
      this.fadeTimeout = null;
    }
  }

  private generateLoopId(): string {
    return `loop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private emitEvent(event: LoopEvent): void {
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        this.logger?.error('Event listener error', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            eventType: event.type,
            loopId: event.loop.id,
            timestamp: event.timestamp,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });
  }
}
