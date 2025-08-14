/**
 * Dual Subtitle UI Component for LinguaTube
 * Displays dual-language subtitles over the YouTube video player with clickable words,
 * customization options, and proper isolation using shadow DOM
 */

import {
  PlayerInteractionService,
  SubtitleSyncEvent,
  ActiveSubtitleCue,
} from '../youtube/PlayerInteractionService';
import { StorageService } from '../storage';
import { UserSettings } from '../storage/types';
import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { VocabularyObserver, VocabularyEventType } from '../vocabulary/VocabularyObserver';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';
import { sortedPhrases } from '../subtitles/gazetter';
import { thaiSegmenterService } from '../subtitles/ThaiSegmenterService';
import { ttsService } from '../translation/TTSService';
import type { LanguageCode } from '../translation/types';

// ========================================
// Types and Interfaces
// ========================================

export interface DualSubtitleConfig {
  readonly showTargetLanguage: boolean;
  readonly showNativeLanguage: boolean;
  readonly fontSize: number; // 12-32px
  readonly fontFamily: string;
  readonly targetLanguageColor: string;
  readonly nativeLanguageColor: string;
  readonly backgroundColor: string;
  readonly opacity: number; // 0.1-1.0
  readonly verticalOffset: number; // -100 to 100 (percentage)
  readonly horizontalAlignment: 'left' | 'center' | 'right';
  readonly lineSpacing: number; // 1.0-2.0
  readonly wordSpacing: number; // 0.5-2.0
  readonly containerPadding: string; // 4-20px
  readonly borderRadius: number; // 0-8px
  readonly maxWidth: number; // 50-95% of player width
  readonly animationEnabled: boolean;
  readonly transitionDuration: number; // 100-500ms
  readonly clickableWords: boolean;
  readonly wordHighlightColor: string;
  readonly autoHideNative: boolean; // Hide native when target is clicked
  readonly textShadow: boolean;
  readonly textShadowColor: string;
}

export interface SubtitleCueDisplay {
  readonly id: string;
  readonly targetText: string;
  readonly nativeText: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly isActive: boolean;
  readonly words: WordSegment[];
}

export interface WordSegment {
  readonly text: string;
  readonly index: number;
  readonly isClickable: boolean;
  readonly translation?: string;
  readonly partOfSpeech?: string;
}

export interface SubtitlePosition {
  readonly x: number; // pixels from left
  readonly y: number; // pixels from top
  readonly width: number; // container width
  readonly height: number; // container height
}

export interface WordClickEvent {
  readonly word: string;
  readonly translation?: string;
  readonly context: string;
  readonly timestamp: number;
  readonly cueId: string;
  readonly position: { x: number; y: number };
}

export type WordClickCallback = (event: WordClickEvent) => void;
export type SubtitleVisibilityCallback = (visible: boolean, cueCount: number) => void;

// ========================================
// CSS Constants and Styling
// ========================================

const DEFAULT_CONFIG: DualSubtitleConfig = {
  showTargetLanguage: true,
  showNativeLanguage: true,
  fontSize: 24,
  fontFamily: '"YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif',
  targetLanguageColor: '#ffffff',
  nativeLanguageColor: '#cccccc',
  backgroundColor: 'transparent',
  opacity: 0.95,
  verticalOffset: -20, // 20% from bottom
  horizontalAlignment: 'center',
  lineSpacing: 1.2,
  wordSpacing: 1.0,
  containerPadding: '3px 10px',
  borderRadius: 4,
  maxWidth: 80,
  animationEnabled: true,
  transitionDuration: 200,
  clickableWords: true,
  wordHighlightColor: '#ffff00',
  autoHideNative: false,
  textShadow: true,
  textShadowColor: 'rgba(0, 0, 0, 0.8)',
};

const SUBTITLE_CONTAINER_STYLES = `
  :host {
    /* CSS Custom Properties for theming */
    --subtitle-font-size: 24px;
    --subtitle-font-family: "YouTube Noto", Roboto, Arial, Helvetica, Verdana, "PT Sans Caption", sans-serif;
    --subtitle-target-color: #ffffff;
    --subtitle-native-color: #cccccc;
    --subtitle-bg-color: transparent;
    --subtitle-opacity: 0.95;
    --subtitle-padding: 3px 10px 0px;
    --subtitle-border-radius: 4px;
    --subtitle-line-spacing: 1.2;
    --subtitle-word-spacing: 1.0;
    --subtitle-highlight-color: #ffff00;
    --subtitle-transition-duration: 200ms;
    --subtitle-text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
    
    /* Container positioning */
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647; /* Maximum z-index to stay above YouTube controls */
    font-size: 0; /* Reset font size for precise control */
  }

  .subtitle-container {
    position: absolute;
    max-width: var(--subtitle-max-width, 80%);
    padding: var(--subtitle-padding);
    background-color: var(--subtitle-bg-color);
    border-radius: var(--subtitle-border-radius);
    opacity: var(--subtitle-opacity);
    transform: translateX(-50%);
    pointer-events: auto;
    box-sizing: border-box;
    transition: all var(--subtitle-transition-duration) ease-in-out;
  }

  /* Custom drag position - override transform so left/top are respected */
  .subtitle-container.custom-position {
    transform: none;
  }

  .subtitle-container.hidden {
    opacity: 0;
    transform: translateX(-50%) translateY(10px);
    pointer-events: none;
  }

  .subtitle-line {
    display: block;
    text-align: left;
    line-height: var(--subtitle-line-spacing);
    margin: 3px;
    padding: 0;
    word-spacing: calc(var(--subtitle-word-spacing) * 0.2em);
  }

  .subtitle-line.target {
    font-size: var(--subtitle-font-size);
    font-family: var(--subtitle-font-family);
    color: var(--subtitle-target-color);
    font-weight: 600;
    text-shadow: var(--subtitle-text-shadow);
    margin-bottom: 4px;
  }

  .subtitle-line.native {
    font-size: calc(var(--subtitle-font-size) * 0.85);
    font-family: var(--subtitle-font-family);
    color: var(--subtitle-native-color);
    font-weight: 400;
    text-shadow: var(--subtitle-text-shadow);
  }

  /* Drag handle for repositioning subtitles */
  .subtitle-drag-handle {
    position: absolute;
    top: 0;
    left: 0;
    width: 8px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: rgba(255,255,255,0.08);
    color: #fff;
    font-size: 12px;
    cursor: grab;
    user-select: none;
    pointer-events: auto;
    z-index: 1;
  }
  .subtitle-drag-handle:hover { background: rgba(255,255,255,0.16); }
  .subtitle-drag-handle:active { cursor: grabbing; }

  .clickable-word {
    display: inline;
    cursor: pointer;
    padding: 1px 2px;
    border-radius: 2px;
    transition: background-color var(--subtitle-transition-duration) ease;
    position: relative;
  }

  .clickable-word:hover {
    background-color: var(--subtitle-highlight-color);
    color: #000000;
    text-shadow: none;
  }

  .clickable-word:active {
    background-color: var(--subtitle-highlight-color);
    color: #000000;
    transform: scale(0.98);
  }

  /* Vocabulary highlighting styles */
  .clickable-word.highlighted,
  .clickable-word.vocabulary-word {
    background-color: rgba(255, 235, 59, 0.8) !important;
    color: #000000 !important;
    text-shadow: none !important;
    border: 1px solid #ffc107;
    box-shadow: 0 0 4px rgba(255, 193, 7, 0.5);
    font-weight: 600;
    transition: all 0.2s ease-in-out;
    border-radius: 3px;
    outline: none;
  }

  .clickable-word.vocabulary-word:hover {
    background-color: rgba(255, 193, 7, 0.9) !important;
    box-shadow: 0 0 8px rgba(255, 193, 7, 0.8);
    transform: scale(1.02);
    border-color: #ff9800;
  }

  .clickable-word.vocabulary-word:focus {
    outline: 2px solid #2196f3;
    outline-offset: 2px;
    box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.3), 0 0 8px rgba(255, 193, 7, 0.8);
  }

  .clickable-word.vocabulary-word::after {
    content: '📚';
    position: absolute;
    top: -8px;
    right: -8px;
    font-size: 10px;
    background: rgba(255, 193, 7, 0.9);
    border-radius: 50%;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #ffc107;
    pointer-events: none;
    transition: all 0.2s ease-in-out;
    z-index: 1;
  }

  .clickable-word.vocabulary-word:hover::after {
    background: rgba(255, 152, 0, 0.95);
    border-color: #ff9800;
    transform: scale(1.1);
  }

  /* Screen reader support - hide decorative icon from screen readers */
  .clickable-word.vocabulary-word::after {
    -webkit-user-select: none;
    -moz-user-select: none;
    user-select: none;
  }

  /* High contrast mode icon */
  @media (prefers-contrast: high) {
    .clickable-word.vocabulary-word::after {
      background: #000000 !important;
      color: #ffffff;
      border: 2px solid #ffffff !important;
    }
  }

  /* Reduced motion for icon */
  @media (prefers-reduced-motion: reduce) {
    .clickable-word.vocabulary-word::after {
      transition: none !important;
    }
    
    .clickable-word.vocabulary-word:hover::after {
      transform: none !important;
    }
  }

  /* High contrast mode for vocabulary words */
  @media (prefers-contrast: high) {
    .clickable-word.vocabulary-word {
      background-color: #ffff00 !important;
      color: #000000 !important;
      border: 3px solid #000000 !important;
      box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #000000;
    }
    
    .clickable-word.vocabulary-word:hover {
      background-color: #ffeb3b !important;
    }
    
    .clickable-word.vocabulary-word:focus {
      outline: 3px solid #0000ff !important;
      outline-offset: 3px;
      box-shadow: 0 0 0 2px #ffffff, 0 0 0 5px #0000ff;
    }
  }

  /* Reduced motion for vocabulary highlighting */
  @media (prefers-reduced-motion: reduce) {
    .clickable-word.vocabulary-word {
      transition: none !important;
      transform: none !important;
    }
    
    .clickable-word.vocabulary-word:hover {
      transform: none !important;
    }
    
    .clickable-word.vocabulary-word:focus {
      transform: none !important;
    }
  }

  /* Dark mode optimization for vocabulary words */
  @media (prefers-color-scheme: dark) {
    .clickable-word.vocabulary-word {
      background-color: rgba(255, 193, 7, 0.9) !important;
      color: #000000 !important;
      border: 1px solid #ffb300;
    }
    
    .clickable-word.vocabulary-word:hover {
      background-color: rgba(255, 235, 59, 0.95) !important;
      border-color: #ffc107;
    }
  }

  /* Screen reader only content - accessible but visually hidden */
  .sr-only {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
  }

  .subtitle-container.compact .subtitle-line.native {
    display: none;
  }

  .subtitle-container.fade-in {
    animation: subtitleFadeIn var(--subtitle-transition-duration) ease-out;
  }

  .subtitle-container.fade-out {
    animation: subtitleFadeOut var(--subtitle-transition-duration) ease-in;
  }

  @keyframes subtitleFadeIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(10px);
    }
    to {
      opacity: var(--subtitle-opacity);
      transform: translateX(-50%) translateY(0);
    }
  }

  @keyframes subtitleFadeOut {
    from {
      opacity: var(--subtitle-opacity);
      transform: translateX(-50%) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(-10px);
    }
  }

  /* Responsive adjustments */
  @media (max-width: 768px) {
    .subtitle-container {
      max-width: 95%;
      padding: var(--subtitle-padding);
    }
    
    .subtitle-line.target {
      font-size: calc(var(--subtitle-font-size) * 0.9);
    }
    
    .subtitle-line.native {
      font-size: calc(var(--subtitle-font-size) * 0.75);
    }
  }

  /* High contrast mode support */
  @media (prefers-contrast: high) {
    .subtitle-container {
      background-color: rgba(0, 0, 0, 0.95);
      border: 1px solid #ffffff;
    }
    
    .subtitle-line.target {
      color: #ffffff;
      text-shadow: 2px 2px 0px #000000;
    }
    
    .subtitle-line.native {
      color: #e0e0e0;
      text-shadow: 2px 2px 0px #000000;
    }
  }

  /* Reduced motion support */
  @media (prefers-reduced-motion: reduce) {
    .subtitle-container,
    .clickable-word {
      transition: none;
    }
    
    .subtitle-container.fade-in,
    .subtitle-container.fade-out {
      animation: none;
    }
  }
`;

// ========================================
// Main Dual Subtitle Component Class
// ========================================

export class DualSubtitleComponent {
  private container: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private subtitleContainer: HTMLElement | null = null;
  private targetLine: HTMLElement | null = null;
  private nativeLine: HTMLElement | null = null;

  private config: DualSubtitleConfig = { ...DEFAULT_CONFIG };
  private currentCues: SubtitleCueDisplay[] = [];
  private isVisible: boolean = false;
  private isInitialized: boolean = false;
  // When true, the user explicitly hid subtitles via the UI. This prevents
  // automatic re-showing on cue updates.
  private isUserHidden: boolean = false;

  private playerService: PlayerInteractionService;
  private storageService: StorageService;
  private vocabularyManager: VocabularyManager;
  private vocabularyObserver: VocabularyObserver;

  private wordClickListeners: Set<WordClickCallback> = new Set();
  private visibilityListeners: Set<SubtitleVisibilityCallback> = new Set();

  private resizeObserver: ResizeObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private lastPlayerSize: { width: number; height: number } = { width: 0, height: 0 };

  private subtitleSyncHandler: (event: SubtitleSyncEvent) => void;
  private vocabularyCache: Map<string, boolean> = new Map();
  private readonly MAX_CACHE_SIZE = 1000; // Prevent unlimited growth
  private vocabularyEventUnsubscribers: (() => void)[] = [];
  private vocabularyModeEnabled: boolean = false;
  private vocabularyUpdateTimeout: number | null = null;
  private readonly VOCABULARY_UPDATE_DEBOUNCE_MS = 300; // Debounce rapid vocabulary changes
  private readonly logger = Logger.getInstance();
  // Debug overlay flag and element for Thai segmentation visualization
  private thaiOverlayEnabled: boolean = false;
  private thaiOverlayEl: HTMLElement | null = null;

  constructor(
    playerService: PlayerInteractionService,
    storageService: StorageService,
    initialConfig?: Partial<DualSubtitleConfig>,
  ) {
    this.playerService = playerService;
    this.storageService = storageService;

    this.vocabularyManager = VocabularyManager.getInstance();
    this.vocabularyObserver = VocabularyObserver.getInstance();

    if (initialConfig) {
      this.config = { ...this.config, ...initialConfig };
    }

    this.subtitleSyncHandler = this.handleSubtitleSync.bind(this);
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  public async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) {
        this.logger?.warn('Already initialized', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {},
        });
        return true;
      }

      this.logger?.info('Starting initialization', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Load config from storage first
      this.logger?.debug('Loading config from storage', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      await this.loadConfigFromStorage();
      this.logger?.debug('Config loaded from storage', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Find YouTube player container
      this.logger?.debug('Finding YouTube player container', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      const playerContainer = this.findPlayerContainer();
      if (!playerContainer) {
        this.logger?.error('Could not find YouTube player container', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {},
        });
        return false;
      }
      this.logger?.debug('Player container found', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Create shadow DOM container
      this.logger?.debug('Creating container', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      this.container = this.createContainer();
      if (!this.container) {
        this.logger?.error('Failed to create container', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {},
        });
        return false;
      }
      this.logger?.debug('Container created', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Attach to player
      this.logger?.debug('Attaching to player', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      playerContainer.appendChild(this.container);
      this.logger?.debug('Attached to player', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Create shadow root and content
      this.logger?.debug('Creating shadow DOM', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      this.createShadowDOM();
      this.createSubtitleElements();
      this.applyConfiguration();
      this.logger?.debug('Shadow DOM created', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Set up observers
      this.logger?.debug('Setting up observers', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      this.setupResizeObserver();
      this.setupMutationObserver();
      this.setupVocabularyEventListeners();
      this.logger?.debug('Observers set up', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      // Connect to subtitle sync
      this.logger?.debug('Connecting to subtitle sync', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      this.playerService.addSubtitleSyncListener(this.subtitleSyncHandler);
      this.logger?.debug('Connected to subtitle sync', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });

      this.isInitialized = true;
      this.logger?.info('Initialized successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
      return true;
    } catch (error) {
      this.logger?.error('Initialization failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return false;
    }
  }

  public destroy(): void {
    try {
      // Remove from player sync
      if (this.playerService) {
        this.playerService.removeSubtitleSyncListener(this.subtitleSyncHandler);
      }

      // Clean up observers
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }

      if (this.mutationObserver) {
        this.mutationObserver.disconnect();
        this.mutationObserver = null;
      }

      // Remove DOM elements
      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }

      // Clear references
      this.container = null;
      this.shadowRoot = null;
      this.subtitleContainer = null;
      this.targetLine = null;
      this.nativeLine = null;

      // Clear listeners
      this.wordClickListeners.clear();
      this.visibilityListeners.clear();

      // Clean up vocabulary event listeners
      this.vocabularyEventUnsubscribers.forEach((unsubscribe) => unsubscribe());
      this.vocabularyEventUnsubscribers = [];

      // Clear vocabulary cache
      this.vocabularyCache.clear();

      // Clear vocabulary update timeout
      if (this.vocabularyUpdateTimeout !== null) {
        window.clearTimeout(this.vocabularyUpdateTimeout);
        this.vocabularyUpdateTimeout = null;
      }

      this.isInitialized = false;
      this.logger?.info('Destroyed successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {},
      });
    } catch (error) {
      this.logger?.error('Destroy failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { error: error instanceof Error ? error.message : String(error) },
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
    const video = element.querySelector('video');
    return video !== null && element.offsetWidth > 0 && element.offsetHeight > 0;
  }

  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'linguatube-subtitle-overlay';
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
    styleSheet.textContent = SUBTITLE_CONTAINER_STYLES;
    this.shadowRoot.appendChild(styleSheet);
  }

  private createSubtitleElements(): void {
    if (!this.shadowRoot) return;

    // Create main subtitle container
    this.subtitleContainer = document.createElement('div');
    this.subtitleContainer.className = 'subtitle-container hidden';

    // Create drag handle
    const dragHandle = document.createElement('div');
    dragHandle.className = 'subtitle-drag-handle';
    dragHandle.title = 'Drag to reposition subtitles';
    dragHandle.textContent = '⋮';

    // Create target language line
    this.targetLine = document.createElement('div');
    this.targetLine.className = 'subtitle-line target';

    // Create native language line
    this.nativeLine = document.createElement('div');
    this.nativeLine.className = 'subtitle-line native';

    // Create vocabulary word description for screen readers
    const vocabularyDescription = document.createElement('div');
    vocabularyDescription.id = 'vocabulary-word-description';
    vocabularyDescription.className = 'sr-only';
    vocabularyDescription.textContent = 'This word is in your vocabulary list. The book icon indicates it has been saved for study.';

    // Assemble structure
    this.subtitleContainer.appendChild(dragHandle);
    this.subtitleContainer.appendChild(this.targetLine);
    this.subtitleContainer.appendChild(this.nativeLine);
    this.subtitleContainer.appendChild(vocabularyDescription);
    this.shadowRoot.appendChild(this.subtitleContainer);

    // Enable dragging
    this.enableDragging(dragHandle);

    // Dev-only segmentation overlay (hidden by default)
    const overlay = document.createElement('div');
    overlay.className = 'thai-seg-overlay';
    overlay.style.cssText = `
      position: absolute; bottom: 100%; left: 0; transform: translateY(-8px);
      background: rgba(0,0,0,0.75); color: #fff; font-size: 11px; padding: 6px 8px;
      border-radius: 4px; display: none; white-space: pre-wrap; max-width: 60vw; z-index: 2;
    `;
    this.subtitleContainer.appendChild(overlay);
    this.thaiOverlayEl = overlay;
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
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private updateConfigFromSettings(settings: UserSettings): void {
    const { subtitle, ui, developer } = settings;

    this.config = {
      ...this.config,
      showTargetLanguage: subtitle.showSource,
      showNativeLanguage: subtitle.showNative,
      fontSize: subtitle.fontSize,
      fontFamily: subtitle.fontFamily,
      targetLanguageColor: subtitle.textColor,
      backgroundColor: subtitle.backgroundColor,
      opacity: subtitle.opacity,
      lineSpacing: subtitle.lineHeight,
      wordSpacing: subtitle.wordSpacing,
      animationEnabled: ui.animationsEnabled,
      verticalOffset: subtitle.position === 'top' ? 10 : subtitle.position === 'center' ? 0 : -20,
    };

    // Apply developer flags for thai segmentation overlay
    if (developer && typeof developer.enableThaiSegmentationOverlay === 'boolean') {
      this.thaiOverlayEnabled = developer.enableThaiSegmentationOverlay;
    }

    if (this.isInitialized) {
      this.applyConfiguration();
    }
  }

  public updateConfig(newConfig: Partial<DualSubtitleConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.applyConfiguration();
  }

  public getConfig(): DualSubtitleConfig {
    return { ...this.config };
  }

  private applyConfiguration(): void {
    if (!this.shadowRoot || !this.subtitleContainer) return;

    // Update CSS custom properties
    const root = this.shadowRoot.host as HTMLElement;
    root.style.setProperty('--subtitle-font-size', `${this.config.fontSize}px`);
    root.style.setProperty('--subtitle-font-family', this.config.fontFamily);
    root.style.setProperty('--subtitle-target-color', this.config.targetLanguageColor);
    root.style.setProperty('--subtitle-native-color', this.config.nativeLanguageColor);
    root.style.setProperty('--subtitle-bg-color', this.config.backgroundColor);
    root.style.setProperty('--subtitle-opacity', this.config.opacity.toString());
    root.style.setProperty('--subtitle-padding', `${this.config.containerPadding}`);
    root.style.setProperty('--subtitle-border-radius', `${this.config.borderRadius}px`);
    root.style.setProperty('--subtitle-line-spacing', this.config.lineSpacing.toString());
    root.style.setProperty('--subtitle-word-spacing', this.config.wordSpacing.toString());
    root.style.setProperty('--subtitle-highlight-color', this.config.wordHighlightColor);
    root.style.setProperty('--subtitle-transition-duration', `${this.config.transitionDuration}ms`);
    root.style.setProperty('--subtitle-max-width', `${this.config.maxWidth}%`);

    if (this.config.textShadow) {
      root.style.setProperty(
        '--subtitle-text-shadow',
        `2px 2px 4px ${this.config.textShadowColor}`,
      );
    } else {
      root.style.setProperty('--subtitle-text-shadow', 'none');
    }

    // Update positioning
    this.updateSubtitlePosition();

    // Update visibility based on config
    if (this.targetLine) {
      this.targetLine.style.display = this.config.showTargetLanguage ? 'block' : 'none';
    }
    if (this.nativeLine) {
      this.nativeLine.style.display = this.config.showNativeLanguage ? 'block' : 'none';
    }
  }

  // ========================================
  // Subtitle Display Management
  // ========================================

  private handleSubtitleSync(event: SubtitleSyncEvent): void {
    switch (event.type) {
      case 'cue_start':
        if (event.cue) {
          this.addActiveCue(event.cue);
        }
        break;
      case 'cue_end':
        if (event.cue) {
          this.removeActiveCue(event.cue.id);
        }
        break;
      case 'cue_update':
        this.updateActiveCues(event.activeCues);
        break;
      case 'track_change':
        this.clearSubtitles();
        break;
    }

    // Revert recent auto-unhide behavior – rely on existing show/hide logic
  }

  private addActiveCue(cue: ActiveSubtitleCue): void {
    // Create display cue with word segmentation
    const displayCue: SubtitleCueDisplay = {
      id: cue.id,
      targetText: cue.text,
      nativeText: cue.nativeText || '', // Will be populated by translation service
      startTime: cue.startTime,
      endTime: cue.endTime,
      isActive: true,
      words: this.segmentWords(cue.text),
    };

    this.currentCues.push(displayCue);
    this.updateSubtitleDisplay();
  }

  private removeActiveCue(cueId: string): void {
    this.currentCues = this.currentCues.filter((cue) => cue.id !== cueId);
    this.updateSubtitleDisplay();
  }

  private updateActiveCues(activeCues: ActiveSubtitleCue[]): void {
    // Update existing cues and add new ones
    const newCueIds = new Set(activeCues.map((cue) => cue.id));

    // Remove cues that are no longer active
    this.currentCues = this.currentCues.filter((cue) => newCueIds.has(cue.id));

    // Add or update cues
    for (const cue of activeCues) {
      const existingIndex = this.currentCues.findIndex((c) => c.id === cue.id);
      if (existingIndex === -1) {
        this.addActiveCue(cue);
      }
    }
  }

  /**
   * Enhanced word segmentation for multiple languages including Thai
   * Uses Thai linguistic rules from http://www.thai-language.com/ref/breaking-words
   */
  private segmentWords(text: string): WordSegment[] {
    if (!text) return [];

    this.logger?.debug('Segmenting text', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { text, textLength: text.length },
    });

    // Detect if text contains Thai characters
    const containsThai = /[\u0E00-\u0E7F]/.test(text);

    if (containsThai) {
      return this.segmentThaiText(text);
    } else {
      // For non-Thai languages, use simple space-based segmentation
      return this.segmentNonThaiText(text);
    }
  }

  /**
   * Thai word segmentation using linguistic rules
   */
  private segmentThaiText(text: string): WordSegment[] {
    // Derive videoId from URL; honor feature flag later when settings wiring is added
    const videoId = (window && (window as any).location ? new URL(window.location.href).searchParams.get('v') : null) || undefined;
    const debugSnapshots: any[] = [];
    const words = thaiSegmenterService.segment(text, videoId, {
      capture: !!this.thaiOverlayEnabled,
      sink: (snapshot) => {
        debugSnapshots.push(snapshot);
      },
    });

    // If AI provider is active, attempt asynchronous improvement for low-confidence lines
    (async () => {
      try {
        const baseline = debugSnapshots[0]?.original || [];
        const current = debugSnapshots[0]?.collocationApplied || words;
        const improved = await thaiSegmenterService.improveSegmentationAsync(
          videoId,
          text,
          baseline,
          current,
        );
        if (improved && improved.join('') !== words.join('')) {
          // Re-render this line with improved tokens
          const segments = improved.map((w, idx) => ({
            text: w,
            index: idx,
            isClickable: w.length > 1,
            translation: undefined,
            partOfSpeech: undefined,
          }));
          // Update overlay compare as well
          if (this.thaiOverlayEnabled && this.thaiOverlayEl) {
            const original = baseline.join(' ');
            const aiMerged = improved.join(' ');
            const textContent = `orig: ${original}\nmerged: ${aiMerged}`;
            this.thaiOverlayEl.textContent = textContent;
            this.thaiOverlayEl.style.display = 'block';
          }
          // Replace the rendered target line content
          if (this.targetLine) {
            this.targetLine.innerHTML = '';
            // Render improved segments
            let lastEnd = 0;
            const line = text;
            segments.forEach((seg) => {
              const wordStart = line.indexOf(seg.text, lastEnd);
              if (wordStart > lastEnd) {
                const beforeText = line.substring(lastEnd, wordStart);
                this.targetLine?.appendChild(document.createTextNode(beforeText));
              }
              const wordSpan = document.createElement('span');
              wordSpan.className = 'clickable-word';
              wordSpan.textContent = seg.text;
              wordSpan.setAttribute('role', 'button');
              wordSpan.setAttribute('tabindex', '0');
              wordSpan.setAttribute('aria-label', `Click to translate word: ${seg.text}`);
              wordSpan.addEventListener('click', (event) => {
                this.handleWordClick(seg.text, event as any);
              });
              wordSpan.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  this.handleWordClick(seg.text, event as any);
                }
              });
              this.targetLine?.appendChild(wordSpan);
              lastEnd = wordStart + seg.text.length;
            });
            if (lastEnd < line.length) {
              const remainingText = line.substring(lastEnd);
              this.targetLine?.appendChild(document.createTextNode(remainingText));
            }
          }
        }
      } catch {}
    })();
    // When overlay enabled, show A/B tokens (baseline vs post-collocation). If AI hints change later lines, subsequent renders will update.
    try {
      if (this.thaiOverlayEnabled && this.thaiOverlayEl && debugSnapshots.length > 0) {
        const snap = debugSnapshots[0];
        const original = snap.original.join(' ');
        const colloc = snap.collocationApplied.join(' ');
        const textContent = `orig: ${original}\nmerged: ${colloc}`;
        this.thaiOverlayEl.textContent = textContent;
        this.thaiOverlayEl.style.display = 'block';
      } else if (this.thaiOverlayEl) {
        this.thaiOverlayEl.style.display = 'none';
      }
    } catch {}
    const segments = words.map((word, index) => ({
      text: word,
      index,
      isClickable: word.length > 1,
      translation: undefined,
      partOfSpeech: undefined,
    }));
    return segments;
  }

  /**
   * Non-Thai word segmentation (space-based)
   */
  private segmentNonThaiText(text: string): WordSegment[] {
    const words: string[] = [];

    // Split on spaces first
    const spaceSeparatedParts = text.split(/\s+/).filter((part) => part.length > 0);

    for (const part of spaceSeparatedParts) {
      // Further split by punctuation while preserving letters/numbers
      const subWords = part.match(/[\p{L}\p{N}]+/gu) || [];
      words.push(...subWords);
    }

    const segments = words.map((word, index) => ({
      text: word,
      index,
      isClickable: word.length > 0,
      translation: undefined,
      partOfSpeech: undefined,
    }));

    this.logger?.debug('Non-Thai text segmented', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        segmentCount: segments.length,
        words: segments.map((s) => s.text),
      },
    });
    return segments;
  }

  private updateSubtitleDisplay(): void {
    if (!this.targetLine || !this.nativeLine) return;

    // Combine all active cues
    const combinedTarget = this.currentCues.map((cue) => cue.targetText).join(' ');
    const combinedNative = this.currentCues.map((cue) => cue.nativeText).join(' ');

    // Respect user toggle: never auto-show while explicitly hidden
    if (this.isUserHidden) {
      if (this.isVisible) {
        this.hideSubtitles();
      }
      // Still update internal text buffers if needed without rendering
      return;
    }

    // Update target language line with clickable words
    if (this.config.showTargetLanguage) {
      this.renderTargetLine(combinedTarget);
    }

    // Update native language line
    if (this.config.showNativeLanguage) {
      // Handle line breaks by converting \n to <br> tags
      this.nativeLine.innerHTML = (combinedNative || '').replace(/\n/g, '<br>');
    }

    this.showSubtitles();
  }

  private renderTargetLine(text: string): void {
    if (!this.targetLine) return;

    this.logger?.debug('Rendering target line', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { text, textLength: text.length },
    });

    if (!this.config.clickableWords) {
      // Handle line breaks by converting \n to <br> tags
      this.targetLine.innerHTML = text.replace(/\n/g, '<br>');
      return;
    }

    // Clear existing content
    this.targetLine.innerHTML = '';

    // Split text by line breaks first, then process each line
    const lines = text.split('\n');
    
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        // Add line break between lines
        this.targetLine?.appendChild(document.createElement('br'));
      }
      
      if (line.trim() === '') {
        // Empty line, skip processing
        return;
      }
      
      // Get words for this line
      const words = this.segmentWords(line);
      
      if (words.length === 0) {
        // No words found, add the line as text
        this.targetLine?.appendChild(document.createTextNode(line));
        return;
      }
      
      // Process words in this line
      let lastEnd = 0;
      
      words.forEach((word) => {
        const wordStart = line.indexOf(word.text, lastEnd);
        
        if (wordStart === -1) {
          // Word not found, skip
          return;
        }
        
        // Add any text before this word
        if (wordStart > lastEnd) {
          const beforeText = line.substring(lastEnd, wordStart);
          this.targetLine?.appendChild(document.createTextNode(beforeText));
        }
        
        // Create clickable word span
        const wordSpan = document.createElement('span');
        wordSpan.className = 'clickable-word';
        wordSpan.textContent = word.text;
        
        // Add accessibility attributes
        wordSpan.setAttribute('role', 'button');
        wordSpan.setAttribute('tabindex', '0');
        wordSpan.setAttribute('aria-label', `Click to translate word: ${word.text}`);
        
        // Check if word is in vocabulary and add appropriate class (only when vocabulary mode is enabled)
        this.checkVocabularyWord(word.text)
          .then((isVocabularyWord: boolean) => {
            if (isVocabularyWord && this.vocabularyModeEnabled) {
              wordSpan.classList.add('vocabulary-word');
              wordSpan.setAttribute('aria-label', `Vocabulary word: ${word.text}. Click to translate.`);
              wordSpan.setAttribute('aria-describedby', 'vocabulary-word-description');
            } else {
              wordSpan.setAttribute('aria-label', `Click to translate word: ${word.text}`);
            }
          })
          .catch((error) => {
            this.logger?.warn('Error checking vocabulary word', {
              component: ComponentType.SUBTITLE_MANAGER,
              metadata: {
                word: word.text,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
        
        // Add click event listener
        wordSpan.addEventListener('click', (event) => {
          this.logger?.debug('Word clicked', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: { word: word.text },
          });
          this.handleWordClick(word.text, event);
        });
        
        // Add keyboard support for accessibility
        wordSpan.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            this.logger?.debug('Word activated via keyboard', {
              component: ComponentType.SUBTITLE_MANAGER,
              metadata: { word: word.text, key: event.key },
            });
            this.handleWordClick(word.text, event as any);
          }
        });
        
        this.targetLine?.appendChild(wordSpan);
        lastEnd = wordStart + word.text.length;
      });
      
      // Add any remaining text in this line
      if (lastEnd < line.length) {
        const remainingText = line.substring(lastEnd);
        this.targetLine?.appendChild(document.createTextNode(remainingText));
      }
    });

    // Dev-only segmentation overlay: show tokenization when debugMode + overlay flag is enabled (wiring later)
    try {
      if (this.thaiOverlayEnabled && this.thaiOverlayEl) {
        const tokens = this.currentCues.map((c) => c.words.map((w) => w.text).join(' ')).join(' | ');
        this.thaiOverlayEl.textContent = tokens;
        this.thaiOverlayEl.style.display = tokens ? 'block' : 'none';
      } else if (this.thaiOverlayEl) {
        this.thaiOverlayEl.style.display = 'none';
      }
    } catch {}
  }

  private handleWordClick(word: string, event: MouseEvent): void {
    if (!this.config.clickableWords) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const cleanedWord = word.trim(); // Simple cleaning - just remove whitespace

    this.logger?.debug('Handling word click', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { cleanedWord },
    });

    const wordClickEvent: WordClickEvent = {
      word: cleanedWord,
      translation: undefined, // Will be populated by translation service
      context: this.currentCues.map((cue) => cue.targetText).join(' '),
      timestamp: this.playerService.getCurrentTime(),
      cueId: this.currentCues[0]?.id || '',
      position: {
        x: rect.left + rect.width / 2,
        y: rect.bottom, // Use bottom edge so popup appears below the word
      },
    };

    this.logger?.debug('Word click event created', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        word: wordClickEvent.word,
        context: wordClickEvent.context,
        timestamp: wordClickEvent.timestamp,
        listenerCount: this.wordClickListeners.size,
      },
    });

    // Notify all word click listeners
    this.wordClickListeners.forEach((listener) => {
      try {
        this.logger?.debug('Calling word click listener', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {},
        });
        listener(wordClickEvent);
      } catch (error) {
        this.logger?.error('Error in word click listener', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    });

    // Automatically trigger TTS playback for the clicked word
    try {
      const currentTrack = this.playerService.getCurrentSubtitleTrack();
      const language = (currentTrack?.language || 'auto') as LanguageCode;
      // Fire-and-forget to avoid blocking UI
      void ttsService
        .speak(cleanedWord, language)
        .catch((err) => {
          this.logger?.warn('TTS playback failed', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: {
              word: cleanedWord,
              language,
              error: err instanceof Error ? err.message : String(err),
            },
          });
        });
    } catch (err) {
      this.logger?.warn('TTS invocation error', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private showSubtitles(): void {
    if (!this.subtitleContainer || this.isVisible) return;

    this.isVisible = true;
    this.subtitleContainer.classList.remove('hidden');

    if (this.config.animationEnabled) {
      this.subtitleContainer.classList.add('fade-in');
      setTimeout(() => {
        if (this.subtitleContainer) {
          this.subtitleContainer.classList.remove('fade-in');
        }
      }, this.config.transitionDuration);
    }

    this.notifyVisibilityChange(true, this.currentCues.length);
  }

  private hideSubtitles(): void {
    if (!this.subtitleContainer || !this.isVisible) return;

    this.isVisible = false;

    if (this.config.animationEnabled) {
      this.subtitleContainer.classList.add('fade-out');
      setTimeout(() => {
        if (this.subtitleContainer) {
          this.subtitleContainer.classList.remove('fade-out');
          this.subtitleContainer.classList.add('hidden');
        }
      }, this.config.transitionDuration);
    } else {
      this.subtitleContainer.classList.add('hidden');
    }

    this.notifyVisibilityChange(false, 0);
  }

  private clearSubtitles(): void {
    this.currentCues = [];
    this.updateSubtitleDisplay();
  }

  // ========================================
  // Positioning and Layout
  // ========================================

  private updateSubtitlePosition(): void {
    if (!this.subtitleContainer) return;

    const playerSize = this.getPlayerSize();
    if (!playerSize) return;

    const { width, height } = playerSize;

    // Preserve custom position if user dragged the container
    if (this.subtitleContainer.hasAttribute('data-custom-x')) {
      const x = Number(this.subtitleContainer.getAttribute('data-custom-x'));
      const y = Number(this.subtitleContainer.getAttribute('data-custom-y'));
      this.applyCustomPosition(x, y);
      return;
    }

    // Calculate vertical position based on offset percentage
    const verticalPixels = (this.config.verticalOffset / 100) * height;
    const bottomPosition = Math.max(50, Math.abs(verticalPixels) - height * 0.1);

    // Calculate horizontal position based on alignment
    let leftPosition = '50%'; // Center by default
    if (this.config.horizontalAlignment === 'left') {
      leftPosition = '10%';
    } else if (this.config.horizontalAlignment === 'right') {
      leftPosition = '90%';
    }

    this.subtitleContainer.style.bottom = `${bottomPosition}px`;
    this.subtitleContainer.style.left = leftPosition;
    this.subtitleContainer.style.maxWidth = `${this.config.maxWidth}%`;
  }

  private enableDragging(handle: HTMLElement): void {
    if (!this.subtitleContainer || !this.container) return;
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onMouseDown = (e: MouseEvent) => {
      if (!this.subtitleContainer || !this.container) return;
      const overlayRect = this.container.getBoundingClientRect();
      const subtitleRect = this.subtitleContainer.getBoundingClientRect();
      // Compute pointer offset within the subtitle container, using overlay-relative coords
      const pointerX = e.clientX - overlayRect.left;
      const pointerY = e.clientY - overlayRect.top;
      offsetX = pointerX - (subtitleRect.left - overlayRect.left);
      offsetY = pointerY - (subtitleRect.top - overlayRect.top);

      isDragging = true;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !this.subtitleContainer || !this.container) return;
      const overlayRect = this.container.getBoundingClientRect();
      const pointerX = e.clientX - overlayRect.left;
      const pointerY = e.clientY - overlayRect.top;
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
    if (!this.subtitleContainer || !this.container) return;
    const overlayRect = this.container.getBoundingClientRect();
    const maxX = overlayRect.width - this.subtitleContainer.offsetWidth - 8;
    const maxY = overlayRect.height - this.subtitleContainer.offsetHeight - 8;
    const clampedX = Math.max(8, Math.min(Math.round(x), Math.round(maxX)));
    const clampedY = Math.max(8, Math.min(Math.round(y), Math.round(maxY)));

    this.subtitleContainer.classList.add('custom-position');
    this.subtitleContainer.style.left = `${clampedX}px`;
    this.subtitleContainer.style.top = `${clampedY}px`;
    this.subtitleContainer.style.right = 'auto';
    this.subtitleContainer.style.bottom = 'auto';
    this.subtitleContainer.setAttribute('data-custom-x', String(clampedX));
    this.subtitleContainer.setAttribute('data-custom-y', String(clampedY));
  }

  private getPlayerSize(): { width: number; height: number } | null {
    if (!this.container) return null;

    const playerContainer = this.container.parentElement;
    if (!playerContainer) return null;

    return {
      width: playerContainer.offsetWidth,
      height: playerContainer.offsetHeight,
    };
  }

  private setupResizeObserver(): void {
    if (!this.container) return;

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width !== this.lastPlayerSize.width || height !== this.lastPlayerSize.height) {
          this.lastPlayerSize = { width, height };
          this.updateSubtitlePosition();
        }
      }
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
        setTimeout(() => this.updateSubtitlePosition(), 100);
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

  private setupVocabularyEventListeners(): void {
    this.logger?.debug('Setting up vocabulary event listeners', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {},
    });

    // Listen for vocabulary changes that affect highlighting
    this.vocabularyEventUnsubscribers.push(
      this.vocabularyObserver.on(
        VocabularyEventType.WORD_ADDED,
        this.handleVocabularyChange.bind(this),
      ),
    );
    this.vocabularyEventUnsubscribers.push(
      this.vocabularyObserver.on(
        VocabularyEventType.WORD_REMOVED,
        this.handleVocabularyChange.bind(this),
      ),
    );
    this.vocabularyEventUnsubscribers.push(
      this.vocabularyObserver.on(
        VocabularyEventType.VOCABULARY_CLEARED,
        this.handleVocabularyChange.bind(this),
      ),
    );
    this.vocabularyEventUnsubscribers.push(
      this.vocabularyObserver.on(
        VocabularyEventType.VOCABULARY_IMPORTED,
        this.handleVocabularyChange.bind(this),
      ),
    );
    
    this.logger?.debug('Vocabulary event listeners set up', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { listenersCount: this.vocabularyEventUnsubscribers.length },
    });
  }

  private handleVocabularyChange(): void {
    this.logger?.debug('Vocabulary change detected - debouncing highlights refresh', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: { 
        isVisible: this.isVisible,
        currentCuesCount: this.currentCues.length,
        cacheSize: this.vocabularyCache.size
      },
    });

    // Clear any existing timeout
      if (this.vocabularyUpdateTimeout !== null) {
        window.clearTimeout(this.vocabularyUpdateTimeout);
      }

    // Debounce vocabulary updates to prevent excessive re-rendering
    this.vocabularyUpdateTimeout = window.setTimeout(() => {
      this.logger?.debug('Executing debounced vocabulary update', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { 
          isVisible: this.isVisible,
          currentCuesCount: this.currentCues.length,
          cacheSize: this.vocabularyCache.size
        },
      });

      // Clear vocabulary cache to force refresh
      this.vocabularyCache.clear();

      // Re-render current subtitles and ensure new vocabulary words are highlighted immediately
      // Always attempt a refresh of spans to reflect immediate change when saving/removing
      this.updateSubtitleDisplay();
      if (this.vocabularyModeEnabled) {
        void this.highlightVocabularyWords();
      }

      this.vocabularyUpdateTimeout = null;
    }, this.VOCABULARY_UPDATE_DEBOUNCE_MS);
  }

  // ========================================
  // Event Management
  // ========================================

  public addWordClickListener(listener: WordClickCallback): void {
    this.wordClickListeners.add(listener);
  }

  public removeWordClickListener(listener: WordClickCallback): void {
    this.wordClickListeners.delete(listener);
  }

  public addVisibilityListener(listener: SubtitleVisibilityCallback): void {
    this.visibilityListeners.add(listener);
  }

  public removeVisibilityListener(listener: SubtitleVisibilityCallback): void {
    this.visibilityListeners.delete(listener);
  }

  private notifyVisibilityChange(visible: boolean, cueCount: number): void {
    this.visibilityListeners.forEach((listener) => {
      try {
        listener(visible, cueCount);
      } catch (error) {
        this.logger?.error('Visibility listener error', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            visible,
            cueCount,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });
  }

  // ========================================
  // Public API
  // ========================================

  public isReady(): boolean {
    return this.isInitialized && this.container !== null && this.shadowRoot !== null;
  }

  public setVisibility(targetVisible: boolean, nativeVisible: boolean): void {
    this.config = {
      ...this.config,
      showTargetLanguage: targetVisible,
      showNativeLanguage: nativeVisible,
    };
    this.applyConfiguration();
    this.updateSubtitleDisplay();
  }

  public getCurrentCues(): SubtitleCueDisplay[] {
    return [...this.currentCues];
  }

  public setNativeTranslation(cueId: string, translation: string): void {
    const cue = this.currentCues.find((c) => c.id === cueId);
    if (cue) {
      (cue as any).nativeText = translation; // Type assertion for readonly property
      this.updateSubtitleDisplay();
    }
  }

  public highlightWord(word: string, highlight: boolean = true): void {
    if (!this.targetLine) return;

    const normalize = (s: string) =>
      (s || '')
        .normalize('NFC')
        .replace(/[\u200B-\u200D\uFE00-\uFE0F]/g, '') // remove zero-width and variation selectors
        .trim()
        .toLowerCase();

    const target = normalize(word);
    const wordSpans = this.targetLine.querySelectorAll('.clickable-word');

    wordSpans.forEach((span) => {
      const spanText = normalize(span.textContent || '');
      if (spanText === target) {
        if (highlight) {
          span.classList.add('highlighted');
        } else {
          span.classList.remove('highlighted');
        }
      }
    });
  }

  /**
   * Highlight all vocabulary words in current subtitles (only when vocabulary mode is enabled)
   */
  public async highlightVocabularyWords(): Promise<void> {
    if (!this.targetLine) return;

    const wordSpans = this.targetLine.querySelectorAll('.clickable-word');

    const normalize = (s: string) =>
      (s || '')
        .normalize('NFC')
        .replace(/[\u200B-\u200D\uFE00-\uFE0F]/g, '')
        .trim();

    for (const span of wordSpans) {
      const word = normalize(span.textContent || '');
      if (word) {
        const isVocabularyWord = await this.checkVocabularyWord(word);
        if (isVocabularyWord && this.vocabularyModeEnabled) {
          span.classList.add('vocabulary-word');
        } else {
          span.classList.remove('vocabulary-word');
        }
      }
    }
  }

  /**
   * Remove all vocabulary highlighting
   */
  public clearVocabularyHighlighting(): void {
    if (!this.targetLine) return;

    const wordSpans = this.targetLine.querySelectorAll('.vocabulary-word');
    wordSpans.forEach((span) => {
      span.classList.remove('vocabulary-word');
    });
  }

  /**
   * Set vocabulary mode state - controls whether vocabulary words are highlighted
   * @param enabled - Whether vocabulary mode should be enabled
   */
  public setVocabularyMode(enabled: boolean): void {
    if (this.vocabularyModeEnabled !== enabled) {
      this.vocabularyModeEnabled = enabled;
      
      this.logger?.debug('Vocabulary mode state changed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { 
          enabled: this.vocabularyModeEnabled,
          isVisible: this.isVisible,
          currentCuesCount: this.currentCues.length,
          cacheSize: this.vocabularyCache.size
        },
      });

      // Clear vocabulary cache to force re-evaluation of highlighting
      this.vocabularyCache.clear();

      // Re-render current subtitles with updated highlighting logic
      // Only re-render if component is visible and has content to avoid unnecessary work
      if (this.isVisible && this.currentCues.length > 0 && this.targetLine) {
        this.updateSubtitleDisplay();
      }
    }
  }

  /**
   * Get current vocabulary mode state
   * @returns Whether vocabulary mode is currently enabled
   */
  public getVocabularyMode(): boolean {
    return this.vocabularyModeEnabled;
  }

  /**
   * Show the subtitle component
   */
  public show(): void {
    this.isUserHidden = false;
    this.showSubtitles();
  }

  /**
   * Hide the subtitle component
   */
  public hide(): void {
    // Mark as user-hidden to prevent automatic re-showing on cue changes
    this.isUserHidden = true;
    this.hideSubtitles();
  }

  /**
   * Toggle the overall visibility of the subtitle component
   * @returns The new visibility state
   */
  public toggleVisibility(): boolean {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
    return this.isVisible;
  }

  /**
   * Get the current overall visibility state
   * @returns Whether the subtitle component is currently visible
   */
  public getVisibility(): boolean {
    return this.isVisible;
  }

  private async checkVocabularyWord(word: string): Promise<boolean> {
    // Use boolean cache for better performance
    if (this.vocabularyCache.has(word)) {
      return this.vocabularyCache.get(word) || false;
    }

    try {
      // Get the current source language from the subtitle track
      const currentTrack = this.playerService.getCurrentSubtitleTrack();
      const sourceLanguage = (currentTrack?.language || 'auto').toLowerCase();

      // Normalize word for robust matching (Unicode-safe)
      const cleanWord = (word || '')
        .normalize('NFC')
        .replace(/[\u200B-\u200D\uFE00-\uFE0F]/g, '')
        .trim()
        .toLowerCase();

      // Always attempt a small set of fallback languages to tolerate mismatches
      const candidateLanguages = Array.from(
        new Set([sourceLanguage, 'auto', 'th', 'en', 'es', 'fr', 'de', 'pl'])
      );

      let isVocabularyWord = false;
      for (const lang of candidateLanguages) {
        // eslint-disable-next-line no-await-in-loop
        if (await this.vocabularyManager.isWordSaved(cleanWord, lang)) {
          isVocabularyWord = true;
          break;
        }
      }

      // Cache the result and manage cache size
      this.vocabularyCache.set(cleanWord, isVocabularyWord);
      
      // Prevent cache from growing indefinitely
      if (this.vocabularyCache.size > this.MAX_CACHE_SIZE) {
        const firstKey = this.vocabularyCache.keys().next().value;
        if (firstKey) {
          this.vocabularyCache.delete(firstKey);
        }
      }
      
      return isVocabularyWord;
    } catch (error) {
      this.logger?.warn('Error checking vocabulary word', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }
}
