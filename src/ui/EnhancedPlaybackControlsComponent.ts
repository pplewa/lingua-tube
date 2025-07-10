/**
 * Enhanced Playback Controls Component for LinguaTube
 * Provides language learning-focused playback controls including segment looping,
 * variable speed control, sentence navigation, and vocabulary integration.
 */

import { PlayerInteractionService, PlayerEvent, PlayerState } from '../youtube/PlayerInteractionService';
import { StorageService } from '../storage';
import { UserSettings } from '../storage/types';
import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { SentenceLoopingService, SentenceLoop, LoopEvent } from './SentenceLoopingService';

// ========================================
// Types and Interfaces
// ========================================

export interface EnhancedControlsConfig {
  readonly showSpeedControl: boolean;
  readonly showLoopControl: boolean;
  readonly showSentenceNavigation: boolean;
  readonly showVocabularyMode: boolean;
  readonly showTimeDisplay: boolean;
  readonly compactMode: boolean;
  readonly position: 'bottom' | 'top' | 'floating';
  readonly theme: 'dark' | 'light' | 'auto';
  readonly opacity: number; // 0.1-1.0
  readonly autoHide: boolean;
  readonly autoHideDelay: number; // milliseconds
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
  readonly type: 'speed_change' | 'loop_toggle' | 'sentence_nav' | 'vocabulary_mode';
  readonly value: any;
  readonly timestamp: number;
}

export type ControlsEventCallback = (event: ControlsEventData) => void;

// ========================================
// Constants and Default Configuration
// ========================================

const DEFAULT_CONFIG: EnhancedControlsConfig = {
  showSpeedControl: true,
  showLoopControl: true,
  showSentenceNavigation: true,
  showVocabularyMode: true,
  showTimeDisplay: true,
  compactMode: false,
  position: 'bottom',
  theme: 'dark',
  opacity: 0.9,
  autoHide: true,
  autoHideDelay: 3000
};

const PLAYBACK_SPEEDS: PlaybackSpeed[] = [
  { value: 0.25, label: '0.25×', isDefault: false },
  { value: 0.5, label: '0.5×', isDefault: false },
  { value: 0.75, label: '0.75×', isDefault: false },
  { value: 1.0, label: '1×', isDefault: true },
  { value: 1.25, label: '1.25×', isDefault: false },
  { value: 1.5, label: '1.5×', isDefault: false },
  { value: 1.75, label: '1.75×', isDefault: false },
  { value: 2.0, label: '2×', isDefault: false }
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
    
    /* Container positioning */
    position: absolute;
    bottom: 60px; /* Above YouTube controls */
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483646; /* Just below subtitles */
    font-family: 'YouTube Sans', 'Roboto', Arial, sans-serif;
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
    transition: var(--controls-transition);
    pointer-events: auto;
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
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
  }

  .control-button.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .control-button.disabled:hover {
    background: transparent;
    transform: none;
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
  }

  .speed-button:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .speed-button.active {
    background: var(--controls-accent-color);
    border-color: var(--controls-accent-color);
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
  }

  .loop-indicator.active {
    background: var(--controls-accent-color);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  /* Time Display */
  .time-display {
    display: flex;
    align-items: center;
    gap: 4px;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    color: var(--controls-text-color);
    min-width: 80px;
  }

  /* Navigation Controls */
  .nav-control {
    display: flex;
    align-items: center;
    gap: 2px;
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
  }

  .vocabulary-indicator.active {
    background: rgba(76, 175, 80, 0.8);
    color: white;
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
  }

  /* Accessibility */
  @media (prefers-reduced-motion: reduce) {
    .controls-container,
    .control-button,
    .speed-button {
      transition: none;
    }
    
    .loop-indicator.active {
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
  }

  /* Tooltips */
  .control-button[title]:hover::after {
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
  }
`;

// ========================================
// Enhanced Playback Controls Component
// ========================================

export class EnhancedPlaybackControlsComponent {
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
  private sentenceLoopingService: SentenceLoopingService;
  
  private currentSpeed: number = 1.0;
  private currentLoop: LoopSegment | null = null;
  private vocabularyModeActive: boolean = false;
  
  private eventListeners: Set<ControlsEventCallback> = new Set();
  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  
  // Player event handlers
  private playerEventHandlers: Map<string, (event: any) => void> = new Map();
  private keyboardShortcuts: Map<string, () => void> = new Map();
  private keyboardEventHandler: (event: KeyboardEvent) => void;

  constructor(
    playerService: PlayerInteractionService,
    storageService: StorageService,
    initialConfig?: Partial<EnhancedControlsConfig>
  ) {
    this.playerService = playerService;
    this.storageService = storageService;
    this.vocabularyManager = VocabularyManager.getInstance();
    this.sentenceLoopingService = new SentenceLoopingService(playerService, storageService);
    this.keyboardEventHandler = this.handleKeyboardEvent.bind(this);

    if (initialConfig) {
      this.config = { ...this.config, ...initialConfig };
    }
    
    this.loadConfigFromStorage();
    this.setupPlayerEventHandlers();
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  public async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) {
        console.warn('[EnhancedPlaybackControls] Already initialized');
        return true;
      }

      // Find YouTube player container
      const playerContainer = this.findPlayerContainer();
      if (!playerContainer) {
        console.error('[EnhancedPlaybackControls] Could not find YouTube player container');
        return false;
      }

      // Create container element
      this.container = this.createContainer();
      if (!this.container) {
        console.error('[EnhancedPlaybackControls] Failed to create container');
        return false;
      }

      // Attach to player
      playerContainer.appendChild(this.container);

      // Create shadow DOM and content
      this.createShadowDOM();
      this.createControlElements();
      this.applyConfiguration();

      // Set up observers and event handlers
      this.setupResizeObserver();
      this.setupMutationObserver();
      this.setupPlayerEventListeners();
      this.setupInteractionHandlers();

      // Initialize sentence looping service
      const loopServiceInitialized = await this.sentenceLoopingService.initialize();
      if (!loopServiceInitialized) {
        console.warn('[EnhancedPlaybackControls] Failed to initialize sentence looping service');
      }

      // Set up sentence looping event listeners
      this.setupSentenceLoopingListeners();

      // Set up keyboard shortcuts
      this.setupKeyboardShortcuts();

      this.isInitialized = true;
      console.log('[EnhancedPlaybackControls] Initialized successfully');
      return true;

    } catch (error) {
      console.error('[EnhancedPlaybackControls] Initialization failed:', error);
      return false;
    }
  }

  public destroy(): void {
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
      
      this.isInitialized = false;
      console.log('[EnhancedPlaybackControls] Destroyed successfully');

    } catch (error) {
      console.error('[EnhancedPlaybackControls] Destroy failed:', error);
    }
  }

  private findPlayerContainer(): HTMLElement | null {
    const selectors = [
      '#movie_player',
      '.html5-video-player',
      '[data-layer="0"]',
      '.ytp-player-content'
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
    return element.offsetWidth > 0 && 
           element.offsetHeight > 0 && 
           element.querySelector('video') !== null;
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

    if (this.config.showTimeDisplay) {
      this.controlsContainer.appendChild(this.createTimeDisplay());
    }

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
    skip5BackBtn.addEventListener('click', () => this.skipTime(-5));

    // Previous sentence button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'control-button';
    prevBtn.innerHTML = '⏮';
    prevBtn.title = 'Previous Sentence';
    prevBtn.addEventListener('click', () => this.navigateSentence('previous'));

    // Replay current sentence button
    const replayBtn = document.createElement('button');
    replayBtn.className = 'control-button replay-button';
    replayBtn.innerHTML = '🔄';
    replayBtn.title = 'Replay Current Sentence';
    replayBtn.addEventListener('click', () => this.replayCurrentSentence());

    // Next sentence button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'control-button';
    nextBtn.innerHTML = '⏭';
    nextBtn.title = 'Next Sentence';
    nextBtn.addEventListener('click', () => this.navigateSentence('next'));

    // 5-second forward skip
    const skip5ForwardBtn = document.createElement('button');
    skip5ForwardBtn.className = 'control-button skip-button';
    skip5ForwardBtn.innerHTML = '5s⏩';
    skip5ForwardBtn.title = 'Skip Forward 5 Seconds';
    skip5ForwardBtn.addEventListener('click', () => this.skipTime(5));

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
    vocabBtn.className = 'control-button';
    vocabBtn.innerHTML = '📚';
    vocabBtn.title = 'Toggle Vocabulary Mode';
    vocabBtn.addEventListener('click', () => this.toggleVocabularyMode());

    // Vocabulary indicator
    const vocabIndicator = document.createElement('div');
    vocabIndicator.className = 'vocabulary-indicator';
    vocabIndicator.textContent = 'Normal';

    group.appendChild(vocabBtn);
    group.appendChild(vocabIndicator);

    return group;
  }

  private createTimeDisplay(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'control-group time-display';

    const timeText = document.createElement('span');
    timeText.textContent = '0:00 / 0:00';

    group.appendChild(timeText);

    return group;
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
      console.warn('[EnhancedPlaybackControls] Failed to load config from storage:', error);
    }
  }

  private updateConfigFromSettings(settings: UserSettings): void {
    // Update config based on user settings
    this.config = {
      ...this.config,
      theme: settings.ui.theme as 'dark' | 'light' | 'auto',
      compactMode: settings.ui.compactMode || false
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
    if (!this.shadowRoot) return;

    const root = this.shadowRoot.host as HTMLElement;
    
    switch (this.config.position) {
      case 'top':
        root.style.bottom = 'auto';
        root.style.top = '20px';
        break;
      case 'floating':
        this.controlsContainer?.classList.add('floating');
        break;
      case 'bottom':
      default:
        root.style.top = 'auto';
        root.style.bottom = '60px';
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
      
      this.emitEvent({
        type: 'speed_change',
        value: speed,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[EnhancedPlaybackControls] Failed to set playback speed:', error);
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
        title: `Loop ${this.formatTime(loopStart)} - ${this.formatTime(loopEnd)}`
      };
      
      this.playerService.createSegmentLoop(loopStart, loopEnd);
      this.updateLoopDisplay();
      
      this.emitEvent({
        type: 'loop_toggle',
        value: this.currentLoop,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[EnhancedPlaybackControls] Failed to create loop:', error);
    }
  }

  private clearLoop(): void {
    try {
      this.playerService.stopSegmentLoop();
      this.currentLoop = null;
      this.updateLoopDisplay();
      
      this.emitEvent({
        type: 'loop_toggle',
        value: null,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[EnhancedPlaybackControls] Failed to clear loop:', error);
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
          const currentIndex = currentSentence ? sentences.findIndex(s => s.startIndex === currentSentence.startIndex) : -1;
          let targetIndex: number;
          
          if (direction === 'next') {
            targetIndex = currentIndex < sentences.length - 1 ? currentIndex + 1 : sentences.length - 1;
          } else {
            targetIndex = currentIndex > 0 ? currentIndex - 1 : 0;
          }
          
          const targetSentence = sentences[targetIndex];
          if (targetSentence && targetSentence.segments.length > 0) {
            targetTime = targetSentence.segments[0].startTime;
            this.playerService.seek(targetTime);
            
            this.emitEvent({
              type: 'sentence_nav',
              value: { 
                direction, 
                fromTime: currentTime, 
                toTime: targetTime,
                sentence: targetSentence.combinedText,
                sentenceIndex: targetIndex
              },
              timestamp: Date.now()
            });
            return;
          }
        }
      }
      
      // Fallback to time-based navigation
      const jumpSeconds = direction === 'next' ? 5 : -5;
      targetTime = Math.max(0, currentTime + jumpSeconds);
      
      this.playerService.seek(targetTime);
      
      this.emitEvent({
        type: 'sentence_nav',
        value: { direction, fromTime: currentTime, toTime: targetTime },
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('[EnhancedPlaybackControls] Failed to navigate sentence:', error);
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
          skipSeconds: seconds
        },
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[EnhancedPlaybackControls] Failed to skip time:', error);
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
          
          this.emitEvent({
            type: 'sentence_nav',
            value: { 
              direction: 'replay',
              fromTime: currentTime, 
              toTime: startTime,
              sentence: currentSentence.combinedText,
              replayAction: true
            },
            timestamp: Date.now()
          });
          return;
        }
      }
      
      // Fallback: replay last 5 seconds if no sentence data available
      const replayTime = Math.max(0, currentTime - 5);
      this.playerService.seek(replayTime);
      
      this.emitEvent({
        type: 'sentence_nav',
        value: { 
          direction: 'replay',
          fromTime: currentTime, 
          toTime: replayTime,
          fallbackReplay: true,
          replaySeconds: 5
        },
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('[EnhancedPlaybackControls] Failed to replay current sentence:', error);
    }
  }

  private navigateToSubtitle(subtitleId: string): void {
    try {
      if (!this.sentenceLoopingService || !this.isInitialized) {
        console.warn('[EnhancedPlaybackControls] Sentence looping service not available');
        return;
      }

      const sentences = this.sentenceLoopingService.getAvailableSentences();
      const targetSentence = sentences.find(sentence => 
        sentence.segments.some(segment => segment.id === subtitleId)
      );

      if (targetSentence && targetSentence.segments.length > 0) {
        const currentTime = this.playerService.getCurrentTime();
        const targetTime = targetSentence.segments[0].startTime;
        
        this.playerService.seek(targetTime);
        
        this.emitEvent({
          type: 'sentence_nav',
          value: { 
            direction: targetTime > currentTime ? 'next' : 'previous',
            fromTime: currentTime, 
            toTime: targetTime,
            sentence: targetSentence.combinedText,
            subtitleId: subtitleId
          },
          timestamp: Date.now()
        });
      }
    } catch (error) {
      console.error('[EnhancedPlaybackControls] Failed to navigate to subtitle:', error);
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
          percentage: percentage
        },
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('[EnhancedPlaybackControls] Failed to jump to percentage:', error);
    }
  }

  private toggleVocabularyMode(): void {
    this.vocabularyModeActive = !this.vocabularyModeActive;
    this.updateVocabularyDisplay();
    
    this.emitEvent({
      type: 'vocabulary_mode',
      value: this.vocabularyModeActive,
      timestamp: Date.now()
    });
  }

  private updateVocabularyDisplay(): void {
    if (!this.shadowRoot) return;

    const vocabIndicator = this.shadowRoot.querySelector('.vocabulary-indicator');
    const vocabBtn = this.shadowRoot.querySelector('.vocabulary-mode .control-button');
    
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

  private updateTimeDisplay(): void {
    if (!this.shadowRoot) return;

    try {
      const currentTime = this.playerService.getCurrentTime();
      const duration = this.playerService.getDuration();
      
      const timeDisplay = this.shadowRoot.querySelector('.time-display span');
      if (timeDisplay) {
        timeDisplay.textContent = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
      }
    } catch (error) {
      // Silently fail for time display updates
    }
  }

  // ========================================
  // Event Handling and Player Integration
  // ========================================

  private setupPlayerEventHandlers(): void {
    this.playerEventHandlers.set('timeupdate', () => {
      this.updateTimeDisplay();
    });

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
            isActive: true
          };
          this.updateLoopDisplay();
          break;

        case 'loop_cancelled':
          this.currentLoop = null;
          this.updateLoopDisplay();
          break;

        case 'loop_completed':
          console.log('[EnhancedPlaybackControls] Loop completed:', event.loop.text);
          break;
      }
    });
  }

  private setupKeyboardShortcuts(): void {
    // Define keyboard shortcuts
    this.keyboardShortcuts.set('Space', () => {
      // Toggle play/pause
      try {
        const isPlaying = !this.playerService.isPaused();
        if (isPlaying) {
          this.playerService.pause();
        } else {
          this.playerService.play();
        }
      } catch (error) {
        console.warn('[EnhancedPlaybackControls] Failed to toggle play/pause:', error);
      }
    });

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

    this.keyboardShortcuts.set('KeyL', () => {
      this.toggleLoop();
    });

    this.keyboardShortcuts.set('KeyV', () => {
      this.toggleVocabularyMode();
    });

    this.keyboardShortcuts.set('KeyR', () => {
      this.resetSpeed();
    });

    this.keyboardShortcuts.set('KeyE', () => {
      this.replayCurrentSentence();
    });

    this.keyboardShortcuts.set('Comma', () => {
      this.skipTime(-5);
    });

    this.keyboardShortcuts.set('Period', () => {
      this.skipTime(5);
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
    
    const activeElement = document.activeElement;
    const isInputField = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      (activeElement as HTMLElement).contentEditable === 'true'
    );

    if (isInputField) return;

    // Build shortcut key from event
    let shortcutKey = '';
    
    if (event.ctrlKey) shortcutKey += 'Ctrl+';
    if (event.altKey) shortcutKey += 'Alt+';
    if (event.shiftKey) shortcutKey += 'Shift+';
    
    shortcutKey += event.code;

    // Check for shortcuts
    const handler = this.keyboardShortcuts.get(shortcutKey) || this.keyboardShortcuts.get(event.code);
    
    if (handler) {
      event.preventDefault();
      event.stopPropagation();
      handler();
    }
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
    
    activityEvents.forEach(eventType => {
      document.addEventListener(eventType, () => {
        this.resetAutoHide();
      }, { passive: true });
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
    if (!this.controlsContainer || this.isVisible) return;

    this.isVisible = true;
    this.controlsContainer.classList.remove('hidden');
  }

  public hide(): void {
    if (!this.controlsContainer || !this.isVisible) return;

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
        if (mutation.type === 'attributes' && 
            (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
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
        subtree: true
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
  // Utility Methods
  // ========================================

  private formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  private emitEvent(event: ControlsEventData): void {
    this.eventListeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[EnhancedPlaybackControls] Event listener error:', error);
      }
    });
  }
} 