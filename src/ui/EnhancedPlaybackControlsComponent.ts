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
import { DualSubtitleManager } from './DualSubtitleManager';
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
  readonly showSubtitleControl: boolean;
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
  readonly subtitlesVisible: boolean;
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
    | 'subtitle_highlight' // New event type for subtitle highlighting
    | 'subtitle_visibility' // New event type for subtitle visibility toggle
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
  jumpToSubtitleWithContext(
    subtitleId: string,
    options?: {
      bufferTime?: number;
      highlightDuration?: number;
      enableAutoLoop?: boolean;
    },
  ): boolean;

  /** Navigate to the sentence containing a specific vocabulary word */
  jumpToVocabularyWord(
    word: string,
    options?: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
      bufferTime?: number;
    },
  ): boolean;
}

// ========================================
// Constants and Default Configuration
// ========================================

const DEFAULT_CONFIG: EnhancedControlsConfig = {
  showSpeedControl: true,
  showLoopControl: true,
  showSentenceNavigation: true,
  showVocabularyMode: true,
  showSubtitleControl: true,
  compactMode: false,
  position: 'top',
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
    backdrop-filter: blur(6px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646;
  }

  /* Collapsed mode */
  .controls-container.collapsed {
    padding: 6px 8px;
    gap: 6px;
  }
  .controls-container.collapsed > :not(.drag-handle):not(.collapse-toggle):not(.action-toast):not(.state-indicators) {
    display: none !important;
  }

  /* Collapse toggle */
  .collapse-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    margin-left: 4px;
    border-radius: 6px;
    background: rgba(255,255,255,0.08);
    color: var(--controls-text-color);
    cursor: pointer;
    pointer-events: auto;
    border: 1px solid rgba(255,255,255,0.2);
    transition: var(--controls-transition);
    font-size: 14px;
  }
  .collapse-toggle:hover { background: rgba(255,255,255,0.16); }

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
    position: absolute;
    bottom: 24px;
    right: 24px;
    left: auto;
    transform: none;
  }

  .controls-container.position-top {
    bottom: auto;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
  }

  .controls-container.position-bottom {
    /* Default bottom center positioning is set on base class */
  }

  /* Custom drag position - inline left/top will be set; transform removed */
  .controls-container.custom-position {
    position: absolute;
    transform: none;
  }

  /* Drag handle */
  .drag-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 100%;
    margin-right: 6px;
    cursor: grab;
    user-select: none;
    opacity: 0.6;
    transition: opacity 0.2s ease;
  }
  .drag-handle:hover { opacity: 0.9; }
  .drag-handle:active { cursor: grabbing; }

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
    white-space: nowrap;
    cursor: pointer;
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

  /* When the controls are near the top of the screen, flip the toast below */
  .action-toast.below {
    top: auto !important;
    bottom: -50px;
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
    width: auto;
    height: auto;
    max-width: 90vw;
    max-height: none;
    position: fixed;
    bottom: auto;
    left: 50%;
    transform: translateX(-50%);
    top: 10px;
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
  private isCollapsed: boolean = false;

  private config: EnhancedControlsConfig = { ...DEFAULT_CONFIG };
  private isVisible: boolean = true;
  private isInitialized: boolean = false;
  private autoHideTimeout: number | null = null;

  private playerService: PlayerInteractionService;
  private storageService: StorageService;
  private vocabularyManager: VocabularyManager;
  private vocabularyListManager: VocabularyListManager;
  private dualSubtitleManager: DualSubtitleManager | null = null;
  private sentenceLoopingService: SentenceLoopingService;

  private currentSpeed: number = 1.0;
  private currentLoop: LoopSegment | null = null;
  // Explicit loop markers
  private loopMarkerIn: number | null = null;
  private loopMarkerOut: number | null = null;
  private vocabularyModeActive: boolean = false;
  private vocabularyListVisible: boolean = false;
  private subtitlesVisible: boolean = true;

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
      subtitlesVisible: true,
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
      this.updateSubtitleDisplay();

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
      inset: 0;
      pointer-events: none;
      z-index: 2147483645;
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

    // Add a drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.title = 'Drag to reposition';
    dragHandle.innerHTML = '⋮⋮';
    this.controlsContainer.appendChild(dragHandle);

    // Collapse toggle button
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'collapse-toggle';
    collapseBtn.title = 'Collapse/Expand Controls';
    collapseBtn.setAttribute('aria-label', 'Collapse controls');
    collapseBtn.textContent = '—';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCollapsed();
    });
    this.controlsContainer.appendChild(collapseBtn);

    // Create visual feedback elements
    this.createFeedbackElements();

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

    if (this.config.showSubtitleControl) {
      this.controlsContainer.appendChild(this.createSubtitleControl());
    }

    this.shadowRoot.appendChild(this.controlsContainer);

    // Enable drag functionality
    this.enableDragging(dragHandle);
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
    decreaseBtn.innerHTML = '◀️';
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
    increaseBtn.innerHTML = '▶️';
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

    // Loop indicator acts as IN/OUT/clear toggler
    const loopIndicator = document.createElement('div');
    loopIndicator.className = 'loop-indicator';
    loopIndicator.textContent = 'No Loop';
    loopIndicator.addEventListener('click', () => this.handleLoopIndicatorClick());

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
    skip5BackBtn.innerHTML = '⏪';
    skip5BackBtn.title = 'Skip Back 5 Seconds';
    skip5BackBtn.addEventListener('click', () => {
      this.showButtonClickFeedback(skip5BackBtn);
      this.skipTime(-5);
    });

    // Previous sentence button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'control-button';
    prevBtn.innerHTML = '⏮️';
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
    nextBtn.innerHTML = '⏭️';
    nextBtn.title = 'Next Sentence';
    nextBtn.addEventListener('click', () => {
      this.showButtonClickFeedback(nextBtn);
      this.showNavigationFeedback(nextBtn);
      this.navigateSentence('next');
    });

    // 5-second forward skip
    const skip5ForwardBtn = document.createElement('button');
    skip5ForwardBtn.className = 'control-button skip-button';
    skip5ForwardBtn.innerHTML = '⏩';
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

  private createSubtitleControl(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'control-group subtitle-control';

    // Subtitle toggle button
    const subtitleBtn = document.createElement('button');
    subtitleBtn.className = 'control-button subtitle-toggle-btn';
    subtitleBtn.innerHTML = '💬';
    subtitleBtn.title = 'Toggle Subtitles';
    subtitleBtn.addEventListener('click', () => this.toggleSubtitles());

    // Subtitle indicator
    const subtitleIndicator = document.createElement('div');
    subtitleIndicator.className = 'subtitle-indicator';
    subtitleIndicator.textContent = 'ON';

    group.appendChild(subtitleBtn);
    group.appendChild(subtitleIndicator);

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
    toast.classList.add(type);

    // Flip position below the controls when near the top to avoid off-screen
    try {
      if (this.controlsContainer) {
        const rect = this.controlsContainer.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        // If top or any part would clip above the viewport, put toast below
        const isTopPositioned = this.controlsContainer.classList.contains('position-top');
        const nearTop = isTopPositioned || rect.top < 120 || rect.top < 0;
        if (nearTop) {
          toast.classList.add('below');
          toast.style.removeProperty('top');
          toast.style.bottom = '-50px';
        } else {
          // Also guard against controls being very close to the bottom where bottom:-50 would clip
          const nearBottom = viewportHeight - rect.bottom < 120;
          if (nearBottom) {
            toast.classList.remove('below');
            toast.style.removeProperty('bottom');
            toast.style.top = '-50px';
          } else {
            // Default above placement
            toast.classList.remove('below');
            toast.style.removeProperty('bottom');
            toast.style.top = '-50px';
          }
        }
      }
    } catch {}

    // Finally show with fade-in
    toast.classList.add('show');

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
    this.controlsContainer.classList.remove('floating', 'position-top', 'position-bottom', 'custom-position');

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

    // If a custom position has been set via drag, preserve it
    if (this.controlsContainer.hasAttribute('data-custom-x')) {
      const x = Number(this.controlsContainer.getAttribute('data-custom-x'));
      const y = Number(this.controlsContainer.getAttribute('data-custom-y'));
      this.applyCustomPosition(x, y);
    } else {
      // Ensure base centering defaults apply when no custom position
      if (this.config.position === 'bottom' || this.config.position === 'top') {
        this.controlsContainer.style.left = '50%';
        this.controlsContainer.style.transform = 'translateX(-50%)';
        this.controlsContainer.style.right = '';
      } else if (this.config.position === 'floating') {
        this.controlsContainer.style.right = '24px';
        this.controlsContainer.style.left = 'auto';
        this.controlsContainer.style.transform = 'none';
      }
    }
  }

  private toggleCollapsed(): void {
    if (!this.controlsContainer) return;
    this.isCollapsed = !this.isCollapsed;
    if (this.isCollapsed) {
      this.controlsContainer.classList.add('collapsed');
      // keep drag handle, collapse toggle, state indicators and toast visible by CSS rules
    } else {
      this.controlsContainer.classList.remove('collapsed');
    }
    // Preserve current position and visibility
    this.updateCurrentState();
  }

  private enableDragging(handle: HTMLElement): void {
    if (!this.controlsContainer || !this.container) return;
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (!this.controlsContainer || !this.container) return;
      const containerRect = this.container.getBoundingClientRect();
      const controlRect = this.controlsContainer.getBoundingClientRect();
      // Compute pointer offset within the control, using overlay-relative coords
      const pointerX = e.clientX - containerRect.left;
      const pointerY = e.clientY - containerRect.top;
      offsetX = pointerX - (controlRect.left - containerRect.left);
      offsetY = pointerY - (controlRect.top - containerRect.top);

      isDragging = true;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      // Prevent text selection while dragging
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !this.controlsContainer || !this.container) return;
      const containerRect = this.container.getBoundingClientRect();
      const pointerX = e.clientX - containerRect.left;
      const pointerY = e.clientY - containerRect.top;
      const x = pointerX - offsetX;
      const y = pointerY - offsetY;
      this.applyCustomPosition(x, y);
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', onMouseDown);
  }

  private applyCustomPosition(x: number, y: number): void {
    if (!this.controlsContainer || !this.container) return;
    const containerRect = this.container.getBoundingClientRect();
    const maxX = containerRect.width - this.controlsContainer.offsetWidth - 8;
    const maxY = containerRect.height - this.controlsContainer.offsetHeight - 8;
    const clampedX = Math.max(8, Math.min(Math.round(x), Math.round(maxX)));
    const clampedY = Math.max(8, Math.min(Math.round(y), Math.round(maxY)));

    this.controlsContainer.classList.add('custom-position');
    this.controlsContainer.style.left = `${clampedX}px`;
    this.controlsContainer.style.top = `${clampedY}px`;
    this.controlsContainer.style.right = 'auto';
    this.controlsContainer.style.bottom = 'auto';
    this.controlsContainer.style.transform = 'none';
    this.controlsContainer.setAttribute('data-custom-x', String(clampedX));
    this.controlsContainer.setAttribute('data-custom-y', String(clampedY));
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
      return;
    }
    // If explicit markers exist, apply them; otherwise default +/-5s
    if (this.loopMarkerIn != null && this.loopMarkerOut != null) {
      this.applyMarkerLoop();
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
        title: `${this.formatTime(loopStart)} - ${this.formatTime(loopEnd)}`,
      };

      this.playerService.createSegmentLoop(loopStart, loopEnd);
      // Ensure we are inside the loop even if current time is after OUT (or before IN)
      const now = this.playerService.getCurrentTime();
      if (now < loopStart || now > loopEnd) {
        this.playerService.seek(loopStart);
      }
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

  // ========================================
  // Explicit Loop Markers API
  // ========================================

  private setLoopMarkIn(): void {
    try {
      const t = this.playerService.getCurrentTime();
      const vid = this.playerService.getDuration();
      this.loopMarkerIn = Math.min(Math.max(0, t), Math.max(0, vid));
      this.showActionToast(`Mark In: ${this.formatTime(this.loopMarkerIn)}`, 'success', 1200);
      this.updateLoopDisplay();
    } catch (error) {
      this.logger?.warn('Failed to set Mark In', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      this.showActionToast('Failed to set Mark In', 'error', 1500);
    }
  }

  private setLoopMarkOut(): void {
    try {
      const t = this.playerService.getCurrentTime();
      const vid = this.playerService.getDuration();
      this.loopMarkerOut = Math.min(Math.max(0, t), Math.max(0, vid));
      this.showActionToast(`Mark Out: ${this.formatTime(this.loopMarkerOut)}`, 'success', 1200);
      this.updateLoopDisplay();
    } catch (error) {
      this.logger?.warn('Failed to set Mark Out', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      this.showActionToast('Failed to set Mark Out', 'error', 1500);
    }
  }

  private applyMarkerLoop(): void {
    const start = this.loopMarkerIn;
    const end = this.loopMarkerOut;
    const vid = this.playerService.getDuration();

    if (start == null || end == null) {
      this.showActionToast('Set IN and OUT markers first', 'warning', 1500);
      return;
    }
    const loopStart = Math.max(0, Math.min(start, end));
    const loopEndRaw = Math.max(start, end);
    // If current time is beyond end, still allow loop creation; seeking will wrap
    const loopEnd = vid > 0 ? Math.min(loopEndRaw, vid) : loopEndRaw;
    if (loopEnd - loopStart < 0.1) {
      this.showActionToast('Loop too short', 'warning', 1500);
      return;
    }

    try {
      this.playerService.createSegmentLoop(loopStart, loopEnd);
      // Ensure we are inside the loop even if current time is after OUT (or before IN)
      const now = this.playerService.getCurrentTime();
      if (now < loopStart || now > loopEnd) {
        this.playerService.seek(loopStart);
      }
      this.currentLoop = {
        id: `loop_${Date.now()}`,
        startTime: loopStart,
        endTime: loopEnd,
        isActive: true,
        title: `${this.formatTime(loopStart)} - ${this.formatTime(loopEnd)}`,
      };
      this.updateLoopDisplay();
      this.updateCurrentState();
      this.showActionToast(`Loop: ${this.currentLoop.title}`, 'success', 1600);
    } catch (error) {
      this.logger?.error('Failed to apply marker loop', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { error: error instanceof Error ? error.message : String(error), loopStart, loopEnd },
      });
      this.showActionToast('Failed to apply loop', 'error', 1600);
    }
  }

  private handleLoopIndicatorClick(): void {
    // 1st click: set IN, 2nd: set OUT, 3rd: clear markers + loop
    if (this.loopMarkerIn == null) {
      this.setLoopMarkIn();
      return;
    }
    if (this.loopMarkerOut == null) {
      this.setLoopMarkOut();
      return;
    }
    // Both set -> clear all
    this.loopMarkerIn = null;
    this.loopMarkerOut = null;
    if (this.currentLoop) {
      this.clearLoop();
    } else {
      this.updateLoopDisplay();
    }
    this.showActionToast('Loop cleared', 'success', 1200);
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
        if (this.loopMarkerIn != null || this.loopMarkerOut != null) {
          const inTxt = this.loopMarkerIn != null ? this.formatTime(this.loopMarkerIn) : '--:--';
          const outTxt = this.loopMarkerOut != null ? this.formatTime(this.loopMarkerOut) : '--:--';
          loopIndicator.textContent = `IN ${inTxt} · OUT ${outTxt}`;
        } else {
          loopIndicator.textContent = 'No Loop';
        }
        loopIndicator.classList.remove('active');
        loopBtn.classList.remove('active');
      }
    }
  }

  private navigateSentence(direction: 'previous' | 'next'): void {
    try {
      const currentTime = this.playerService.getCurrentTime();
      let targetTime: number;

      // If the current track exposes precomputed groups, use them exclusively
      const groupFirst = this.findPrecomputedGroupTarget(direction, currentTime);
      if (groupFirst !== null) {
        this.playerService.seek(groupFirst);
        this.emitEvent({
          type: 'sentence_nav',
          value: { direction, fromTime: currentTime, toTime: groupFirst },
          timestamp: Date.now(),
        });
        return;
      }

      // Fallback only if groups are not available (non-auto tracks)
      if (this.sentenceLoopingService && this.isInitialized) {
        const sentences = this.sentenceLoopingService.getAvailableSentences();
        const currentSentence = this.sentenceLoopingService.getSentenceAtTime(currentTime);

        if (sentences.length > 0) {
          this.logger?.debug('Sentence navigation - computing target', {
            component: ComponentType.YOUTUBE_INTEGRATION,
            metadata: {
              direction,
              currentTime,
              sentences: sentences.length,
              hasCurrentSentence: !!currentSentence,
            },
          });
          // When the track is auto-generated, prefer group (event) navigation over sentence heuristic
          const track = this.playerService.getCurrentSubtitleTrack();
          if (track?.isAutoGenerated) {
            // Navigate strictly by precomputed groups from track
            const groupTarget = this.findPrecomputedGroupTarget(direction, currentTime);
            if (groupTarget !== null) {
              this.logger?.debug('Auto track: using precomputed group target', {
                component: ComponentType.YOUTUBE_INTEGRATION,
                metadata: { fromTime: currentTime, toTime: groupTarget },
              });
              this.playerService.seek(groupTarget);
              this.emitEvent({
                type: 'sentence_nav',
                value: { direction, fromTime: currentTime, toTime: groupTarget },
                timestamp: Date.now(),
              });
              return;
            }
          }

          const currentIndex = currentSentence
            ? sentences.findIndex((s) => s.startIndex === currentSentence.startIndex)
            : -1;
          let targetIndex = -1;
          if (direction === 'next') {
            if (currentIndex >= 0 && currentIndex < sentences.length - 1) {
              targetIndex = currentIndex + 1;
            } else {
              targetIndex = sentences.findIndex((s) => s.segments[0].startTime > currentTime);
              if (targetIndex === -1) targetIndex = sentences.length - 1;
            }
          } else {
            if (currentIndex > 0) {
              targetIndex = currentIndex - 1;
            } else {
              for (let i = sentences.length - 1; i >= 0; i--) {
                const end = sentences[i].segments[sentences[i].segments.length - 1].endTime;
                if (end < currentTime) {
                  targetIndex = i;
                  break;
                }
              }
              if (targetIndex === -1) targetIndex = 0;
            }
          }

          let targetSentence = sentences[Math.max(0, Math.min(targetIndex, sentences.length - 1))];
          if (targetSentence && targetSentence.segments.length > 0) {
            // Clamp target time within video duration and apply a tiny buffer to avoid overshoot
            const duration = this.playerService.getDuration();
            const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
            targetTime = Math.max(0, Math.min(safeDuration, targetSentence.segments[0].startTime));

            // Ensure forward navigation produces a meaningful jump
            const minForwardDelta = 0.5; // seconds
            if (direction === 'next' && targetTime <= currentTime + minForwardDelta) {
              // Try to find the first sentence that starts sufficiently after current time
              const s2 = sentences.find(
                (s) => s.segments[0].startTime > currentTime + minForwardDelta,
              );
              if (s2) {
                targetSentence = s2;
                targetTime = Math.max(0, Math.min(safeDuration, s2.segments[0].startTime));
                this.logger?.debug('Sentence navigation - advanced to farther next sentence', {
                  component: ComponentType.YOUTUBE_INTEGRATION,
                  metadata: {
                    fromTime: currentTime,
                    toTime: targetTime,
                  },
                });
              } else {
                // As a last resort, use cue fallback beyond the delta or add small step
                const cueAfter = this.findCueTarget('next', currentTime + minForwardDelta);
                if (cueAfter !== null && cueAfter > currentTime + minForwardDelta) {
                  targetTime = Math.min(safeDuration, cueAfter);
                  this.logger?.debug('Sentence navigation - next using cue-after fallback', {
                    component: ComponentType.YOUTUBE_INTEGRATION,
                    metadata: {
                      fromTime: currentTime,
                      toTime: targetTime,
                    },
                  });
                } else {
                  targetTime = Math.min(safeDuration, currentTime + 1.0);
                  this.logger?.debug('Sentence navigation - next minimal step fallback', {
                    component: ComponentType.YOUTUBE_INTEGRATION,
                    metadata: {
                      fromTime: currentTime,
                      toTime: targetTime,
                    },
                  });
                }
              }
            }
            this.logger?.debug('Sentence navigation - seeking', {
              component: ComponentType.YOUTUBE_INTEGRATION,
              metadata: {
                direction,
                currentIndex,
                targetIndex: Math.max(0, Math.min(targetIndex, sentences.length - 1)),
                fromTime: currentTime,
                toTime: targetTime,
                duration,
              },
            });
            // If computed jump is unreasonably large, fall back to cue-level navigation
            const largeJump = Math.abs(targetTime - currentTime) > 20;
            const cueFallback = largeJump ? this.findCueTarget(direction, currentTime) : null;
            if (cueFallback !== null) {
              this.logger?.debug('Sentence navigation - using cue fallback', {
                component: ComponentType.YOUTUBE_INTEGRATION,
                metadata: { fromTime: currentTime, toTime: cueFallback },
              });
              targetTime = cueFallback;
            }

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
                sentenceIndex: Math.max(0, Math.min(targetIndex, sentences.length - 1)),
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

        let sentenceToReplay = currentSentence;

        // If not inside a sentence (e.g., in a gap), choose the nearest previous sentence
        if (!sentenceToReplay) {
          const sentences = this.sentenceLoopingService.getAvailableSentences();
          if (sentences.length > 0) {
            let idx = -1;
            for (let i = sentences.length - 1; i >= 0; i--) {
              const end = sentences[i].segments[sentences[i].segments.length - 1].endTime;
              if (end <= currentTime) {
                idx = i;
                break;
              }
            }
            if (idx === -1) idx = 0;
            sentenceToReplay = sentences[idx];
          }
        }

        if (sentenceToReplay && sentenceToReplay.segments.length > 0) {
          const duration = this.playerService.getDuration();
          const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
          const startTime = Math.max(0, Math.min(safeDuration, sentenceToReplay.segments[0].startTime));
          // If computed jump is unreasonably large, fall back to previous cue start
          const largeJump = Math.abs(startTime - currentTime) > 20;
          let finalStart = startTime;
          if (largeJump) {
            const cueFallback = this.findCueTarget('previous', currentTime);
            if (cueFallback !== null) {
              this.logger?.debug('Sentence replay - using cue fallback', {
                component: ComponentType.YOUTUBE_INTEGRATION,
                metadata: { fromTime: currentTime, toTime: cueFallback },
              });
              finalStart = cueFallback;
            }
          }

          this.logger?.debug('Sentence replay - seeking', {
            component: ComponentType.YOUTUBE_INTEGRATION,
            metadata: {
              fromTime: currentTime,
              toTime: finalStart,
              duration,
              hasCurrentSentence: !!currentSentence,
            },
          });

          // Seek to the beginning of the sentence (or cue fallback)
          this.playerService.seek(finalStart);

          // Show visual feedback
          this.showActionToast('Replaying sentence', 'success', 1000);

          this.emitEvent({
            type: 'sentence_nav',
            value: {
              direction: 'replay',
              fromTime: currentTime,
              toTime: finalStart,
              sentence: sentenceToReplay.combinedText,
              sentenceIndex: this.sentenceLoopingService
                .getAvailableSentences()
                .findIndex((s) => s.startIndex === sentenceToReplay!.startIndex),
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
            totalSegments: sentences.reduce((sum, s) => sum + s.segments.length, 0),
          },
        });
        this.showActionToast('Subtitle not found', 'error', 1500);
        return;
      }

      // Find the specific segment within the sentence for precise timing
      const targetSegment = targetSentence.segments.find((segment) => segment.id === subtitleId);
      const currentTime = this.playerService.getCurrentTime();

      // Use segment start time if found, otherwise use sentence start time
      const baseTargetTime = targetSegment
        ? targetSegment.startTime
        : targetSentence.segments[0].startTime;

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
            segmentStartTime: baseTargetTime,
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
        1500,
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
    this.logger?.debug('toggleVocabularyMode() called - vocabulary highlighting mode', {
      component: ComponentType.WORD_LOOKUP,
    });
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
    this.logger?.debug('toggleVocabularyList() called - vocabulary list visibility', {
      component: ComponentType.WORD_LOOKUP,
    });
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
        this.vocabularyListManager
          .show()
          .then(() => {
            this.logger?.debug('Vocabulary list shown successfully', {
              component: ComponentType.YOUTUBE_INTEGRATION,
            });
          })
          .catch((error) => {
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

  private toggleSubtitles(): void {
    if (!this.dualSubtitleManager) {
      this.logger?.warn('Cannot toggle subtitles - DualSubtitleManager not available', {
        component: ComponentType.YOUTUBE_INTEGRATION,
      });
      this.showActionToast('Subtitles not available', 'error', 2000);
      return;
    }

    const subtitleComponent = this.dualSubtitleManager.getSubtitleComponent();
    if (!subtitleComponent) {
      this.logger?.warn('Cannot toggle subtitles - DualSubtitleComponent not available', {
        component: ComponentType.YOUTUBE_INTEGRATION,
      });
      this.showActionToast('Subtitles not ready', 'error', 2000);
      return;
    }

    try {
      // Toggle the extension's dual subtitle visibility and force UI sync
      const newVisibility = subtitleComponent.toggleVisibility();
      this.subtitlesVisible = newVisibility;
      // Force update of the subtitle component's container class to avoid flicker
      if (newVisibility) {
        subtitleComponent.show();
      } else {
        subtitleComponent.hide();
      }

      this.logger?.debug('Extension subtitles toggled', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          subtitlesVisible: this.subtitlesVisible,
        },
      });
    } catch (error) {
      this.logger?.warn('Failed to toggle extension subtitles', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.showActionToast('Failed to toggle subtitles', 'error', 2000);
      return;
    }

    this.updateSubtitleDisplay();
    this.updateCurrentState();

    // Show visual feedback
    this.showActionToast(
      `LinguaTube Subtitles: ${this.subtitlesVisible ? 'ON' : 'OFF'}`,
      'success',
      1500,
    );

    this.emitEvent({
      type: 'subtitle_visibility',
      value: this.subtitlesVisible,
      timestamp: Date.now(),
    });
  }

  private updateSubtitleDisplay(): void {
    if (!this.shadowRoot) return;

    const subtitleBtn = this.shadowRoot.querySelector('.subtitle-control .subtitle-toggle-btn');
    const subtitleIndicator = this.shadowRoot.querySelector(
      '.subtitle-control .subtitle-indicator',
    );

    if (subtitleBtn && subtitleIndicator) {
      if (this.subtitlesVisible) {
        subtitleIndicator.textContent = 'ON';
        subtitleBtn.classList.add('active');
        subtitleBtn.setAttribute('title', 'Hide Subtitles');
      } else {
        subtitleIndicator.textContent = 'OFF';
        subtitleBtn.classList.remove('active');
        subtitleBtn.setAttribute('title', 'Show Subtitles');
      }
    }
  }

  // ========================================
  // Cue-level Fallback Navigation
  // ========================================
  // Fall back to raw cue edges if sentence detection yields implausible jumps
  private findCueTarget(direction: 'previous' | 'next', currentTime: number): number | null {
    try {
      const track = this.playerService.getCurrentSubtitleTrack();
      if (!track || !track.cues || track.cues.length === 0) return null;

      // Build a simple ordered list of cue start times
      const cues = track.cues.slice().sort((a, b) => a.startTime - b.startTime);

      // If track is auto-generated, skip cumulative duplicates by collapsing
      const deduped: typeof cues = [];
      let lastText = '';
      for (const c of cues) {
        if (track.isAutoGenerated) {
          // Many auto tracks have repeated cumulative text; keep only changes
          if (c.text && c.text !== lastText) {
            deduped.push(c);
            lastText = c.text;
          }
          continue;
        }
        deduped.push(c);
      }
      const list = deduped.length > 0 ? deduped : cues;

      if (direction === 'next') {
        const nextCue = list.find((c) => c.startTime > currentTime + 0.01);
        return typeof nextCue?.startTime === 'number' ? Math.max(0, nextCue.startTime) : null;
      } else {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].endTime < currentTime - 0.01) {
            return Math.max(0, list[i].startTime);
          }
        }
        return Math.max(0, list[0].startTime);
      }
    } catch {
      return null;
    }
  }

  // Build group-level targets from auto-generated cues by collapsing cumulative frames
  private findCueGroupTarget(direction: 'previous' | 'next', currentTime: number): number | null {
    try {
      const track = this.playerService.getCurrentSubtitleTrack();
      if (!track || !track.cues || track.cues.length === 0) return null;

      const cues = track.cues.slice().sort((a, b) => a.startTime - b.startTime);

      // Collapse cumulative frames: group by stable text plateaus and sufficient duration
      const groups: Array<{ start: number; end: number; text: string }> = [];
      let groupStart = cues[0].startTime;
      let groupText = cues[0].text || '';
      let lastEnd = cues[0].endTime;

      const flush = () => {
        groups.push({ start: groupStart, end: lastEnd, text: groupText });
      };

      for (let i = 1; i < cues.length; i++) {
        const c = cues[i];
        const textChanged = (c.text || '') !== groupText;
        const gap = c.startTime - lastEnd;
        if (textChanged || gap > 0.4) {
          flush();
          groupStart = c.startTime;
          groupText = c.text || '';
        }
        lastEnd = Math.max(lastEnd, c.endTime);
      }
      flush();

      // Deduplicate very short groups by merging with neighbors (< 0.8s)
      const merged: typeof groups = [];
      for (const g of groups) {
        const dur = g.end - g.start;
        if (merged.length > 0 && dur < 0.8) {
          merged[merged.length - 1].end = g.end;
          merged[merged.length - 1].text = g.text;
        } else {
          merged.push({ ...g });
        }
      }

      if (direction === 'next') {
        const next = merged.find((g) => g.start > currentTime + 0.05);
        return next ? next.start : null;
      } else {
        for (let i = merged.length - 1; i >= 0; i--) {
          if (merged[i].end < currentTime - 0.05) return merged[i].start;
        }
        return merged.length > 0 ? merged[0].start : null;
      }
    } catch {
      return null;
    }
  }

  // Use precomputed groups on the track when available (simplest, most reliable)
  private findPrecomputedGroupTarget(
    direction: 'previous' | 'next',
    currentTime: number,
  ): number | null {
    try {
      const track = this.playerService.getCurrentSubtitleTrack();
      const groups = track?.groups || [];
      if (!track || !track.isAutoGenerated || groups.length === 0) return null;
      const ordered = groups.slice().sort((a, b) => a.startTime - b.startTime);
      if (direction === 'next') {
        const next = ordered.find((g) => g.startTime > currentTime + 0.01);
        return next ? next.startTime : null;
      }
      for (let i = ordered.length - 1; i >= 0; i--) {
        if (ordered[i].endTime < currentTime - 0.01) return ordered[i].startTime;
      }
      return ordered.length > 0 ? ordered[0].startTime : null;
    } catch {
      return null;
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
    // Define keyboard shortcuts - ALL CAREFULLY CHOSEN TO AVOID YOUTUBE CONFLICTS
    // YouTube reserved keys: k,j,l,f,t,i,m,c,o,w,+,-,0-9,comma,period,<,>,P,N,ESCAPE
    // Safe extension keys: q,r,e,u,a,s,d,g,h,v,b,x,z and modifier combinations

    // Navigation (safe - arrows not used by YouTube for playback)
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

    // Loop control - CHANGED from 'n' to 'g' (YouTube uses Shift+N for next video)
    this.keyboardShortcuts.set('KeyG', () => {
      this.toggleLoop();
    });

    // Vocabulary mode (safe - 'v' not used by YouTube)
    this.keyboardShortcuts.set('KeyV', () => {
      this.toggleVocabularyMode();
    });

    // Vocabulary list toggle with modifiers (safe)
    this.keyboardShortcuts.set('Ctrl+KeyV', () => {
      this.toggleVocabularyList();
    });

    this.keyboardShortcuts.set('Meta+KeyV', () => {
      this.toggleVocabularyList();
    });

    // Vocabulary list - CHANGED from 'l' to 'q' (YouTube uses 'l' for fast forward 10s)
    this.keyboardShortcuts.set('KeyQ', () => {
      this.toggleVocabularyList();
    });

    // Subtitles - CHANGED from 'c' to 's' (YouTube uses 'c' for captions)
    this.keyboardShortcuts.set('KeyS', () => {
      this.toggleSubtitles();
    });

    // Reset speed (safe - 'r' not used by YouTube)
    this.keyboardShortcuts.set('KeyR', () => {
      this.resetSpeed();
    });

    // Mark In/Out and apply markers (safe keys)
    this.keyboardShortcuts.set('KeyA', () => {
      this.setLoopMarkIn();
    });

    this.keyboardShortcuts.set('KeyD', () => {
      this.setLoopMarkOut();
    });

    this.keyboardShortcuts.set('KeyH', () => {
      this.applyMarkerLoop();
    });

    // Replay current sentence (safe - 'e' not used by YouTube)
    this.keyboardShortcuts.set('KeyE', () => {
      this.replayCurrentSentence();
    });

    // Time skipping - CHANGED from comma/period to z/x (YouTube uses comma/period for frame navigation)
    this.keyboardShortcuts.set('KeyZ', () => {
      this.skipTime(-1);
    });

    this.keyboardShortcuts.set('KeyX', () => {
      this.skipTime(1);
    });

    // Speed presets - CHANGED from digits to Shift+digits (YouTube uses 0-9 for seeking)
    this.keyboardShortcuts.set('Shift+Digit1', () => {
      this.setPlaybackSpeed(0.25);
    });

    this.keyboardShortcuts.set('Shift+Digit2', () => {
      this.setPlaybackSpeed(0.5);
    });

    this.keyboardShortcuts.set('Shift+Digit3', () => {
      this.setPlaybackSpeed(0.75);
    });

    this.keyboardShortcuts.set('Shift+Digit4', () => {
      this.setPlaybackSpeed(1.0);
    });

    this.keyboardShortcuts.set('Shift+Digit5', () => {
      this.setPlaybackSpeed(1.25);
    });

    this.keyboardShortcuts.set('Shift+Digit6', () => {
      this.setPlaybackSpeed(1.5);
    });

    this.keyboardShortcuts.set('Shift+Digit7', () => {
      this.setPlaybackSpeed(1.75);
    });

    this.keyboardShortcuts.set('Shift+Digit8', () => {
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
      this.logger?.debug('Keyboard shortcut triggered', {
        component: ComponentType.YOUTUBE_INTEGRATION,
        metadata: { shortcutKey, eventCode: event.code, key: event.key },
      });
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
      if (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        (activeElement as HTMLElement).contentEditable === 'true'
      ) {
        return true;
      }

      // Check if activeElement is a shadow host that might contain input fields
      const shadowRoot = (activeElement as any).shadowRoot;
      if (shadowRoot) {
        const shadowActiveElement = shadowRoot.activeElement;
        if (
          shadowActiveElement &&
          (shadowActiveElement.tagName === 'INPUT' ||
            shadowActiveElement.tagName === 'TEXTAREA' ||
            (shadowActiveElement as HTMLElement).contentEditable === 'true')
        ) {
          return true;
        }
      }
    }

    // Check event target as well
    const target = event.target as HTMLElement;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.contentEditable === 'true')
    ) {
      return true;
    }

    // Check if we're inside vocabulary list container (which might use shadow DOM)
    const vocabularyContainer = document.getElementById('linguatube-vocabulary-list-container');
    if (vocabularyContainer && vocabularyContainer.contains(target)) {
      // If event is happening inside vocabulary list, check if it's from an input
      const inputs = vocabularyContainer.querySelectorAll(
        'input, textarea, [contenteditable="true"]',
      );
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
          const shadowInputs = shadowRoot.querySelectorAll(
            'input, textarea, [contenteditable="true"]',
          );
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
    // Ensure base position is centered if not custom-dragged
    if (!this.controlsContainer.hasAttribute('data-custom-x')) {
      if (this.config.position === 'bottom') {
        this.controlsContainer.style.left = '50%';
        this.controlsContainer.style.transform = 'translateX(-50%)';
        this.controlsContainer.style.bottom = '24px';
        this.controlsContainer.style.top = '';
        this.controlsContainer.style.right = '';
      } else if (this.config.position === 'top') {
        this.controlsContainer.style.left = '50%';
        this.controlsContainer.style.transform = 'translateX(-50%)';
        this.controlsContainer.style.top = '24px';
        this.controlsContainer.style.bottom = '';
        this.controlsContainer.style.right = '';
      } else if (this.config.position === 'floating') {
        this.controlsContainer.style.right = '24px';
        this.controlsContainer.style.bottom = '24px';
        this.controlsContainer.style.left = 'auto';
        this.controlsContainer.style.transform = 'none';
      }
    }
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
        title: `${this.formatTime(loopStart)} - ${this.formatTime(loopEnd)}`,
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

  public setDualSubtitleManager(manager: DualSubtitleManager): void {
    this.dualSubtitleManager = manager;

    // Sync subtitle visibility state with the actual component
    const subtitleComponent = manager.getSubtitleComponent();
    if (subtitleComponent) {
      this.subtitlesVisible = subtitleComponent.getVisibility();
      this.updateSubtitleDisplay();

      // Keep UI state in sync with real subtitle visibility changes (e.g., when
      // subtitles first appear after cues arrive). This fixes the initial state
      // mismatch where the indicator could show OFF while subtitles are visible.
      subtitleComponent.addVisibilityListener((visible) => {
        this.subtitlesVisible = visible;
        this.updateSubtitleDisplay();
        this.updateCurrentState();
      });
    }

    this.logger?.debug('Dual subtitle manager set', {
      component: ComponentType.YOUTUBE_INTEGRATION,
      metadata: {
        managerReady: manager.isReady(),
        subtitlesVisible: this.subtitlesVisible,
      },
    });
  }

  // ========================================
  // Public Subtitle Control API
  // ========================================

  public getSubtitleVisibility(): boolean {
    return this.subtitlesVisible;
  }

  public setSubtitleVisibility(visible: boolean): void {
    if (!this.dualSubtitleManager) {
      this.logger?.warn('Cannot set subtitle visibility - DualSubtitleManager not available', {
        component: ComponentType.YOUTUBE_INTEGRATION,
      });
      return;
    }

    const subtitleComponent = this.dualSubtitleManager.getSubtitleComponent();
    if (!subtitleComponent) {
      this.logger?.warn('Cannot set subtitle visibility - DualSubtitleComponent not available', {
        component: ComponentType.YOUTUBE_INTEGRATION,
      });
      return;
    }

    const currentVisibility = subtitleComponent.getVisibility();
    if (currentVisibility !== visible) {
      if (visible) {
        subtitleComponent.show();
      } else {
        subtitleComponent.hide();
      }
      this.subtitlesVisible = visible;
      this.updateSubtitleDisplay();
      this.updateCurrentState();
    }
  }

  public toggleSubtitleVisibility(): boolean {
    this.toggleSubtitles();
    return this.subtitlesVisible;
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
    subtitlesVisible: boolean;
    collapsed: boolean;
    config: EnhancedControlsConfig;
  } {
    return {
      isReady: this.isReady(),
      isVisible: this.getVisibility(),
      currentSpeed: this.currentSpeed,
      currentLoop: this.currentLoop,
      vocabularyModeActive: this.vocabularyModeActive,
      vocabularyListVisible: this.vocabularyListVisible,
      subtitlesVisible: this.subtitlesVisible,
      collapsed: this.isCollapsed,
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
      // Never persist loop across refreshes
      const toSave = { ...this.currentState, loop: null };
      const result = await this.storageService.setCache(stateKey, toSave, 86400);

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

      // Do not restore loop state on refresh/startup
      this.currentLoop = null;
      this.updateLoopDisplay();

      // Update state tracking
      this.currentState = {
        ...savedState,
        sessionStartTime: Date.now(), // Reset session time
        lastPosition: this.playerService.getCurrentTime(),
        loop: null, // ensure loop is not persisted/restored
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
      subtitlesVisible: this.subtitlesVisible,
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

    // Update state every 10 seconds (but never persist loop)
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
        subtitlesVisible: true,
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
      // In fullscreen, leave base positioning (top center) unless user dragged it
      if (this.controlsContainer && !this.controlsContainer.hasAttribute('data-custom-x')) {
        this.controlsContainer.classList.remove('custom-position');
        this.controlsContainer.style.left = '50%';
        this.controlsContainer.style.top = '10px';
        this.controlsContainer.style.transform = 'translateX(-50%)';
        this.controlsContainer.style.right = '';
        this.controlsContainer.style.bottom = '';
      }
      this.showActionToast('Fullscreen mode', 'success', 1500);
    } else {
      this.container.classList.remove('fullscreen-mode');

      // Reset inline styles set during fullscreen
      if (this.controlsContainer) {
        if (!this.controlsContainer.hasAttribute('data-custom-x')) {
          this.controlsContainer.classList.remove('custom-position');
          this.controlsContainer.style.left = '';
          this.controlsContainer.style.top = '';
          this.controlsContainer.style.right = '';
          this.controlsContainer.style.bottom = '';
          this.controlsContainer.style.transform = '';
        }
      }

      // Reset to normal positioning
      this.updateControlsPosition();

      // Show exit fullscreen feedback
      this.showActionToast('Exited fullscreen', 'success', 1500);
    }
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
  public jumpToSubtitleWithContext(
    subtitleId: string,
    options?: {
      bufferTime?: number;
      highlightDuration?: number;
      enableAutoLoop?: boolean;
    },
  ): boolean {
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
      const baseTargetTime = targetSegment
        ? targetSegment.startTime
        : targetSentence.segments[0].startTime;
      const targetTime = Math.max(0, baseTargetTime - bufferTime);

      // Perform navigation
      this.playerService.seek(targetTime);

      // Provide enhanced visual feedback
      this.showActionToast(
        `Jumped to: "${targetSentence.combinedText.substring(0, 30)}..."`,
        'success',
        highlightDuration,
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
  public jumpToVocabularyWord(
    word: string,
    options?: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
      bufferTime?: number;
    },
  ): boolean {
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
            sampleSentences: sentences
              .slice(0, 3)
              .map((s) => s.combinedText.substring(0, 50) + '...'),
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
        2500,
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
