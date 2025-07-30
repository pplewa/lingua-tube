/**
 * Enhanced Playback Controls Component for LinguaTube
 * Provides language learning-focused playback controls including segment looping,
 * variable speed control, sentence navigation, and vocabulary integration.
 */

import {
  PlayerInteractionService,
  PlayerEvent,
  PlayerState,
} from '../youtube/PlayerInteractionService';
import { StorageService } from '../storage';
import { UserSettings } from '../storage/types';
import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { VocabularyListManager } from './VocabularyListManager';
import { SentenceLoopingService, SentenceLoop, LoopEvent } from './SentenceLoopingService';
import { Logger } from '../logging';
import { ComponentType } from '../logging/types';

// ========================================
// Types and Interfaces
// ========================================

export interface EnhancedControlsConfig {
  readonly showSpeedControl: boolean;
  readonly showLoopControl: boolean;
  readonly showSentenceNavigation: boolean;
  readonly showVocabularyMode: boolean;
  readonly compactMode: boolean;
  readonly position: 'bottom' | 'top' | 'floating';
  readonly theme: 'dark' | 'light' | 'auto';
  readonly opacity: number; // 0.1-1.0
  readonly autoHide: boolean;
  readonly autoHideDelay: number; // milliseconds
}

/**
 * Enhanced Playback Controls State Interface
 *
 * Manages persistent state for playback controls including speed, loop, and vocabulary mode.
 * Supports auto-resume functionality and state restoration on reload or navigation.
 */
export interface EnhancedControlsState {
  readonly speed: number;
  readonly loop: LoopSegment | null;
  readonly vocabularyMode: boolean;
  readonly vocabularyListVisible: boolean;
  readonly lastVideoId: string | null;
  readonly lastPosition: number;
  readonly sessionStartTime: number;
  readonly totalWatchTime: number;
  readonly loopCount: number;
  readonly speedChanges: number;
}

export interface LoopSegment {
  readonly startTime: number;
  readonly endTime: number;
  readonly id: string;
  readonly title?: string;
  readonly isActive: boolean;
}

export interface PlaybackSpeed {
  readonly value: number;
  readonly label: string;
  readonly isDefault: boolean;
}

export interface ControlsEventData {
  readonly type:
    | 'speed_change'
    | 'loop_toggle'
    | 'sentence_nav'
    | 'vocabulary_mode'
    | 'vocabulary_list'
    | 'vocabulary_navigation' // New event type for vocabulary-specific navigation
    | 'subtitle_highlight'    // New event type for subtitle highlighting
    | 'fullscreen_change';
  readonly value: any;
  readonly timestamp: number;
  readonly metadata?: Record<string, any>; // Additional event metadata
}

export type ControlsEventCallback = (event: ControlsEventData) => void;

/**
 * Enhanced Playback Controls API Interface
 *
 * Comprehensive API for programmatic control of enhanced YouTube playback features.
 * Enables external systems to control speed, looping, navigation, and vocabulary modes.
 */
export interface EnhancedPlaybackControlsAPI {
  // ========================================
  // Initialization & State
  // ========================================

  /** Check if the controls are ready for use */
  isReady(): boolean;

  /** Get current component state including all settings and modes */
  getState(): {
    isReady: boolean;
    isVisible: boolean;
    currentSpeed: number;
    currentLoop: LoopSegment | null;
    vocabularyModeActive: boolean;
    config: EnhancedControlsConfig;
  };

  /** Get current configuration */
  getConfig(): EnhancedControlsConfig;

  /** Update configuration with new settings */
  updateConfig(newConfig: Partial<EnhancedControlsConfig>): void;

  // ========================================
  // Visibility Control
  // ========================================

  /** Check if controls are currently visible */
  getVisibility(): boolean;

  /** Check if player is in fullscreen mode */
  isFullscreen(): boolean;

  /** Show the controls */
  show(): void;

  /** Hide the controls */
  hide(): void;

  /** Toggle controls visibility */
  toggle(): void;

  // ========================================
  // Speed Control
  // ========================================

  /** Get current playback speed */
  getCurrentSpeed(): number;

  /** Set playback speed to specific value (0.25x - 2.0x) */
  setSpeed(speed: number): void;

  /** Adjust speed by delta amount (e.g., +0.25 or -0.25) */
  adjustSpeedBy(delta: number): void;

  /** Reset speed to normal (1.0x) */
  resetSpeedToNormal(): void;

  /** Get all available speed presets */
  getAvailableSpeeds(): PlaybackSpeed[];

  // ========================================
  // Loop Control
  // ========================================

  /** Get current loop segment if active */
  getCurrentLoop(): LoopSegment | null;

  /** Create a custom loop with specified start/end times */
  createCustomLoop(startTime?: number, endTime?: number): LoopSegment | null;

  /** Remove the current loop */
  removeLoop(): boolean;

  /** Toggle loop on/off */
  toggleCurrentLoop(): LoopSegment | null;

  // ========================================
  // Navigation Control
  // ========================================

  /** Navigate to previous sentence */
  navigateToPreviousSentence(): void;

  /** Navigate to next sentence */
  navigateToNextSentence(): void;

  /** Skip backward by specified seconds (default: 5) */
  skipBackward(seconds?: number): void;

  /** Skip forward by specified seconds (default: 5) */
  skipForward(seconds?: number): void;

  /** Jump to specific subtitle by ID */
  jumpToSubtitle(subtitleId: string): void;

  /** Jump to specific percentage of video (0-100) */
  jumpToVideoPercentage(percentage: number): void;

  /** Replay current sentence from beginning */
  replaySentence(): void;

  // ========================================
  // Vocabulary Mode
  // ========================================

  /** Check if vocabulary mode is active */
  isVocabularyModeActive(): boolean;

  /** Set vocabulary mode state */
  setVocabularyModeState(active: boolean): void;

  /** Toggle vocabulary mode on/off */
  toggleVocabularyModeState(): boolean;

  // ========================================
  // Vocabulary List Management
  // ========================================

  /** Check if vocabulary list is currently visible */
  isVocabularyListVisible(): boolean;

  /** Show the vocabulary list */
  showVocabularyList(): Promise<boolean>;

  /** Hide the vocabulary list */
  hideVocabularyList(): void;

  /** Toggle vocabulary list visibility */
  toggleVocabularyList(): void;

  /** Get vocabulary list manager instance for advanced operations */
  getVocabularyListManager(): VocabularyListManager;

  // ========================================
  // Event System
  // ========================================

  /** Add event listener for control events */
  addEventListener(callback: ControlsEventCallback): void;

  /** Remove event listener */
  removeEventListener(callback: ControlsEventCallback): void;

  // ========================================
  // Cleanup
  // ========================================

  /** Destroy the component and clean up resources */
  destroy(): Promise<void>;

  // ========================================
  // Enhanced Navigation for Vocabulary Integration
  // ========================================

  /** Get current video time for enhanced navigation calculations */
  getCurrentVideoTime(): number;

  /** Get video duration for enhanced navigation calculations */
  getVideoDuration(): number;

  /** Get current video ID for navigation validation */
  getVideoId(): string | undefined;

  /** Enhanced subtitle navigation with sentence context and optional auto-loop */
  jumpToSubtitleWithContext(subtitleId: string, options?: {
    bufferTime?: number;
    highlightDuration?: number;
    enableAutoLoop?: boolean;
  }): boolean;

  /** Navigate to the sentence containing a specific vocabulary word */
  jumpToVocabularyWord(word: string, options?: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    bufferTime?: number;
  }): boolean;
}

// ========================================
// Constants and Default Configuration
// ========================================

const DEFAULT_CONFIG: EnhancedControlsConfig = {
  showSpeedControl: true,
  showLoopControl: true,
  showSentenceNavigation: true,
  showVocabularyMode: true,
  compactMode: false,
  position: 'bottom',
  theme: 'dark',
  opacity: 0.9,
  autoHide: true,
  autoHideDelay: 3000,
};

const PLAYBACK_SPEEDS: PlaybackSpeed[] = [
  { value: 0.25, label: '0.25×', isDefault: false },
  { value: 0.5, label: '0.5×', isDefault: false },
  { value: 0.75, label: '0.75×', isDefault: false },
  { value: 1.0, label: '1×', isDefault: true },
  { value: 1.25, label: '1.25×', isDefault: false },
  { value: 1.5, label: '1.5×', isDefault: false },
  { value: 1.75, label: '1.75×', isDefault: false },
  { value: 2.0, label: '2×', isDefault: false },
];

const CONTROLS_STYLES = `
  :host {
    /* CSS Custom Properties */
    --controls-bg-color: rgba(0, 0, 0, 0.8);
    --controls-text-color: #ffffff;
    --controls-accent-color: #ff4444;
    --controls-hover-color: #ff6666;
    --controls-border-radius: 8px;
    --controls-padding: 12px;
    --controls-gap: 8px;
    --controls-button-size: 36px;
    --controls-opacity: 0.9;
    --controls-transition: all 0.3s ease;
    
    /* Basic styling - positioning handled by controls-container */
    font-family: 'YouTube Sans', 'Roboto', sans-serif;
    font-size: 14px;
    pointer-events: none;
  }

  .controls-container {
    display: flex;
    align-items: center;
    gap: var(--controls-gap);
    background: var(--controls-bg-color);
    border-radius: var(--controls-border-radius);
    padding: var(--controls-padding);
    opacity: var(--controls-opacity);
    pointer-events: auto;
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646;
  }

  .controls-container.compact {
    padding: 8px;
    gap: 6px;
  }

  .controls-container.hidden {
    opacity: 0;
    pointer-events: none;
    transform: translateY(10px);
  }

  .controls-container.floating {
    position: fixed;
    bottom: 20px;
    right: 20px;
    left: auto;
    transform: none;
  }

  .controls-container.position-top {
    bottom: auto;
    top: 20px;
  }

  .controls-container.position-bottom {
    /* Default positioning - no override needed */
  }

  /* Control Groups */
  .control-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .control-group:not(:last-child)::after {
    content: '';
    width: 1px;
    height: 24px;
    background: rgba(255, 255, 255, 0.2);
    margin: 0 4px;
  }

  /* Buttons */
  .control-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--controls-button-size);
    height: var(--controls-button-size);
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--controls-text-color);
    cursor: pointer;
    transition: var(--controls-transition);
    font-size: 16px;
    position: relative;
    overflow: hidden;
  }

  .control-button:hover {
    background: rgba(255, 255, 255, 0.1);
    transform: scale(1.05);
  }

  .control-button:active {
    transform: scale(0.95);
  }

  .control-button.active {
    background: var(--controls-accent-color);
    color: white;
    box-shadow: 0 0 8px rgba(255, 68, 68, 0.4);
  }

  .control-button.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .control-button.disabled:hover {
    background: transparent;
    transform: none;
  }

  /* Button Click Ripple Effect */
  .control-button::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
    transform: translate(-50%, -50%);
    transition: width 0.3s ease, height 0.3s ease, opacity 0.3s ease;
    opacity: 0;
    pointer-events: none;
  }

  .control-button.clicked::after {
    width: 100%;
    height: 100%;
    opacity: 1;
  }

  /* Speed Control */
  .speed-control {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .speed-button {
    min-width: 50px;
    height: 28px;
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    color: var(--controls-text-color);
    font-size: 12px;
    cursor: pointer;
    transition: var(--controls-transition);
    position: relative;
  }

  .speed-button:hover {
    background: rgba(255, 255, 255, 0.2);
    transform: translateY(-1px);
  }

  .speed-button.active {
    background: var(--controls-accent-color);
    border-color: var(--controls-accent-color);
    box-shadow: 0 0 6px rgba(255, 68, 68, 0.3);
  }

  .speed-button.changed {
    animation: speedChange 0.5s ease;
  }

  @keyframes speedChange {
    0% { transform: scale(1); }
    50% { transform: scale(1.1); background: rgba(255, 255, 255, 0.3); }
    100% { transform: scale(1); }
  }

  /* Loop Control */
  .loop-control {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .loop-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    font-size: 11px;
    color: var(--controls-text-color);
    transition: var(--controls-transition);
  }

  .loop-indicator.active {
    background: var(--controls-accent-color);
    animation: pulse 2s infinite;
    box-shadow: 0 0 8px rgba(255, 68, 68, 0.4);
  }

  .loop-indicator.creating {
    animation: loopCreating 0.8s ease;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  @keyframes loopCreating {
    0% { transform: scale(1); background: rgba(255, 255, 255, 0.1); }
    50% { transform: scale(1.05); background: var(--controls-accent-color); }
    100% { transform: scale(1); background: var(--controls-accent-color); }
  }

  /* Navigation Controls */
  .nav-control {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .nav-control .control-button.navigating {
    animation: navigationFeedback 0.4s ease;
  }

  @keyframes navigationFeedback {
    0% { transform: scale(1); }
    50% { transform: scale(0.9); background: rgba(255, 255, 255, 0.2); }
    100% { transform: scale(1); }
  }

  /* Vocabulary Mode */
  .vocabulary-mode {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .vocabulary-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(76, 175, 80, 0.2);
    border: 1px solid rgba(76, 175, 80, 0.4);
    border-radius: 4px;
    font-size: 11px;
    color: #4caf50;
    transition: var(--controls-transition);
  }

  .vocabulary-indicator.active {
    background: rgba(76, 175, 80, 0.8);
    color: white;
    box-shadow: 0 0 6px rgba(76, 175, 80, 0.4);
  }

  .vocabulary-indicator.toggling {
    animation: vocabularyToggle 0.6s ease;
  }

  @keyframes vocabularyToggle {
    0% { transform: scale(1); }
    25% { transform: scale(1.1); }
    50% { transform: scale(0.95); }
    75% { transform: scale(1.05); }
    100% { transform: scale(1); }
  }

  /* Action Feedback Toast */
  .action-toast {
    position: absolute;
    top: -50px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease, transform 0.3s ease;
    z-index: 1000;
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .action-toast.show {
    opacity: 1;
    transform: translateX(-50%) translateY(-5px);
  }

  .action-toast.success {
    background: rgba(76, 175, 80, 0.9);
    border-color: rgba(76, 175, 80, 0.4);
  }

  .action-toast.warning {
    background: rgba(255, 152, 0, 0.9);
    border-color: rgba(255, 152, 0, 0.4);
  }

  .action-toast.error {
    background: rgba(244, 67, 54, 0.9);
    border-color: rgba(244, 67, 54, 0.4);
  }

  /* State Indicator Dots */
  .state-indicators {
    position: absolute;
    top: -8px;
    right: 8px;
    display: flex;
    gap: 4px;
  }

  .state-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
    transition: var(--controls-transition);
  }

  .state-dot.active {
    background: var(--controls-accent-color);
    box-shadow: 0 0 4px rgba(255, 68, 68, 0.6);
  }

  .state-dot.vocabulary {
    background: #4caf50;
  }

  .state-dot.loop {
    background: #ff9800;
    animation: pulse 1.5s infinite;
  }

  .state-dot.speed {
    background: #2196f3;
  }

  /* Theme Variations */
  :host(.theme-light) {
    --controls-bg-color: rgba(255, 255, 255, 0.9);
    --controls-text-color: #333333;
    --controls-accent-color: #1976d2;
    --controls-hover-color: #42a5f5;
  }

  :host(.theme-auto) {
    --controls-bg-color: rgba(0, 0, 0, 0.8);
    --controls-text-color: #ffffff;
  }

  @media (prefers-color-scheme: light) {
    :host(.theme-auto) {
      --controls-bg-color: rgba(255, 255, 255, 0.9);
      --controls-text-color: #333333;
    }
  }

  /* Responsive Design */
  @media (max-width: 768px) {
    :host {
      bottom: 50px;
    }
    
    .controls-container {
      padding: 8px;
      gap: 6px;
    }
    
    .control-button {
      width: 32px;
      height: 32px;
      font-size: 14px;
    }
    
    .speed-button {
      min-width: 40px;
      height: 24px;
      font-size: 11px;
    }

    .action-toast {
      font-size: 11px;
      padding: 6px 10px;
    }
  }

  /* Fullscreen Mode Support */
  :host(.fullscreen-mode) {
    /* Fullscreen styling handled by JavaScript positioning */
  }

  :host(.fullscreen-mode) .controls-container {
    background: rgba(0, 0, 0, 0.9);
    backdrop-filter: blur(6px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    padding: 14px;
    gap: 10px;
  }

  :host(.fullscreen-mode) .control-button {
    width: 40px;
    height: 40px;
    font-size: 18px;
  }

  :host(.fullscreen-mode) .speed-button {
    min-width: 55px;
    height: 32px;
    font-size: 13px;
    padding: 0 10px;
  }

  /* Accessibility */
  @media (prefers-reduced-motion: reduce) {
    .controls-container,
    .control-button,
    .speed-button,
    .loop-indicator,
    .vocabulary-indicator,
    .action-toast {
      transition: none;
      animation: none;
    }
    
    .loop-indicator.active {
      animation: none;
    }

    .state-dot.loop {
      animation: none;
    }
  }

  @media (prefers-contrast: high) {
    .controls-container {
      border: 2px solid #ffffff;
      background: rgba(0, 0, 0, 0.95);
    }
    
    .control-button:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .action-toast {
      border: 2px solid;
    }
  }

  /* Tooltips */
  .control-button[title]:hover::before {
    content: attr(title);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    z-index: 1000;
    margin-bottom: 4px;
    opacity: 0;
    animation: tooltipFadeIn 0.3s ease forwards;
  }

  @keyframes tooltipFadeIn {
    from { opacity: 0; transform: translateX(-50%) translateY(5px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
`;

// ========================================
// Enhanced Playback Controls Component
// ========================================

export class EnhancedPlaybackControlsComponent implements EnhancedPlaybackControlsAPI {
  private container: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private controlsContainer: HTMLElement | null = null;

  private config: EnhancedControlsConfig = { ...DEFAULT_CONFIG };
  private isVisible: boolean = true;
  private isInitialized: boolean = false;
  private autoHideTimeout: number | null = null;

  private playerService: PlayerInteractionService;
  private storageService: StorageService;
  private vocabularyManager: VocabularyManager;
  private vocabularyListManager: VocabularyListManager;
  private sentenceLoopingService: SentenceLoopingService;

  private currentSpeed: number = 1.0;
  private currentLoop: LoopSegment | null = null;
  private vocabularyModeActive: boolean = false;
  private vocabularyListVisible: boolean = false;

  // State management
  private currentState: EnhancedControlsState;
  private stateUpdateInterval: number | null = null;
  private autoResumeEnabled: boolean = true;
  private currentVideoId: string | null = null;

  // Event system
  private eventListeners: Set<ControlsEventCallback> = new Set();
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;

  // Fullscreen support
  private isFullscreenMode: boolean = false;
  private fullscreenObserver: MutationObserver | null = null;
  private fullscreenChangeHandler: () => void;

  // Player integration
  private playerEventHandlers: Map<string, (event: any) => void> = new Map();
  private keyboardShortcuts: Map<string, () => void> = new Map();
  private keyboardEventHandler: (event: KeyboardEvent) => void;
  private readonly logger = Logger.getInstance();

  constructor(
    playerService: PlayerInteractionService,
    storageService: StorageService,
    initialConfig?: Partial<EnhancedControlsConfig>,
  ) {
    this.playerService = playerService;
    this.storageService = storageService;
    this.vocabularyManager = VocabularyManager.getInstance();
    this.vocabularyListManager = VocabularyListManager.getInstance();
    this.sentenceLoopingService = new SentenceLoopingService(playerService, storageService);
    this.keyboardEventHandler = this.handleKeyboardEvent.bind(this);

    // Initialize state
    this.currentState = {
      speed: 1.0,
      loop: null,
      vocabularyMode: false,
      vocabularyListVisible: false,
      lastVideoId: null,
      lastPosition: 0,
      sessionStartTime: Date.now(),
      totalWatchTime: 0,
      loopCount: 0,
      speedChanges: 0,
    };

    if (initialConfig) {
      this.config = { ...this.config, ...initialConfig };
    }

    this.loadConfigFromStorage();
    this.setupPlayerEventHandlers();

    // Initialize keyboard event handler
    this.keyboardEventHandler = this.handleKeyboardEvent.bind(this);

    // Initialize fullscreen change handler
    this.fullscreenChangeHandler = this.handleFullscreenChange.bind(this);
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  public async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) {
        this.logger?.warn('Already initialized', {
          component: ComponentType.YOUTUBE_INTEGRATION,
        });
        return true;
      }

      // Find YouTube player container
      const playerContainer = this.findPlayerContainer();
      if (!playerContainer) {
        this.logger?.error('Could not find YouTube player container', {
          component: ComponentType.YOUTUBE_INTEGRATION,
        });
        return false;
      }

      // Create container element
      this.container = this.createContainer();
      if (!this.container) {
        this.logger?.error('Failed to create container', {
          component: ComponentType.YOUTUBE_INTEGRATION,
        });
        return false;
      }

      // Attach to player
      playerContainer.appendChild(this.container);

      // Create shadow DOM and content
      this.createShadowDOM();
      this.createControlElements();
      this.applyConfiguration();

      // Setup observers for dynamic content
      this.setupResizeObserver();
      this.setupMutationObserver();
      this.setupFullscreenObserver();
      this.setupPlayerEventListeners();
      this.setupInteractionHandlers();

      // Initialize sentence looping service
      const loopServiceInitialized = await this.sentenceLoopingService.initialize();
      if (!loopServiceInitialized) {
        this.logger?.warn('Failed to initialize sentence looping service', {
          component: ComponentType.YOUTUBE_INTEGRATION,
        });
      }

      // Set up sentence looping event listeners
      this.setupSentenceLoopingListeners();

      // Initialize vocabulary list manager
      await this.vocabularyListManager.initialize();
      this.vocabularyListManager.setEnhancedPlaybackControls(this);
      this.vocabularyListManager.setupCrossComponentSync();

      // Set up keyboard shortcuts
      this.setupKeyboardShortcuts();

      // Load saved state and start state tracking
      await this.loadState();
      this.startStateTracking();

      // Update initial visual feedback state
      this.updateStateIndicators();

      // Ensure controls are initially visible and properly trigger auto-hide system
      this.show();
      if (this.config.autoHide) {
        this.resetAutoHide();
      }

      this.isInitialized = true;
      this.logger?.info('Initialized successfully', {
        component: ComponentType.YOUTUBE_INTEGRATION,
      });
      return true;
    } catch (error) {
      this.logger?.error('Initialization failed', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  public async destroy(): Promise<void> {
    try {
      // Remove player event listeners
      this.removePlayerEventListeners();

      // Clean up observers
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }

      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }

      // Clean up fullscreen observer
      this.removeFullscreenObserver();

      // Clear auto-hide timeout
      if (this.autoHideTimeout) {
        clearTimeout(this.autoHideTimeout);
        this.autoHideTimeout = null;
      }

      // Remove DOM elements
      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }

      // Clear references
      this.container = null;
      this.shadowRoot = null;
      this.controlsContainer = null;

      // Clear listeners
      this.eventListeners.clear();
      this.playerEventHandlers.clear();

      // Clean up keyboard shortcuts
      this.removeKeyboardShortcuts();

      // Clean up vocabulary list manager
      if (this.vocabularyListManager) {
        this.vocabularyListManager.hide();
      }

      // Stop state tracking and save final state
      this.stopStateTracking();
      await this.saveState();

      this.isInitialized = false;
      this.logger?.info('Destroyed successfully', {
        component: ComponentType.YOUTUBE_INTEGRATION,
      });
    } catch (error) {
      this.logger?.error('Destroy failed', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private findPlayerContainer(): HTMLElement | null {
    const selectors = [
      '#movie_player',
      '.html5-video-player',
      '[data-layer="0"]',
      '.ytp-player-content',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector) as HTMLElement;
      if (element && this.isValidPlayerContainer(element)) {
        return element;
      }
    }

    return null;
  }

  private isValidPlayerContainer(element: HTMLElement): boolean {
    return (
      element.offsetWidth > 0 && element.offsetHeight > 0 && element.querySelector('video') !== null
    );
  }

  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'linguatube-enhanced-controls';
    container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
    `;
    return container;
  }

  private createShadowDOM(): void {
    if (!this.container) return;

    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    // Create and inject styles
    const styleSheet = document.createElement('style');
    styleSheet.textContent = CONTROLS_STYLES;
    this.shadowRoot.appendChild(styleSheet);
  }

  private createControlElements(): void {
    if (!this.shadowRoot) return;

    // Create main controls container
    this.controlsContainer = document.createElement('div');
    this.controlsContainer.className = 'controls-container';

    // Create control groups
    if (this.config.showSpeedControl) {
      this.controlsContainer.appendChild(this.createSpeedControl());
    }

    if (this.config.showLoopControl) {
      this.controlsContainer.appendChild(this.createLoopControl());
    }

    if (this.config.showSentenceNavigation) {
      this.controlsContainer.appendChild(this.createNavigationControl());
    }

    if (this.config.showVocabularyMode) {
      this.controlsContainer.appendChild(this.createVocabularyControl());
    }

    // Create visual feedback elements
    this.createFeedbackElements();

    this.shadowRoot.appendChild(this.controlsContainer);
  }

  // ========================================
  // Control Element Creation
  // ========================================

  private createSpeedControl(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'control-group speed-control';

    // Speed decrease button
    const decreaseBtn = document.createElement('button');
    decreaseBtn.className = 'control-button';
    decreaseBtn.innerHTML = '⏪';
    decreaseBtn.title = 'Decrease Speed';
    decreaseBtn.addEventListener('click', () => this.adjustSpeed(-0.25));

    // Current speed display
    const speedDisplay = document.createElement('button');
    speedDisplay.className = 'speed-button active';
    speedDisplay.textContent = '1×';
    speedDisplay.title = 'Current Speed';
    speedDisplay.addEventListener('click', () => this.resetSpeed());

    // Speed increase button
    const increaseBtn = document.createElement('button');
    increaseBtn.className = 'control-button';
    increaseBtn.innerHTML = '⏩';
    increaseBtn.title = 'Increase Speed';
    increaseBtn.addEventListener('click', () => this.adjustSpeed(0.25));

    group.appendChild(decreaseBtn);
    group.appendChild(speedDisplay);
    group.appendChild(increaseBtn);

    return group;
  }

  private createLoopControl(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'control-group loop-control';

    // Loop toggle button
    const loopBtn = document.createElement('button');
    loopBtn.className = 'control-button';
    loopBtn.innerHTML = '🔁';
    loopBtn.title = 'Toggle Loop';
    loopBtn.addEventListener('click', () => this.toggleLoop());

    // Loop indicator
    const loopIndicator = document.createElement('div');
    loopIndicator.className = 'loop-indicator';
    loopIndicator.textContent = 'No Loop';

    group.appendChild(loopBtn);
    group.appendChild(loopIndicator);

    return group;
  }

  private createNavigationControl(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'control-group nav-control';

    // 5-second backward skip
    const skip5BackBtn = document.createElement('button');
    skip5BackBtn.className = 'control-button skip-button';
    skip5BackBtn.innerHTML = '⏪5s';
    skip5BackBtn.title = 'Skip Back 5 Seconds';
    skip5BackBtn.addEventListener('click', () => {
      this.showButtonClickFeedback(skip5BackBtn);
      this.skipTime(-5);
    });

    // Previous sentence button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'control-button';
    prevBtn.innerHTML = '⏮';
    prevBtn.title = 'Previous Sentence';
    prevBtn.addEventListener('click', () => {
      this.showButtonClickFeedback(prevBtn);
      this.showNavigationFeedback(prevBtn);
      this.navigateSentence('previous');
    });

    // Replay current sentence button
    const replayBtn = document.createElement('button');
    replayBtn.className = 'control-button replay-button';
    replayBtn.innerHTML = '🔄';
    replayBtn.title = 'Replay Current Sentence';
    replayBtn.addEventListener('click', () => {
      this.showButtonClickFeedback(replayBtn);
      this.replayCurrentSentence();
    });

    // Next sentence button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'control-button';
    nextBtn.innerHTML = '⏭';
    nextBtn.title = 'Next Sentence';
    nextBtn.addEventListener('click', () => {
      this.showButtonClickFeedback(nextBtn);
      this.showNavigationFeedback(nextBtn);
      this.navigateSentence('next');
    });

    // 5-second forward skip
    const skip5ForwardBtn = document.createElement('button');
    skip5ForwardBtn.className = 'control-button skip-button';
    skip5ForwardBtn.innerHTML = '5s⏩';
    skip5ForwardBtn.title = 'Skip Forward 5 Seconds';
    skip5ForwardBtn.addEventListener('click', () => {
      this.showButtonClickFeedback(skip5ForwardBtn);
      this.skipTime(5);
    });

    group.appendChild(skip5BackBtn);
    group.appendChild(prevBtn);
    group.appendChild(replayBtn);
    group.appendChild(nextBtn);
    group.appendChild(skip5ForwardBtn);

    return group;
  }

  private createVocabularyControl(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'control-group vocabulary-mode';

    // Vocabulary mode toggle
    const vocabBtn = document.createElement('button');
    vocabBtn.className = 'control-button vocabulary-mode-btn';
    vocabBtn.innerHTML = '📚';
    vocabBtn.title = 'Toggle Vocabulary Mode';
    vocabBtn.addEventListener('click', () => this.toggleVocabularyMode());

    // Vocabulary list toggle
    const vocabListBtn = document.createElement('button');
    vocabListBtn.className = 'control-button vocabulary-list-btn';
    vocabListBtn.innerHTML = '📝';
    vocabListBtn.title = 'Toggle Vocabulary List';
    vocabListBtn.addEventListener('click', () => this.toggleVocabularyList());

    // Vocabulary indicator
    const vocabIndicator = document.createElement('div');
    vocabIndicator.className = 'vocabulary-indicator';
    vocabIndicator.textContent = 'Normal';

    group.appendChild(vocabBtn);
    group.appendChild(vocabListBtn);
    group.appendChild(vocabIndicator);

    return group;
  }


  private createFeedbackElements(): void {
    if (!this.controlsContainer) return;

    // Create action toast for notifications
    const actionToast = document.createElement('div');
    actionToast.className = 'action-toast';
    this.controlsContainer.appendChild(actionToast);

    // Create state indicator dots
    const stateIndicators = document.createElement('div');
    stateIndicators.className = 'state-indicators';

    // Speed state dot
    const speedDot = document.createElement('div');
    speedDot.className = 'state-dot speed';
    speedDot.title = 'Speed Control Active';
    stateIndicators.appendChild(speedDot);

    // Loop state dot
    const loopDot = document.createElement('div');
    loopDot.className = 'state-dot loop';
    loopDot.title = 'Loop Active';
    stateIndicators.appendChild(loopDot);

    // Vocabulary state dot
    const vocabularyDot = document.createElement('div');
    vocabularyDot.className = 'state-dot vocabulary';
    vocabularyDot.title = 'Vocabulary Mode Active';
    stateIndicators.appendChild(vocabularyDot);

    this.controlsContainer.appendChild(stateIndicators);
  }

  // ========================================
  // Visual Feedback Methods
  // ========================================

  private showActionToast(
    message: string,
    type: 'success' | 'warning' | 'error' = 'success',
    duration: number = 2000,
  ): void {
    if (!this.shadowRoot) return;

    const toast = this.shadowRoot.querySelector('.action-toast') as HTMLElement;
    if (!toast) return;

    // Clear any existing classes and content
    toast.className = 'action-toast';
    toast.textContent = message;

    // Add type class and show
    toast.classList.add(type, 'show');

    // Auto-hide after duration
    setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  private showButtonClickFeedback(button: HTMLElement): void {
    if (!button) return;

    button.classList.add('clicked');

    // Remove the class after animation completes
    setTimeout(() => {
      button.classList.remove('clicked');
    }, 300);
  }

  private showNavigationFeedback(button: HTMLElement): void {
    if (!button) return;

    button.classList.add('navigating');

    setTimeout(() => {
      button.classList.remove('navigating');
    }, 400);
  }

  private showSpeedChangeFeedback(): void {
    if (!this.shadowRoot) return;

    const speedButton = this.shadowRoot.querySelector('.speed-button') as HTMLElement;
    if (!speedButton) return;

    speedButton.classList.add('changed');

    setTimeout(() => {
      speedButton.classList.remove('changed');
    }, 500);
  }

  private showLoopCreationFeedback(): void {
    if (!this.shadowRoot) return;

    const loopIndicator = this.shadowRoot.querySelector('.loop-indicator') as HTMLElement;
    if (!loopIndicator) return;

    loopIndicator.classList.add('creating');

    setTimeout(() => {
      loopIndicator.classList.remove('creating');
    }, 800);
  }

  private showVocabularyToggleFeedback(): void {
    if (!this.shadowRoot) return;

    const vocabularyIndicator = this.shadowRoot.querySelector(
      '.vocabulary-indicator',
    ) as HTMLElement;
    if (!vocabularyIndicator) return;

    vocabularyIndicator.classList.add('toggling');

    setTimeout(() => {
      vocabularyIndicator.classList.remove('toggling');
    }, 600);
  }

  private updateStateIndicators(): void {
    if (!this.shadowRoot) return;

    // Update speed state dot
    const speedDot = this.shadowRoot.querySelector('.state-dot.speed') as HTMLElement;
    if (speedDot) {
      if (this.currentSpeed !== 1.0) {
        speedDot.classList.add('active');
        speedDot.title = `Speed: ${this.currentSpeed}×`;
      } else {
        speedDot.classList.remove('active');
        speedDot.title = 'Speed Control Active';
      }
    }

    // Update loop state dot
    const loopDot = this.shadowRoot.querySelector('.state-dot.loop') as HTMLElement;
    if (loopDot) {
      if (this.currentLoop) {
        loopDot.classList.add('active');
        loopDot.title = `Loop: ${this.currentLoop.title || 'Active'}`;
      } else {
        loopDot.classList.remove('active');
        loopDot.title = 'Loop Active';
      }
    }

    // Update vocabulary state dot
    const vocabularyDot = this.shadowRoot.querySelector('.state-dot.vocabulary') as HTMLElement;
    if (vocabularyDot) {
      if (this.vocabularyModeActive) {
        vocabularyDot.classList.add('active');
        vocabularyDot.title = 'Vocabulary Mode: ON';
      } else {
        vocabularyDot.classList.remove('active');
        vocabularyDot.title = 'Vocabulary Mode Active';
      }
    }
  }



  // ========================================
  // Configuration and Settings
  // ========================================

  private async loadConfigFromStorage(): Promise<void> {
    try {
      const result = await this.storageService.getSettings();
      if (result.success && result.data) {
        this.updateConfigFromSettings(result.data);
      }
    } catch (error) {
      this.logger?.warn('Failed to load config from storage', {
        component: ComponentType.YOUTUBE_INTEGRATION,
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
      theme: settings.ui.theme as 'dark' | 'light' | 'auto',
      compactMode: settings.ui.compactMode || false,
    };

    if (this.isInitialized) {
      this.applyConfiguration();
    }
  }

  private applyConfiguration(): void {
    if (!this.shadowRoot || !this.controlsContainer) return;

    // Apply theme
    const root = this.shadowRoot.host as HTMLElement;
    root.className = `theme-${this.config.theme}`;

    // Apply opacity
    root.style.setProperty('--controls-opacity', this.config.opacity.toString());

    // Apply compact mode
    if (this.config.compactMode) {
      this.controlsContainer.classList.add('compact');
    } else {
      this.controlsContainer.classList.remove('compact');
    }

    // Apply position
    this.updateControlsPosition();

    // Set up auto-hide if enabled
    if (this.config.autoHide) {
      this.setupAutoHide();
    }
  }

  private updateControlsPosition(): void {
    if (!this.controlsContainer) return;

    // Reset all position classes
    this.controlsContainer.classList.remove('floating', 'position-top', 'position-bottom');

    // Apply position class based on config
    switch (this.config.position) {
      case 'top':
        this.controlsContainer.classList.add('position-top');
        break;
      case 'floating':
        this.controlsContainer.classList.add('floating');
        break;
      case 'bottom':
      default:
        this.controlsContainer.classList.add('position-bottom');
        break;
    }
  }

  // ========================================
  // Control Logic Implementation
  // ========================================

  private adjustSpeed(delta: number): void {
    const newSpeed = Math.max(0.25, Math.min(2.0, this.currentSpeed + delta));
    this.setPlaybackSpeed(newSpeed);
  }

  private resetSpeed(): void {
    this.setPlaybackSpeed(1.0);
  }

  private setPlaybackSpeed(speed: number): void {
    try {
      this.playerService.setPlaybackRate(speed);
      this.currentSpeed = speed;
      this.updateSpeedDisplay();

      // Update state tracking
      this.updateCurrentState();

      // Show visual feedback
      this.showSpeedChangeFeedback();
      this.showActionToast(`Speed: ${speed}×`, 'success', 1500);
      this.updateStateIndicators();

      this.emitEvent({
        type: 'speed_change',
        value: speed,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger?.error('Failed to set playback speed', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          speed,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.showActionToast('Failed to change speed', 'error');
    }
  }

  private updateSpeedDisplay(): void {
    if (!this.shadowRoot) return;

    const speedDisplay = this.shadowRoot.querySelector('.speed-button');
    if (speedDisplay) {
      speedDisplay.textContent = `${this.currentSpeed}×`;
    }
  }

  private toggleLoop(): void {
    if (this.currentLoop) {
      this.clearLoop();
    } else {
      this.createLoop();
    }
  }

  private createLoop(): void {
    try {
      const currentTime = this.playerService.getCurrentTime();
      const duration = this.playerService.getDuration();

      // Create a 10-second loop around current time
      const loopStart = Math.max(0, currentTime - 5);
      const loopEnd = Math.min(duration, currentTime + 5);

      this.currentLoop = {
        id: `loop_${Date.now()}`,
        startTime: loopStart,
        endTime: loopEnd,
        isActive: true,
        title: `Loop ${this.formatTime(loopStart)} - ${this.formatTime(loopEnd)}`,
      };

      this.playerService.createSegmentLoop(loopStart, loopEnd);
      this.updateLoopDisplay();

      // Update state tracking
      this.updateCurrentState();

      // Show visual feedback
      this.showLoopCreationFeedback();
      this.showActionToast(`Loop created: ${this.currentLoop.title}`, 'success', 2000);
      this.updateStateIndicators();

      this.emitEvent({
        type: 'loop_toggle',
        value: this.currentLoop,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger?.error('Failed to create loop', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          currentTime: this.playerService.getCurrentTime(),
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.showActionToast('Failed to create loop', 'error');
    }
  }

  private clearLoop(): void {
    try {
      this.playerService.stopSegmentLoop();
      this.currentLoop = null;
      this.updateLoopDisplay();

      // Update state tracking
      this.updateCurrentState();

      // Show visual feedback
      this.showActionToast('Loop removed', 'success', 1500);
      this.updateStateIndicators();

      this.emitEvent({
        type: 'loop_toggle',
        value: null,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger?.error('Failed to clear loop in clearLoop method', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      this.showActionToast('Failed to remove loop', 'error');
    }
  }

  private updateLoopDisplay(): void {
    if (!this.shadowRoot) return;

    const loopIndicator = this.shadowRoot.querySelector('.loop-indicator');
    const loopBtn = this.shadowRoot.querySelector('.loop-control .control-button');

    if (loopIndicator && loopBtn) {
      if (this.currentLoop) {
        loopIndicator.textContent = this.currentLoop.title || 'Active Loop';
        loopIndicator.classList.add('active');
        loopBtn.classList.add('active');
      } else {
        loopIndicator.textContent = 'No Loop';
        loopIndicator.classList.remove('active');
        loopBtn.classList.remove('active');
      }
    }
  }

  private navigateSentence(direction: 'previous' | 'next'): void {
    try {
      const currentTime = this.playerService.getCurrentTime();
      let targetTime: number;

      // Try to use sentence looping service for intelligent navigation
      if (this.sentenceLoopingService && this.isInitialized) {
        const sentences = this.sentenceLoopingService.getAvailableSentences();
        const currentSentence = this.sentenceLoopingService.getSentenceAtTime(currentTime);

        if (sentences.length > 0) {
          const currentIndex = currentSentence
            ? sentences.findIndex((s) => s.startIndex === currentSentence.startIndex)
            : -1;
          let targetIndex: number;

          if (direction === 'next') {
            targetIndex =
              currentIndex < sentences.length - 1 ? currentIndex + 1 : sentences.length - 1;
          } else {
            targetIndex = currentIndex > 0 ? currentIndex - 1 : 0;
          }

          const targetSentence = sentences[targetIndex];
          if (targetSentence && targetSentence.segments.length > 0) {
            targetTime = targetSentence.segments[0].startTime;
            this.playerService.seek(targetTime);

            // Show visual feedback
            this.showActionToast(
              `${direction === 'next' ? 'Next' : 'Previous'} sentence`,
              'success',
              1000,
            );

            this.emitEvent({
              type: 'sentence_nav',
              value: {
                direction,
                fromTime: currentTime,
                toTime: targetTime,
                sentence: targetSentence.combinedText,
                sentenceIndex: targetIndex,
              },
              timestamp: Date.now(),
            });
            return;
          }
        }
      }

      // Fallback to time-based navigation
      const jumpSeconds = direction === 'next' ? 5 : -5;
      targetTime = Math.max(0, currentTime + jumpSeconds);

      this.playerService.seek(targetTime);

      // Show visual feedback for fallback navigation
      this.showActionToast(
        `${direction === 'next' ? 'Forward' : 'Backward'} ${Math.abs(jumpSeconds)}s`,
        'warning',
        1000,
      );

      this.emitEvent({
        type: 'sentence_nav',
        value: { direction, fromTime: currentTime, toTime: targetTime },
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger?.error('Failed to navigate sentence', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          direction,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.showActionToast('Navigation failed', 'error');
    }
  }

  private skipTime(seconds: number): void {
    try {
      const currentTime = this.playerService.getCurrentTime();
      const duration = this.playerService.getDuration();
      const targetTime = Math.max(0, Math.min(duration, currentTime + seconds));

      this.playerService.seek(targetTime);

      this.emitEvent({
        type: 'sentence_nav',
        value: {
          direction: seconds > 0 ? 'next' : 'previous',
          fromTime: currentTime,
          toTime: targetTime,
          skipSeconds: seconds,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger?.error('Failed to skip time', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          seconds,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private replayCurrentSentence(): void {
    try {
      const currentTime = this.playerService.getCurrentTime();

      // Try to use sentence looping service for intelligent replay
      if (this.sentenceLoopingService && this.isInitialized) {
        const currentSentence = this.sentenceLoopingService.getSentenceAtTime(currentTime);

        if (currentSentence && currentSentence.segments.length > 0) {
          const startTime = currentSentence.segments[0].startTime;

          // Seek to the beginning of the current sentence
          this.playerService.seek(startTime);

          // Show visual feedback
          this.showActionToast('Replaying sentence', 'success', 1000);

          this.emitEvent({
            type: 'sentence_nav',
            value: {
              direction: 'replay',
              fromTime: currentTime,
              toTime: startTime,
              sentence: currentSentence.combinedText,
              sentenceIndex: this.sentenceLoopingService
                .getAvailableSentences()
                .findIndex((s) => s.startIndex === currentSentence.startIndex),
            },
            timestamp: Date.now(),
          });
          return;
        }
      }

      // Fallback: replay last 5 seconds
      const replayTime = Math.max(0, currentTime - 5);
      this.playerService.seek(replayTime);

      // Show visual feedback for fallback
      this.showActionToast('Replaying 5 seconds', 'warning', 1000);

      this.emitEvent({
        type: 'sentence_nav',
        value: {
          direction: 'replay',
          fromTime: currentTime,
          toTime: replayTime,
          fallback: true,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger?.error('Failed to replay sentence', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.showActionToast('Replay failed', 'error');
    }
  }

  private navigateToSubtitle(subtitleId: string): void {
    try {
      if (!this.sentenceLoopingService || !this.isInitialized) {
        this.logger?.warn('Sentence looping service not available for subtitle navigation', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { subtitleId },
        });
        this.showActionToast('Navigation service unavailable', 'error', 2000);
        return;
      }

      if (!subtitleId || subtitleId.trim() === '') {
        this.logger?.warn('Invalid subtitle ID provided', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { subtitleId },
        });
        this.showActionToast('Invalid subtitle ID', 'error', 1500);
        return;
      }

      const sentences = this.sentenceLoopingService.getAvailableSentences();
      if (sentences.length === 0) {
        this.logger?.warn('No sentences available for navigation', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { subtitleId },
        });
        this.showActionToast('No subtitles available', 'warning', 2000);
        return;
      }

      // Find sentence containing the target subtitle segment
      const targetSentence = sentences.find((sentence) =>
        sentence.segments.some((segment) => segment.id === subtitleId),
      );

      if (!targetSentence || targetSentence.segments.length === 0) {
        this.logger?.warn('Target subtitle not found in available sentences', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { 
            subtitleId,
            availableSentenceCount: sentences.length,
            totalSegments: sentences.reduce((sum, s) => sum + s.segments.length, 0)
          },
        });
        this.showActionToast('Subtitle not found', 'error', 1500);
        return;
      }

      // Find the specific segment within the sentence for precise timing
      const targetSegment = targetSentence.segments.find((segment) => segment.id === subtitleId);
      const currentTime = this.playerService.getCurrentTime();
      
      // Use segment start time if found, otherwise use sentence start time
      const baseTargetTime = targetSegment ? targetSegment.startTime : targetSentence.segments[0].startTime;
      
      // Apply buffer time to ensure context is visible (0.5 seconds before segment start)
      const bufferTime = Math.min(0.5, baseTargetTime * 0.1); // Dynamic buffer, max 0.5s
      const targetTime = Math.max(0, baseTargetTime - bufferTime);

      // Validate target time is within video duration
      const videoDuration = this.playerService.getDuration();
      if (targetTime >= videoDuration) {
        this.logger?.warn('Target time exceeds video duration', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { 
            subtitleId, 
            targetTime, 
            videoDuration,
            segmentStartTime: baseTargetTime
          },
        });
        this.showActionToast('Subtitle beyond video end', 'warning', 2000);
        return;
      }

      // Perform the seek operation
      this.playerService.seek(targetTime);

      // Show success feedback with context information
      const navigationDirection = targetTime > currentTime ? 'forward' : 'backward';
      const timeDifference = Math.abs(targetTime - currentTime);
      
      this.showActionToast(
        `Jumped ${navigationDirection} ${Math.round(timeDifference)}s`,
        'success',
        1500
      );

      // Emit navigation event with detailed information
      this.emitEvent({
        type: 'sentence_nav',
        value: {
          direction: navigationDirection,
          fromTime: currentTime,
          toTime: targetTime,
          sentence: targetSentence.combinedText,
          subtitleId: subtitleId,
          bufferApplied: bufferTime,
          segmentFound: !!targetSegment,
          totalSentenceSegments: targetSentence.segments.length,
        },
        timestamp: Date.now(),
      });

      this.logger?.info('Successfully navigated to subtitle', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          subtitleId,
          fromTime: currentTime,
          toTime: targetTime,
          bufferApplied: bufferTime,
          sentence: targetSentence.combinedText.substring(0, 50) + '...',
          navigationDirection,
          timeDifference: Math.round(timeDifference * 100) / 100,
        },
      });

    } catch (error) {
      this.logger?.error('Failed to navigate to subtitle', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          subtitleId,
          error: error instanceof Error ? error.message : String(error),
          currentTime: this.playerService.getCurrentTime(),
        },
      });
      this.showActionToast('Navigation failed', 'error', 2000);
    }
  }

  private jumpToPercentage(percentage: number): void {
    try {
      const duration = this.playerService.getDuration();
      const currentTime = this.playerService.getCurrentTime();
      const targetTime = Math.max(0, Math.min(duration, duration * (percentage / 100)));

      this.playerService.seek(targetTime);

      this.emitEvent({
        type: 'sentence_nav',
        value: {
          direction: targetTime > currentTime ? 'next' : 'previous',
          fromTime: currentTime,
          toTime: targetTime,
          percentage: percentage,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger?.error('Failed to jump to percentage', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          percentage,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private toggleVocabularyMode(): void {
    console.log('[EnhancedPlaybackControls] toggleVocabularyMode() called - vocabulary highlighting mode'); // DEBUG
    this.vocabularyModeActive = !this.vocabularyModeActive;
    this.updateVocabularyDisplay();

    // Update state tracking
    this.updateCurrentState();

    // Show visual feedback
    this.showVocabularyToggleFeedback();
    this.showActionToast(
      `Vocabulary Mode: ${this.vocabularyModeActive ? 'ON' : 'OFF'}`,
      'success',
      1500,
    );
    this.updateStateIndicators();

    this.emitEvent({
      type: 'vocabulary_mode',
      value: this.vocabularyModeActive,
      timestamp: Date.now(),
    });
  }

  public toggleVocabularyList(): void {
    console.log('[EnhancedPlaybackControls] toggleVocabularyList() called - vocabulary list visibility'); // DEBUG
    this.vocabularyListVisible = !this.vocabularyListVisible;
    this.updateVocabularyListDisplay();

    // Update state tracking
    this.updateCurrentState();

    // Show visual feedback
    this.showActionToast(
      `Vocabulary List: ${this.vocabularyListVisible ? 'VISIBLE' : 'HIDDEN'}`,
      'success',
      1500,
    );
    this.updateStateIndicators();

    this.emitEvent({
      type: 'vocabulary_list',
      value: this.vocabularyListVisible,
      timestamp: Date.now(),
    });
  }

  private updateVocabularyDisplay(): void {
    if (!this.shadowRoot) return;

    const vocabIndicator = this.shadowRoot.querySelector('.vocabulary-indicator');
    const vocabBtn = this.shadowRoot.querySelector('.vocabulary-mode .vocabulary-mode-btn');

    if (vocabIndicator && vocabBtn) {
      if (this.vocabularyModeActive) {
        vocabIndicator.textContent = 'Vocab Mode';
        vocabIndicator.classList.add('active');
        vocabBtn.classList.add('active');
      } else {
        vocabIndicator.textContent = 'Normal';
        vocabIndicator.classList.remove('active');
        vocabBtn.classList.remove('active');
      }
    }
  }

  private updateVocabularyListDisplay(): void {
    if (!this.shadowRoot) return;

    const vocabListBtn = this.shadowRoot.querySelector('.vocabulary-mode .vocabulary-list-btn');

    if (vocabListBtn) {
      if (this.vocabularyListVisible) {
        vocabListBtn.classList.add('active');
        vocabListBtn.setAttribute('title', 'Hide Vocabulary List');
        
        // Show the vocabulary list with smooth animation
        this.vocabularyListManager.show().then(() => {
          this.logger?.debug('Vocabulary list shown successfully', {
            component: ComponentType.YOUTUBE_INTEGRATION,
          });
        }).catch((error) => {
          this.logger?.warn('Failed to show vocabulary list', {
            component: ComponentType.YOUTUBE_INTEGRATION,
            metadata: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
          // Revert the state if showing failed
          this.vocabularyListVisible = false;
          vocabListBtn.classList.remove('active');
          vocabListBtn.setAttribute('title', 'Show Vocabulary List');
        });
      } else {
        vocabListBtn.classList.remove('active');
        vocabListBtn.setAttribute('title', 'Show Vocabulary List');
        
        // Hide the vocabulary list with smooth animation
        this.vocabularyListManager.hide();
        this.logger?.debug('Vocabulary list hidden', {
          component: ComponentType.YOUTUBE_INTEGRATION,
        });
      }
    }
  }

  // ========================================
  // Event Handling and Player Integration
  // ========================================

  private setupPlayerEventHandlers(): void {
    this.playerEventHandlers.set('ratechange', () => {
      this.currentSpeed = this.playerService.getPlaybackRate();
      this.updateSpeedDisplay();
    });

    this.playerEventHandlers.set('play', () => {
      this.resetAutoHide();
    });

    this.playerEventHandlers.set('pause', () => {
      this.show();
    });
  }

  private setupPlayerEventListeners(): void {
    for (const [eventType, handler] of this.playerEventHandlers) {
      this.playerService.addEventListener(eventType as PlayerEvent, handler);
    }
  }

  private removePlayerEventListeners(): void {
    for (const [eventType, handler] of this.playerEventHandlers) {
      this.playerService.removeEventListener(eventType as PlayerEvent, handler);
    }
  }

  private setupSentenceLoopingListeners(): void {
    // Listen for sentence loop events
    this.sentenceLoopingService.addEventListener((event: LoopEvent) => {
      switch (event.type) {
        case 'loop_started':
          this.currentLoop = {
            startTime: event.loop.startTime,
            endTime: event.loop.endTime,
            id: event.loop.id,
            title: event.loop.text,
            isActive: true,
          };
          this.updateLoopDisplay();
          break;

        case 'loop_cancelled':
          this.currentLoop = null;
          this.updateLoopDisplay();
          break;

        case 'loop_completed':
          this.logger?.debug('Loop completed', {
            component: ComponentType.YOUTUBE_INTEGRATION,
            metadata: {
              loopText: event.loop.text,
              loopId: event.loop.id,
            },
          });
          break;
      }
    });
  }

  private setupKeyboardShortcuts(): void {
    // Define keyboard shortcuts
    // Note: Removed Space key mapping to avoid conflicts with YouTube's native play/pause behavior
    // Users can still use other controls for play/pause functionality

    this.keyboardShortcuts.set('ArrowLeft', () => {
      this.navigateSentence('previous');
    });

    this.keyboardShortcuts.set('ArrowRight', () => {
      this.navigateSentence('next');
    });

    this.keyboardShortcuts.set('ArrowUp', () => {
      this.adjustSpeed(0.25);
    });

    this.keyboardShortcuts.set('ArrowDown', () => {
      this.adjustSpeed(-0.25);
    });

    this.keyboardShortcuts.set('KeyN', () => {
      this.toggleLoop();
    });

    this.keyboardShortcuts.set('KeyV', () => {
      this.toggleVocabularyMode();
    });

    // CRITICAL FIX: Add Ctrl+V/Cmd+V shortcut to toggle vocabulary list
    this.keyboardShortcuts.set('Ctrl+KeyV', () => {
      this.toggleVocabularyList();
    });

    // Mac support (Cmd+V maps to metaKey)
    this.keyboardShortcuts.set('Meta+KeyV', () => {
      this.toggleVocabularyList();
    });

    this.keyboardShortcuts.set('KeyL', () => {
      this.toggleVocabularyList();
    });

    this.keyboardShortcuts.set('KeyR', () => {
      this.resetSpeed();
    });

    this.keyboardShortcuts.set('KeyE', () => {
      this.replayCurrentSentence();
    });

    this.keyboardShortcuts.set('Comma', () => {
      this.skipTime(-1);
    });

    this.keyboardShortcuts.set('Period', () => {
      this.skipTime(1);
    });

    this.keyboardShortcuts.set('Digit1', () => {
      this.setPlaybackSpeed(0.25);
    });

    this.keyboardShortcuts.set('Digit2', () => {
      this.setPlaybackSpeed(0.5);
    });

    this.keyboardShortcuts.set('Digit3', () => {
      this.setPlaybackSpeed(0.75);
    });

    this.keyboardShortcuts.set('Digit4', () => {
      this.setPlaybackSpeed(1.0);
    });

    this.keyboardShortcuts.set('Digit5', () => {
      this.setPlaybackSpeed(1.25);
    });

    this.keyboardShortcuts.set('Digit6', () => {
      this.setPlaybackSpeed(1.5);
    });

    this.keyboardShortcuts.set('Digit7', () => {
      this.setPlaybackSpeed(1.75);
    });

    this.keyboardShortcuts.set('Digit8', () => {
      this.setPlaybackSpeed(2.0);
    });

    // Add keyboard event listener
    document.addEventListener('keydown', this.keyboardEventHandler, { passive: false });
  }

  private handleKeyboardEvent(event: KeyboardEvent): void {
    // Only handle shortcuts when controls are visible and not in input fields
    if (!this.isVisible || !this.isInitialized) return;

    // Check if user is typing in any input field (including shadow DOM)
    if (this.isUserTypingInInputField(event)) return;

    // Build shortcut key from event
    let shortcutKey = '';

    if (event.ctrlKey) shortcutKey += 'Ctrl+';
    if (event.altKey) shortcutKey += 'Alt+';
    if (event.shiftKey) shortcutKey += 'Shift+';
    if (event.metaKey) shortcutKey += 'Meta+'; // Mac Cmd key support

    shortcutKey += event.code;

    // Check for shortcuts
    const handler =
      this.keyboardShortcuts.get(shortcutKey) || this.keyboardShortcuts.get(event.code);

    if (handler) {
      console.log('[EnhancedPlaybackControls] Keyboard shortcut triggered:', { shortcutKey, eventCode: event.code, key: event.key }); // DEBUG
      event.preventDefault();
      event.stopPropagation();
      handler();
    }
  }

  private isUserTypingInInputField(event: KeyboardEvent): boolean {
    // Check document activeElement first
    const activeElement = document.activeElement;
    
    // Check for standard input fields
    if (activeElement) {
      if (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          (activeElement as HTMLElement).contentEditable === 'true') {
        return true;
      }
      
      // Check if activeElement is a shadow host that might contain input fields
      const shadowRoot = (activeElement as any).shadowRoot;
      if (shadowRoot) {
        const shadowActiveElement = shadowRoot.activeElement;
        if (shadowActiveElement &&
            (shadowActiveElement.tagName === 'INPUT' ||
             shadowActiveElement.tagName === 'TEXTAREA' ||
             (shadowActiveElement as HTMLElement).contentEditable === 'true')) {
          return true;
        }
      }
    }
    
    // Check event target as well
    const target = event.target as HTMLElement;
    if (target &&
        (target.tagName === 'INPUT' ||
         target.tagName === 'TEXTAREA' ||
         target.contentEditable === 'true')) {
      return true;
    }
    
    // Check if we're inside vocabulary list container (which might use shadow DOM)
    const vocabularyContainer = document.getElementById('linguatube-vocabulary-list-container');
    if (vocabularyContainer && vocabularyContainer.contains(target)) {
      // If event is happening inside vocabulary list, check if it's from an input
      const inputs = vocabularyContainer.querySelectorAll('input, textarea, [contenteditable="true"]');
      for (const input of inputs) {
        if (input === target || input.contains(target)) {
          return true;
        }
      }
      
      // Also check shadow DOM within vocabulary list
      const shadowHosts = vocabularyContainer.querySelectorAll('*');
      for (const host of shadowHosts) {
        const shadowRoot = (host as any).shadowRoot;
        if (shadowRoot) {
          const shadowInputs = shadowRoot.querySelectorAll('input, textarea, [contenteditable="true"]');
          for (const shadowInput of shadowInputs) {
            if (shadowInput === target || shadowInput.contains(target)) {
              return true;
            }
          }
        }
      }
    }
    
    return false;
  }

  private removeKeyboardShortcuts(): void {
    document.removeEventListener('keydown', this.keyboardEventHandler);
    this.keyboardShortcuts.clear();
  }

  private setupInteractionHandlers(): void {
    if (!this.controlsContainer) return;

    // Show controls on mouse enter
    this.controlsContainer.addEventListener('mouseenter', () => {
      this.show();
      this.clearAutoHide();
    });

    // Hide controls on mouse leave (if auto-hide enabled)
    this.controlsContainer.addEventListener('mouseleave', () => {
      if (this.config.autoHide) {
        this.resetAutoHide();
      }
    });
  }

  private setupAutoHide(): void {
    if (!this.config.autoHide) return;

    // Listen for user activity
    const activityEvents = ['mousemove', 'keydown', 'click'];

    activityEvents.forEach((eventType) => {
      document.addEventListener(
        eventType,
        () => {
          this.resetAutoHide();
        },
        { passive: true },
      );
    });
  }

  private resetAutoHide(): void {
    if (!this.config.autoHide) return;

    this.clearAutoHide();
    this.show();

    this.autoHideTimeout = window.setTimeout(() => {
      this.hide();
    }, this.config.autoHideDelay);
  }

  private clearAutoHide(): void {
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }
  }

  // ========================================
  // Visibility Management
  // ========================================

  public show(): void {
    if (!this.controlsContainer) return;

    this.isVisible = true;
    this.controlsContainer.classList.remove('hidden');
  }

  public hide(): void {
    if (!this.controlsContainer) return;

    this.isVisible = false;
    this.controlsContainer.classList.add('hidden');
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  // ========================================
  // Observer Setup
  // ========================================

  private setupResizeObserver(): void {
    if (!this.container) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.updateControlsPosition();
    });

    const playerContainer = this.container.parentElement;
    if (playerContainer) {
      this.resizeObserver.observe(playerContainer);
    }
  }

  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      let needsRepositioning = false;

      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'class' || mutation.attributeName === 'style')
        ) {
          needsRepositioning = true;
          break;
        }
      }

      if (needsRepositioning) {
        setTimeout(() => this.updateControlsPosition(), 100);
      }
    });

    const playerContainer = document.querySelector('#movie_player');
    if (playerContainer) {
      this.mutationObserver.observe(playerContainer, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        subtree: true,
      });
    }
  }

  // ========================================
  // Public API Methods
  // ========================================

  public isReady(): boolean {
    return this.isInitialized && this.controlsContainer !== null;
  }

  public updateConfig(newConfig: Partial<EnhancedControlsConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (this.isInitialized) {
      this.applyConfiguration();
    }
  }

  public addEventListener(callback: ControlsEventCallback): void {
    this.eventListeners.add(callback);
  }

  public removeEventListener(callback: ControlsEventCallback): void {
    this.eventListeners.delete(callback);
  }

  public getCurrentSpeed(): number {
    return this.currentSpeed;
  }

  public getCurrentLoop(): LoopSegment | null {
    return this.currentLoop;
  }

  public isVocabularyModeActive(): boolean {
    return this.vocabularyModeActive;
  }

  // ========================================
  // Public Navigation API
  // ========================================

  public navigateToPreviousSentence(): void {
    this.navigateSentence('previous');
  }

  public navigateToNextSentence(): void {
    this.navigateSentence('next');
  }

  public skipBackward(seconds: number = 5): void {
    this.skipTime(-Math.abs(seconds));
  }

  public skipForward(seconds: number = 5): void {
    this.skipTime(Math.abs(seconds));
  }

  public jumpToSubtitle(subtitleId: string): void {
    this.navigateToSubtitle(subtitleId);
  }

  public jumpToVideoPercentage(percentage: number): void {
    this.jumpToPercentage(Math.max(0, Math.min(100, percentage)));
  }

  public replaySentence(): void {
    this.replayCurrentSentence();
  }

  // ========================================
  // Public Speed Control API
  // ========================================

  public setSpeed(speed: number): void {
    this.setPlaybackSpeed(speed);
  }

  public adjustSpeedBy(delta: number): void {
    this.adjustSpeed(delta);
  }

  public resetSpeedToNormal(): void {
    this.resetSpeed();
  }

  public getAvailableSpeeds(): PlaybackSpeed[] {
    return [
      { value: 0.25, label: '0.25×', isDefault: false },
      { value: 0.5, label: '0.5×', isDefault: false },
      { value: 0.75, label: '0.75×', isDefault: false },
      { value: 1.0, label: '1×', isDefault: true },
      { value: 1.25, label: '1.25×', isDefault: false },
      { value: 1.5, label: '1.5×', isDefault: false },
      { value: 1.75, label: '1.75×', isDefault: false },
      { value: 2.0, label: '2×', isDefault: false },
    ];
  }

  // ========================================
  // Public Loop Control API
  // ========================================

  public createCustomLoop(startTime?: number, endTime?: number): LoopSegment | null {
    try {
      const currentTime = this.playerService.getCurrentTime();
      const duration = this.playerService.getDuration();

      const loopStart =
        startTime !== undefined ? Math.max(0, startTime) : Math.max(0, currentTime - 5);
      const loopEnd =
        endTime !== undefined ? Math.min(duration, endTime) : Math.min(duration, currentTime + 5);

      if (loopEnd <= loopStart) {
        this.logger?.warn('Invalid loop times', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { loopStart, loopEnd },
        });
        return null;
      }

      this.currentLoop = {
        id: `loop_${Date.now()}`,
        startTime: loopStart,
        endTime: loopEnd,
        isActive: true,
        title: `Loop ${this.formatTime(loopStart)} - ${this.formatTime(loopEnd)}`,
      };

      this.playerService.createSegmentLoop(loopStart, loopEnd);
      this.updateLoopDisplay();

      this.emitEvent({
        type: 'loop_toggle',
        value: this.currentLoop,
        timestamp: Date.now(),
      });

      return this.currentLoop;
    } catch (error) {
      this.logger?.error('Failed to create loop', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          startTime,
          endTime,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return null;
    }
  }

  public removeLoop(): boolean {
    try {
      this.playerService.stopSegmentLoop();
      this.currentLoop = null;
      this.updateLoopDisplay();

      this.emitEvent({
        type: 'loop_toggle',
        value: null,
        timestamp: Date.now(),
      });

      return true;
    } catch (error) {
      this.logger?.error('Failed to clear loop in removeLoop method', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return false;
    }
  }

  public toggleCurrentLoop(): LoopSegment | null {
    if (this.currentLoop) {
      this.removeLoop();
      return null;
    } else {
      return this.createCustomLoop();
    }
  }

  // ========================================
  // Public Vocabulary Mode API
  // ========================================

  public setVocabularyModeState(active: boolean): void {
    if (this.vocabularyModeActive !== active) {
      this.vocabularyModeActive = active;
      this.updateVocabularyDisplay();

      this.emitEvent({
        type: 'vocabulary_mode',
        value: active,
        timestamp: Date.now(),
      });
    }
  }

  public toggleVocabularyModeState(): boolean {
    this.setVocabularyModeState(!this.vocabularyModeActive);
    return this.vocabularyModeActive;
  }

  // ========================================
  // Public Vocabulary List Management API
  // ========================================

  public isVocabularyListVisible(): boolean {
    return this.vocabularyListVisible;
  }

  public async showVocabularyList(): Promise<boolean> {
    try {
      await this.vocabularyListManager.show();
      this.vocabularyListVisible = true;
      this.updateVocabularyListDisplay();
      return true;
    } catch (error) {
      this.logger?.warn('Failed to show vocabulary list', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  public hideVocabularyList(): void {
    this.vocabularyListVisible = false;
    this.updateVocabularyListDisplay();
  }

  public getVocabularyListManager(): VocabularyListManager {
    return this.vocabularyListManager;
  }

  // ========================================
  // Public State Query API
  // ========================================

  public getVisibility(): boolean {
    return this.isVisible;
  }

  public isFullscreen(): boolean {
    return this.isFullscreenMode;
  }

  public getConfig(): EnhancedControlsConfig {
    return { ...this.config };
  }

  public getState(): {
    isReady: boolean;
    isVisible: boolean;
    currentSpeed: number;
    currentLoop: LoopSegment | null;
    vocabularyModeActive: boolean;
    vocabularyListVisible: boolean;
    config: EnhancedControlsConfig;
  } {
    return {
      isReady: this.isReady(),
      isVisible: this.getVisibility(),
      currentSpeed: this.currentSpeed,
      currentLoop: this.currentLoop,
      vocabularyModeActive: this.vocabularyModeActive,
      vocabularyListVisible: this.vocabularyListVisible,
      config: this.getConfig(),
    };
  }

  // ========================================
  // State Management
  // ========================================

  public async loadState(): Promise<boolean> {
    try {
      const stateKey = `enhanced-controls-state-${this.getCurrentVideoId()}`;
      const result = await this.storageService.getCache<EnhancedControlsState>(stateKey);

      if (result.success && result.data) {
        const savedState = result.data;

        // Restore state if auto-resume is enabled
        if (this.autoResumeEnabled) {
          await this.restoreState(savedState);
        }

        return true;
      }

      return false;
    } catch (error) {
      this.logger?.error('Failed to load state', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return false;
    }
  }

  public async saveState(): Promise<boolean> {
    try {
      const currentVideoId = this.getCurrentVideoId();
      if (!currentVideoId) return false;

      // Update current state
      this.updateCurrentState();

      const stateKey = `enhanced-controls-state-${currentVideoId}`;
      // Cache state for 24 hours (86400 seconds)
      const result = await this.storageService.setCache(stateKey, this.currentState, 86400);

      return result.success;
    } catch (error) {
      this.logger?.error('Failed to save state', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return false;
    }
  }

  private async restoreState(savedState: EnhancedControlsState): Promise<void> {
    try {
      // Restore speed
      if (savedState.speed !== this.currentSpeed) {
        this.setPlaybackSpeed(savedState.speed);
      }

      // Restore vocabulary mode
      if (savedState.vocabularyMode !== this.vocabularyModeActive) {
        this.setVocabularyModeState(savedState.vocabularyMode);
      }

      // DO NOT restore vocabulary list visibility - it should always start closed
      // Users must explicitly open vocabulary list when they want it
      // This prevents auto-opening vocabulary list when starting videos
      this.vocabularyListVisible = false;
      this.updateVocabularyListDisplay();

      // Restore loop if it exists and is valid
      if (savedState.loop && this.isValidLoopSegment(savedState.loop)) {
        this.currentLoop = savedState.loop;
        this.playerService.createSegmentLoop(savedState.loop.startTime, savedState.loop.endTime);
        this.updateLoopDisplay();
      }

      // Update state tracking
      this.currentState = {
        ...savedState,
        sessionStartTime: Date.now(), // Reset session time
        lastPosition: this.playerService.getCurrentTime(),
      };

      this.logger?.info('State restored successfully', {
        component: ComponentType.YOUTUBE_INTEGRATION,
      });
    } catch (error) {
      this.logger?.error('Failed to restore state', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private updateCurrentState(): void {
    const currentTime = this.playerService.getCurrentTime();
    const videoId = this.getCurrentVideoId();

    this.currentState = {
      ...this.currentState,
      speed: this.currentSpeed,
      loop: this.currentLoop,
      vocabularyMode: this.vocabularyModeActive,
      vocabularyListVisible: this.vocabularyListVisible,
      lastVideoId: videoId,
      lastPosition: currentTime,
      totalWatchTime:
        this.currentState.totalWatchTime + (Date.now() - this.currentState.sessionStartTime) / 1000,
    };
  }

  private getCurrentVideoId(): string | null {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('v');
    } catch {
      return null;
    }
  }

  private isValidLoopSegment(loop: LoopSegment): boolean {
    const duration = this.playerService.getDuration();
    return loop.startTime >= 0 && loop.endTime <= duration && loop.startTime < loop.endTime;
  }

  private startStateTracking(): void {
    if (this.stateUpdateInterval) {
      clearInterval(this.stateUpdateInterval);
    }

    // Update state every 10 seconds
    this.stateUpdateInterval = window.setInterval(() => {
      this.updateCurrentState();
      this.saveState();
    }, 10000);
  }

  private stopStateTracking(): void {
    if (this.stateUpdateInterval) {
      clearInterval(this.stateUpdateInterval);
      this.stateUpdateInterval = null;
    }
  }

  public setAutoResume(enabled: boolean): void {
    this.autoResumeEnabled = enabled;
  }

  public getAutoResume(): boolean {
    return this.autoResumeEnabled;
  }

  public getSessionStats(): {
    sessionDuration: number;
    totalWatchTime: number;
    loopCount: number;
    speedChanges: number;
    averageSpeed: number;
  } {
    const sessionDuration = (Date.now() - this.currentState.sessionStartTime) / 1000;

    return {
      sessionDuration,
      totalWatchTime: this.currentState.totalWatchTime,
      loopCount: this.currentState.loopCount,
      speedChanges: this.currentState.speedChanges,
      averageSpeed: this.currentSpeed, // Could be enhanced to track true average
    };
  }

  public async clearState(): Promise<boolean> {
    try {
      const currentVideoId = this.getCurrentVideoId();
      if (!currentVideoId) return false;

      const stateKey = `enhanced-controls-state-${currentVideoId}`;
      // Clear cache by setting null with immediate expiry
      const result = await this.storageService.setCache(stateKey, null, 0);

      // Reset current state to defaults
      this.currentState = {
        speed: 1.0,
        loop: null,
        vocabularyMode: false,
        vocabularyListVisible: false,
        lastVideoId: currentVideoId,
        lastPosition: 0,
        sessionStartTime: Date.now(),
        totalWatchTime: 0,
        loopCount: 0,
        speedChanges: 0,
      };

      return result.success;
    } catch (error) {
      this.logger?.error('Failed to clear state', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return false;
    }
  }

  // ========================================
  // Utility Methods
  // ========================================

  private formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '0:00';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  private emitEvent(event: ControlsEventData): void {
    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        this.logger?.error('Event listener error', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    });
  }

  // ========================================
  // Fullscreen Support
  // ========================================

  private setupFullscreenObserver(): void {
    // Listen for fullscreen changes via document events
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('webkitfullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('mozfullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('MSFullscreenChange', this.fullscreenChangeHandler);

    // Also observe DOM changes for YouTube's fullscreen class changes
    this.fullscreenObserver = new MutationObserver(() => {
      this.checkFullscreenState();
    });

    // Watch for changes on video container and player elements
    const videoContainer = document.querySelector(
      '#movie_player, .html5-video-container, .ytp-fullscreen',
    );
    if (videoContainer) {
      this.fullscreenObserver.observe(videoContainer, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: true,
      });
    }

    // Initial fullscreen state check
    this.checkFullscreenState();
  }

  private handleFullscreenChange(): void {
    // Small delay to ensure DOM has updated
    setTimeout(() => {
      this.checkFullscreenState();
    }, 100);
  }

  private checkFullscreenState(): void {
    const wasFullscreen = this.isFullscreenMode;

    // Check multiple fullscreen indicators
    const isDocumentFullscreen = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );

    const isYouTubeFullscreen = !!(
      document.querySelector('.ytp-fullscreen') ||
      document.querySelector('#movie_player.ytp-fullscreen') ||
      document.querySelector('.html5-video-container.ytp-fullscreen')
    );

    this.isFullscreenMode = isDocumentFullscreen || isYouTubeFullscreen;

    // Update UI if fullscreen state changed
    if (wasFullscreen !== this.isFullscreenMode) {
      this.updateFullscreenMode();

      // Emit fullscreen change event
      this.emitEvent({
        type: 'fullscreen_change' as any,
        value: this.isFullscreenMode,
        timestamp: Date.now(),
      });
    }
  }

  private updateFullscreenMode(): void {
    if (!this.container) return;

    if (this.isFullscreenMode) {
      this.container.classList.add('fullscreen-mode');

      // Adjust positioning for fullscreen
      this.adjustFullscreenPosition();

      // Show fullscreen feedback
      this.showActionToast('Fullscreen mode', 'success', 1500);
    } else {
      this.container.classList.remove('fullscreen-mode');

      // Reset inline styles set during fullscreen
      if (this.controlsContainer) {
        this.controlsContainer.style.position = '';
        this.controlsContainer.style.bottom = '';
        this.controlsContainer.style.left = '';
        this.controlsContainer.style.transform = '';
        this.controlsContainer.style.zIndex = '';
      }

      // Reset to normal positioning
      this.updateControlsPosition();

      // Show exit fullscreen feedback
      this.showActionToast('Exited fullscreen', 'success', 1500);
    }
  }

  private adjustFullscreenPosition(): void {
    if (!this.controlsContainer || !this.isFullscreenMode) return;

    // In fullscreen, override positioning with fixed positioning
    this.controlsContainer.style.position = 'fixed';
    this.controlsContainer.style.bottom = '80px';
    this.controlsContainer.style.left = '50%';
    this.controlsContainer.style.transform = 'translateX(-50%)';
    this.controlsContainer.style.zIndex = '2147483647';
  }

  private removeFullscreenObserver(): void {
    // Remove document event listeners
    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.removeEventListener('webkitfullscreenchange', this.fullscreenChangeHandler);
    document.removeEventListener('mozfullscreenchange', this.fullscreenChangeHandler);
    document.removeEventListener('MSFullscreenChange', this.fullscreenChangeHandler);

    // Disconnect mutation observer
    if (this.fullscreenObserver) {
      this.fullscreenObserver.disconnect();
      this.fullscreenObserver = null;
    }
  }

  // ========================================
  // Enhanced Navigation for Vocabulary Integration
  // ========================================

  /**
   * Get current video time for enhanced navigation calculations
   */
  public getCurrentVideoTime(): number {
    try {
      return this.playerService.getCurrentTime();
    } catch (error) {
      this.logger?.warn('Failed to get current video time', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return 0;
    }
  }

  /**
   * Get video duration for enhanced navigation calculations
   */
  public getVideoDuration(): number {
    try {
      return this.playerService.getDuration();
    } catch (error) {
      this.logger?.warn('Failed to get video duration', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return 300; // Fallback duration
    }
  }

  /**
   * Get current video ID for navigation validation
   */
  public getVideoId(): string | undefined {
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('v') || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Enhanced subtitle navigation with sentence context and optional auto-loop
   */
  public jumpToSubtitleWithContext(subtitleId: string, options?: {
    bufferTime?: number;
    highlightDuration?: number;
    enableAutoLoop?: boolean;
  }): boolean {
    try {
      const { bufferTime = 0.5, highlightDuration = 2000, enableAutoLoop = false } = options || {};

      if (!this.sentenceLoopingService || !this.isInitialized) {
        this.logger?.warn('Sentence looping service not available for context navigation', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { subtitleId },
        });
        return false;
      }

      const sentences = this.sentenceLoopingService.getAvailableSentences();
      const targetSentence = sentences.find((sentence) =>
        sentence.segments.some((segment) => segment.id === subtitleId),
      );

      if (!targetSentence || targetSentence.segments.length === 0) {
        this.logger?.warn('Target sentence not found for context navigation', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { subtitleId },
        });
        return false;
      }

      // Find the specific segment for precise timing
      const targetSegment = targetSentence.segments.find((segment) => segment.id === subtitleId);
      const baseTargetTime = targetSegment ? targetSegment.startTime : targetSentence.segments[0].startTime;
      const targetTime = Math.max(0, baseTargetTime - bufferTime);

      // Perform navigation
      this.playerService.seek(targetTime);

      // Provide enhanced visual feedback
      this.showActionToast(
        `Jumped to: "${targetSentence.combinedText.substring(0, 30)}..."`,
        'success',
        highlightDuration
      );

      // Emit vocabulary navigation event for cross-component coordination
      this.emitEvent({
        type: 'vocabulary_navigation',
        value: {
          subtitleId: subtitleId,
          targetTime: targetTime,
          bufferTime: bufferTime,
          sentenceText: targetSentence.combinedText,
          navigationMethod: 'subtitle_mapping',
        },
        timestamp: Date.now(),
        metadata: {
          enableAutoLoop: enableAutoLoop,
          highlightDuration: highlightDuration,
          segmentCount: targetSentence.segments.length,
        },
      });

      // Emit subtitle highlight event for DualSubtitleManager
      this.emitEvent({
        type: 'subtitle_highlight',
        value: {
          subtitleId: subtitleId,
          startTime: targetSentence.segments[0].startTime,
          endTime: targetSentence.segments[targetSentence.segments.length - 1].endTime,
          text: targetSentence.combinedText,
          highlight: true,
          duration: highlightDuration,
        },
        timestamp: Date.now(),
        metadata: {
          source: 'vocabulary_navigation',
          bufferApplied: bufferTime,
        },
      });

      this.logger?.info('Successfully navigated to subtitle with context', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          subtitleId,
          targetTime,
          bufferTime,
          sentenceText: targetSentence.combinedText.substring(0, 50),
          enableAutoLoop,
        },
      });

      return true;
    } catch (error) {
      this.logger?.error('Failed to navigate to subtitle with context', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          subtitleId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  /**
   * Navigate to the sentence containing a specific vocabulary word
   */
  public jumpToVocabularyWord(word: string, options?: {
    caseSensitive?: boolean;
    wholeWord?: boolean;
    bufferTime?: number;
  }): boolean {
    try {
      const { caseSensitive = false, wholeWord = true, bufferTime = 0.5 } = options || {};

      if (!this.sentenceLoopingService || !this.isInitialized) {
        this.logger?.warn('Sentence looping service not available for vocabulary navigation', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { word },
        });
        return false;
      }

      const sentences = this.sentenceLoopingService.getAvailableSentences();
      
      // Find sentence containing the vocabulary word
      const targetSentence = sentences.find((sentence) => {
        const text = caseSensitive ? sentence.combinedText : sentence.combinedText.toLowerCase();
        const searchWord = caseSensitive ? word : word.toLowerCase();
        
        // CRITICAL FIX: Improve matching for Thai and other non-space-separated languages
        if (wholeWord) {
          // For Thai and similar languages, word boundaries (\b) don't work well
          // Use a more flexible approach that works for both English and Thai
          const isThai = /[\u0E00-\u0E7F]/.test(searchWord);
          
          if (isThai) {
            // For Thai, just check if the word appears in the text (no word boundaries needed)
            return text.includes(searchWord);
          } else {
            // For English and other space-separated languages, use word boundaries
            const regex = new RegExp(`\\b${searchWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
            return regex.test(text);
          }
        } else {
          return text.includes(searchWord);
        }
      });

      if (!targetSentence || targetSentence.segments.length === 0) {
        // CRITICAL FIX: Enhanced debugging for failed word search
        this.logger?.warn('No sentence found containing vocabulary word', {
          component: ComponentType.YOUTUBE_INTEGRATION,
          metadata: { 
            word, 
            caseSensitive, 
            wholeWord,
            availableSentencesCount: sentences.length,
            isThai: /[\u0E00-\u0E7F]/.test(word),
            // Log first few sentences for debugging (truncated)
            sampleSentences: sentences.slice(0, 3).map(s => s.combinedText.substring(0, 50) + '...'),
          },
        });
        return false;
      }

      // Navigate to the sentence
      const targetTime = Math.max(0, targetSentence.segments[0].startTime - bufferTime);
      this.playerService.seek(targetTime);

      // Show feedback
      this.showActionToast(
        `Found "${word}" in: "${targetSentence.combinedText.substring(0, 30)}..."`,
        'success',
        2500
      );

      // Emit vocabulary navigation event for cross-component coordination
      this.emitEvent({
        type: 'vocabulary_navigation',
        value: {
          vocabularyWord: word,
          targetTime: targetTime,
          bufferTime: bufferTime,
          sentenceText: targetSentence.combinedText,
          navigationMethod: 'word_search',
        },
        timestamp: Date.now(),
        metadata: {
          caseSensitive: caseSensitive,
          wholeWord: wholeWord,
          segmentCount: targetSentence.segments.length,
        },
      });

      // Emit subtitle highlight event for the found sentence
      this.emitEvent({
        type: 'subtitle_highlight',
        value: {
          startTime: targetSentence.segments[0].startTime,
          endTime: targetSentence.segments[targetSentence.segments.length - 1].endTime,
          text: targetSentence.combinedText,
          highlight: true,
          duration: 2500,
          vocabularyWord: word,
        },
        timestamp: Date.now(),
        metadata: {
          source: 'vocabulary_word_search',
          searchOptions: { caseSensitive, wholeWord },
          bufferApplied: bufferTime,
        },
      });

      this.logger?.info('Successfully navigated to vocabulary word', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          word,
          targetTime,
          sentenceText: targetSentence.combinedText.substring(0, 50),
        },
      });

      return true;
    } catch (error) {
      this.logger?.error('Failed to navigate to vocabulary word', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          word,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }
}
