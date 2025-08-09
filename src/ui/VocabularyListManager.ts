/**
 * Vocabulary List Manager for LinguaTube
 * High-level interface for managing vocabulary list UI components
 */

import {
  VocabularyListComponent,
  VocabularyListConfig,
  VocabularyListEvents,
} from './VocabularyListComponent';
import { VocabularyManager, VocabularyItemWithSubtitle } from '../vocabulary/VocabularyManager';
import { VocabularyItem } from '../storage/types';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';
import { EnhancedPlaybackControlsAPI, ControlsEventData } from './EnhancedPlaybackControlsComponent';
import { DualSubtitleManager } from './DualSubtitleManager';
import { storageService, VocabularyListSettings } from '../storage'; // CRITICAL FIX: Import the singleton instance directly

// ========================================
// Types and Interfaces
// ========================================

export interface VocabularyListManagerConfig {
  readonly containerId?: string;
  readonly position: 'popup' | 'sidebar' | 'modal' | 'inline';
  readonly theme: 'light' | 'dark' | 'auto';
  readonly autoShow: boolean;
  readonly showOnHover: boolean;
  readonly hideOnClickOutside: boolean;
  readonly enableKeyboardShortcuts: boolean;
  readonly keyboardShortcut?: string;
  readonly listConfig: Partial<VocabularyListConfig>;
}

export interface ManagerState {
  readonly isVisible: boolean;
  readonly isInitialized: boolean;
  readonly currentContainer: HTMLElement | null;
  readonly activeComponent: VocabularyListComponent | null;
}

// ========================================
// Enhanced YouTube Player Context Types
// ========================================

export interface PlayerModeInfo {
  readonly mode: 'default' | 'theater' | 'fullscreen' | 'mini-player';
  readonly dimensions: {
    readonly width: number;
    readonly height: number;
    readonly top: number;
    readonly left: number;
  };
  readonly controls: {
    readonly bottom: number;
    readonly top: number;
  };
}

export interface YouTubeUIElement {
  readonly rect: DOMRect;
  readonly priority: number;
  readonly type: 'player' | 'controls' | 'sidebar' | 'header' | 'other';
  readonly mode?: string;
}

// ========================================
// Default Configuration
// ========================================

export const DEFAULT_MANAGER_CONFIG: VocabularyListManagerConfig = {
  position: 'popup',
  theme: 'light',
  autoShow: false,
  showOnHover: false,
  hideOnClickOutside: true,
  enableKeyboardShortcuts: true, // Re-enable so users can reopen with Ctrl+Shift+V
  keyboardShortcut: 'Ctrl+Shift+V',
  listConfig: {
    maxHeight: 500,
    enableSearch: true,
    enableFilters: true,
    enableSorting: true,
    enableBulkActions: true,
    showWordCount: true,
    showProgress: true,
  },
};

// ========================================
// Vocabulary List Manager
// ========================================

export class VocabularyListManager {
  private static instance: VocabularyListManager | null = null;

  private config: VocabularyListManagerConfig;
  private vocabularyManager: VocabularyManager;

  private state: ManagerState = {
    isVisible: false,
    isInitialized: false,
    currentContainer: null,
    activeComponent: null,
  };

  private keyboardHandler: ((event: KeyboardEvent) => void) | null = null;
  private clickOutsideHandler: ((event: Event) => void) | null = null;
  private resizeHandler: ((event: Event) => void) | null = null;
  private customWordSelectHandler: ((word: VocabularyItem) => void) | null = null;
  private enhancedPlaybackControls: EnhancedPlaybackControlsAPI | null = null;
  private dualSubtitleManager: DualSubtitleManager | null = null;
  private readonly logger = Logger.getInstance();
  private playerStateListeners: Array<() => void> = [];
  private storageService: typeof storageService; // CRITICAL FIX: Add StorageService for persistence

  // ========================================
  // Constructor and Initialization
  // ========================================

  private constructor(config: Partial<VocabularyListManagerConfig> = {}) {
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
    this.vocabularyManager = VocabularyManager.getInstance();
    this.storageService = storageService; // CRITICAL FIX: Use singleton instance directly
    this.setupPlayerStateListeners();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<VocabularyListManagerConfig>): VocabularyListManager {
    if (!VocabularyListManager.instance) {
      VocabularyListManager.instance = new VocabularyListManager(config);
    }
    return VocabularyListManager.instance;
  }

  // ========================================
  // Public API
  // ========================================

  /**
   * Initialize the vocabulary list manager
   */
  public async initialize(): Promise<void> {
    if (this.state.isInitialized) return;

    try {
      this.setupEventListeners();
      this.state = { ...this.state, isInitialized: true };

      if (this.config.autoShow) {
        await this.show();
      }

      this.logger?.info('Initialized successfully', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          position: this.config.position,
          theme: this.config.theme,
          autoShow: this.config.autoShow,
        },
      });
    } catch (error) {
      this.logger?.error('Initialization failed', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  /**
   * Show the vocabulary list
   */
  public async show(container?: HTMLElement): Promise<void> {
    try {
      this.logger?.debug('Vocabulary list show requested', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          hasProvidedContainer: !!container,
          providedContainerId: container?.id,
          currentlyVisible: this.state.isVisible,
          hasActiveComponent: !!this.state.activeComponent,
          hasCurrentContainer: !!this.state.currentContainer,
        },
      });

      // CRITICAL FIX: Prevent multiple instances by checking for existing active component
      if (this.state.isVisible && this.state.activeComponent && this.state.currentContainer) {
        this.logger?.info('Vocabulary list already visible, bringing to front', {
          component: ComponentType.WORD_LOOKUP,
        });
        // Just ensure it's visible and bring to front
        this.state.currentContainer.style.display = 'block';
        this.state.currentContainer.style.opacity = '1';
        this.state.currentContainer.style.visibility = 'visible';
        this.state.currentContainer.style.pointerEvents = 'auto';
        this.state.currentContainer.style.zIndex = '2147483647';
        return;
      }

      // Clean up any existing component but be smart about containers
      if (this.state.activeComponent) {
        this.logger?.debug('Cleaning up existing vocabulary component', {
          component: ComponentType.WORD_LOOKUP,
        });
        this.state.activeComponent.destroy();
        
        // Reset component state but preserve container if it's the content script's
        const shouldPreserveContainer = this.state.currentContainer?.id === 'linguatube-vocabulary-list-container';
        this.state = {
          ...this.state,
          activeComponent: null,
          currentContainer: shouldPreserveContainer ? this.state.currentContainer : null,
          isVisible: false,
        };
      }

      // Only remove our popup containers, never touch the content script container
      const existingPopupContainers = document.querySelectorAll('.vocabulary-list-manager-container:not(#linguatube-vocabulary-list-container), .vocabulary-list-host:not(#linguatube-vocabulary-list-container *)');
      this.logger?.debug('Found existing popup containers to clean', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          containerCount: existingPopupContainers.length,
          containerIds: Array.from(existingPopupContainers).map(el => el.id).filter(Boolean),
        },
      });
      
      existingPopupContainers.forEach(el => {
        this.logger?.debug('Removing old popup vocabulary container', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { containerId: el.id, className: el.className },
        });
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });

      // Use provided container or create new one
      const targetContainer = container || this.createContainer();
      
      // If we're reusing the content script container, make sure it's ready
      if (targetContainer.id === 'linguatube-vocabulary-list-container') {
        targetContainer.style.opacity = '1';
        targetContainer.style.visibility = 'visible';
        targetContainer.style.pointerEvents = 'auto';
        targetContainer.innerHTML = ''; // Clear any previous content
      }
      
      this.logger?.debug('Using target container', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          containerId: targetContainer.id,
          containerClass: targetContainer.className,
          isProvidedContainer: !!container,
        },
      });
      
      // Create and initialize component
      const component = new VocabularyListComponent(this.config.listConfig);
      this.setupComponentEvents(component);

      await component.initialize(targetContainer);

      this.state = {
        ...this.state,
        isVisible: true,
        currentContainer: targetContainer,
        activeComponent: component,
      };

      this.setupContainerInteractions();
      this.applyTheme();

      // CRITICAL FIX: Focus the vocabulary list for immediate keyboard navigation
      if (component.focus) {
        setTimeout(() => component.focus(), 100); // Small delay to ensure DOM is ready
      }

      this.logger?.info('Vocabulary list shown successfully', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          position: this.config.position,
          hasContainer: !!container,
          isNewContainer: !container,
          finalContainerId: targetContainer.id,
        },
      });
    } catch (error) {
      this.logger?.error('Failed to show vocabulary list', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          position: this.config.position,
          hasProvidedContainer: !!container,
        },
      });
      throw error;
    }
  }

  /**
   * Hide the vocabulary list
   */
  public hide(): void {
    if (!this.state.isVisible) return;

    try {
      // Always destroy the component
      if (this.state.activeComponent) {
        this.state.activeComponent.destroy();
      }

      // Handle container cleanup based on whether it's content script's container or our own
      if (this.state.currentContainer) {
        if (this.state.currentContainer.id === 'linguatube-vocabulary-list-container') {
          // This is the content script's container - just hide it, don't remove it
          this.state.currentContainer.style.opacity = '0';
          this.state.currentContainer.style.visibility = 'hidden';
          this.state.currentContainer.style.pointerEvents = 'none';
          // Clear the content but keep the container
          this.state.currentContainer.innerHTML = '';
        } else {
          // This is our popup container - remove it completely
          if (this.state.currentContainer.parentNode) {
            this.state.currentContainer.parentNode.removeChild(this.state.currentContainer);
          }
          
          // Clean up drag handlers if they exist
          if ((this.state.currentContainer as any)._dragCleanup) {
            (this.state.currentContainer as any)._dragCleanup();
          }
        }
      }

      // Only remove our own popup containers, never the content script container
      const popupContainers = document.querySelectorAll('.vocabulary-list-manager-container:not(#linguatube-vocabulary-list-container)');
      popupContainers.forEach(el => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });

      this.removeContainerInteractions();
      
      // Reset state but preserve container reference if it's the content script's container
      const shouldPreserveContainer = this.state.currentContainer?.id === 'linguatube-vocabulary-list-container';
      this.state = { 
        ...this.state, 
        isVisible: false,
        currentContainer: shouldPreserveContainer ? this.state.currentContainer : null,
        activeComponent: null,
      };

      this.logger?.info('Vocabulary list hidden and cleaned up', {
        component: ComponentType.WORD_LOOKUP,
      });
    } catch (error) {
      this.logger?.error('Failed to hide vocabulary list', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Toggle visibility of the vocabulary list
   */
  public async toggle(container?: HTMLElement): Promise<void> {
    if (this.state.isVisible) {
      this.hide();
    } else {
      await this.show(container);
    }
  }

  /**
   * Refresh the vocabulary list
   */
  public async refresh(): Promise<void> {
    if (this.state.activeComponent) {
      await this.state.activeComponent.refresh();
    }
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<VocabularyListManagerConfig>): void {
    this.config = { ...this.config, ...newConfig };

    if (this.state.isVisible) {
      this.applyTheme();
    }
  }

  /**
   * Get current state
   */
  public getState(): ManagerState {
    return { ...this.state };
  }

  /**
   * Check if vocabulary list is visible
   */
  public isVisible(): boolean {
    return this.state.isVisible;
  }

  /**
   * Destroy the manager and clean up resources
   */
  public destroy(): void {
    this.hide();
    this.removeEventListeners();
    this.state = {
      isVisible: false,
      isInitialized: false,
      currentContainer: null,
      activeComponent: null,
    };
    VocabularyListManager.instance = null;
  }

  // ========================================
  // Public Communication Methods
  // ========================================

  /**
   * Set a custom handler for word selection events
   */
  public setWordSelectHandler(handler: (word: VocabularyItem) => void): void {
    this.customWordSelectHandler = handler;
  }

  /**
   * Set the Enhanced Playback Controls reference for navigation
   */
  public setEnhancedPlaybackControls(controls: EnhancedPlaybackControlsAPI): void {
    this.enhancedPlaybackControls = controls;
    this.logger?.info('Enhanced Playback Controls connected to vocabulary manager', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        controlsReady: controls.isReady(),
      },
    });
  }

  /**
   * Set the Dual Subtitle Manager reference for subtitle synchronization
   */
  public setDualSubtitleManager(manager: DualSubtitleManager): void {
    this.dualSubtitleManager = manager;
    this.logger?.info('Dual Subtitle Manager connected to vocabulary manager', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        managerReady: manager.isReady(),
      },
    });
  }

  /**
   * Set up cross-component event listening for state synchronization
   */
  public setupCrossComponentSync(): void {
    if (!this.enhancedPlaybackControls) {
      this.logger?.warn('Enhanced Playback Controls not available for cross-component sync', {
        component: ComponentType.WORD_LOOKUP,
      });
      return;
    }

    // Listen to Enhanced Playback Controls events for state synchronization
    this.enhancedPlaybackControls.addEventListener((event: ControlsEventData) => {
      this.handlePlaybackControlEvent(event);
    });

    this.logger?.info('Cross-component synchronization setup completed', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        hasEnhancedControls: !!this.enhancedPlaybackControls,
        hasDualSubtitleManager: !!this.dualSubtitleManager,
      },
    });
  }

  /**
   * Handle events from Enhanced Playback Controls for state synchronization
   */
  private handlePlaybackControlEvent(event: ControlsEventData): void {
    try {
      switch (event.type) {
        case 'vocabulary_navigation':
          this.handleVocabularyNavigationEvent(event);
          break;

        case 'subtitle_highlight':
          this.handleSubtitleHighlightEvent(event);
          break;

        case 'vocabulary_mode':
          this.handleVocabularyModeEvent(event);
          break;

        case 'sentence_nav':
          this.handleSentenceNavigationEvent(event);
          break;

        default:
          // Log other events for debugging but don't process them
          this.logger?.debug('Received playback control event', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              eventType: event.type,
              timestamp: event.timestamp,
            },
          });
          break;
      }
    } catch (error) {
      this.logger?.error('Error handling playback control event', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          eventType: event.type,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Handle vocabulary navigation events for highlighting synchronization
   */
  private handleVocabularyNavigationEvent(event: ControlsEventData): void {
    this.logger?.info('Processing vocabulary navigation event for highlighting sync', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        navigationMethod: event.value?.navigationMethod,
        hasSubtitleId: !!event.value?.subtitleId,
        hasVocabularyWord: !!event.value?.vocabularyWord,
      },
    });

    // Update vocabulary list highlighting if a word was navigated to
    if (event.value?.vocabularyWord && this.state.activeComponent) {
      // Highlight the vocabulary word in the list (async call)
      this.highlightVocabularyWord(event.value.vocabularyWord, true).catch((error) => {
        this.logger?.warn('Failed to highlight vocabulary word during navigation', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word: event.value?.vocabularyWord,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
    }

    // Coordinate with dual subtitle manager if available
    if (this.dualSubtitleManager && event.value?.subtitleId) {
      this.coordinateWithSubtitleManager(event.value.subtitleId, event.value.sentenceText);
    }
  }

  /**
   * Handle subtitle highlight events for visual synchronization
   */
  private handleSubtitleHighlightEvent(event: ControlsEventData): void {
    this.logger?.info('Processing subtitle highlight event for visual sync', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        hasSubtitleId: !!event.value?.subtitleId,
        highlightDuration: event.value?.duration,
        source: event.metadata?.source,
      },
    });

    // Update subtitle highlighting if dual subtitle manager is available
    if (this.dualSubtitleManager) {
      this.coordinateWithSubtitleManager(
        event.value?.subtitleId,
        event.value?.text,
        event.value?.highlight,
        event.value?.duration
      );
    }
  }

  /**
   * Handle vocabulary mode events for state synchronization
   */
  private handleVocabularyModeEvent(event: ControlsEventData): void {
    const vocabularyModeEnabled = !!event.value;
    
    this.logger?.info('Processing vocabulary mode event for state sync', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        vocabularyModeEnabled,
        currentlyVisible: this.state.isVisible,
      },
    });

    // Do NOT auto-show vocabulary list on mode toggle. Visibility is controlled solely
    // by the explicit "Show Vocabulary List" button.
    // If needed in future, this can be made configurable via manager config.

    // Coordinate with dual subtitle manager for vocabulary highlighting
    if (this.dualSubtitleManager) {
      this.coordinateWithSubtitleManager(null, null, vocabularyModeEnabled);
    }
  }

  /**
   * Handle sentence navigation events for context awareness
   */
  private handleSentenceNavigationEvent(event: ControlsEventData): void {
    this.logger?.info('Processing sentence navigation event for context sync', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        direction: event.value?.direction,
        hasSubtitleId: !!event.value?.subtitleId,
        hasSentence: !!event.value?.sentence,
      },
    });

    // Update vocabulary list context if available
    if (event.value?.sentence && this.state.activeComponent) {
      // Could implement sentence-based vocabulary filtering here
      this.updateVocabularyContext(event.value.sentence);
    }
  }

  /**
   * Coordinate with dual subtitle manager for highlighting and state sync
   */
  private coordinateWithSubtitleManager(
    subtitleId?: string | null,
    text?: string | null,
    highlight?: boolean,
    duration?: number
  ): void {
    if (!this.dualSubtitleManager) return;

    try {
      // Use the available methods from DualSubtitleManager
      const subtitleComponent = this.dualSubtitleManager.getSubtitleComponent();
      
      if (subtitleComponent && highlight !== undefined) {
        // Highlight vocabulary words in subtitle if we have text
        if (text && highlight) {
          // Extract vocabulary words from the sentence and highlight them
          this.highlightVocabularyWordsInSubtitle(text);
        }
      }

      this.logger?.debug('Coordinated with dual subtitle manager', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          hasSubtitleComponent: !!subtitleComponent,
          subtitleId,
          highlight,
          duration,
        },
      });
    } catch (error) {
      this.logger?.warn('Failed to coordinate with dual subtitle manager', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Highlight a specific vocabulary word in the vocabulary list
   */
  private async highlightVocabularyWord(word: string, highlight: boolean): Promise<void> {
    if (!this.state.activeComponent) {
      this.logger?.debug('No active vocabulary component for word highlighting', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { word, highlight },
      });
      return;
    }

    try {
      // Get the words from the vocabulary manager
      const componentWords = await this.vocabularyManager.getVocabulary();
      if (!componentWords.success || !componentWords.data) {
        this.logger?.debug('No vocabulary words available for highlighting', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { word, highlight },
        });
        return;
      }

      // Find the vocabulary word in the current list
      const vocabularyWord = componentWords.data.find(
        (item: VocabularyItem) => item.word.toLowerCase() === word.toLowerCase()
      );

      if (vocabularyWord) {
        // Apply or remove highlighting by updating the component's word list
        const wordElement = document.querySelector(
          `[data-word-id="${vocabularyWord.id}"] .item-word`
        );

        if (wordElement) {
          if (highlight) {
            wordElement.classList.add('vocabulary-navigation-highlight');
            // Remove the highlight after a brief period
            setTimeout(() => {
              wordElement.classList.remove('vocabulary-navigation-highlight');
            }, 2500);
          } else {
            wordElement.classList.remove('vocabulary-navigation-highlight');
          }

          this.logger?.debug('Applied vocabulary word highlighting', {
            component: ComponentType.WORD_LOOKUP,
            metadata: { 
              word: vocabularyWord.word, 
              wordId: vocabularyWord.id, 
              highlight,
              elementFound: true 
            },
          });
        } else {
          this.logger?.debug('Word element not found for highlighting', {
            component: ComponentType.WORD_LOOKUP,
            metadata: { 
              word: vocabularyWord.word, 
              wordId: vocabularyWord.id, 
              highlight 
            },
          });
        }
      } else {
        this.logger?.debug('Vocabulary word not found in current list', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { 
            word, 
            highlight, 
            totalWords: componentWords.data.length 
          },
        });
      }
    } catch (error) {
      this.logger?.warn('Error highlighting vocabulary word', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word,
          highlight,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Update vocabulary context based on current sentence
   */
  private updateVocabularyContext(sentence: string): void {
    // This could implement context-aware vocabulary filtering
    this.logger?.debug('Updating vocabulary context', {
      component: ComponentType.WORD_LOOKUP,
      metadata: { sentenceLength: sentence.length },
    });
  }

  /**
   * Highlight vocabulary words found in the subtitle text
   */
  private highlightVocabularyWordsInSubtitle(text: string): void {
    // This would coordinate with DualSubtitleComponent to highlight known vocabulary
    this.logger?.debug('Highlighting vocabulary words in subtitle', {
      component: ComponentType.WORD_LOOKUP,
      metadata: { textLength: text.length },
    });
  }

  // ========================================
  // Core VocabularyListManager Methods (Existing)
  // ========================================

  // ========================================
  // Private Methods
  // ========================================

  private setupEventListeners(): void {
    if (this.config.enableKeyboardShortcuts) {
      this.keyboardHandler = this.handleKeyboardShortcut.bind(this);
      document.addEventListener('keydown', this.keyboardHandler);
    }

    this.resizeHandler = this.handleResize.bind(this);
    window.addEventListener('resize', this.resizeHandler);
  }

  private removeEventListeners(): void {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }

    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  private setupContainerInteractions(): void {
    if (this.config.hideOnClickOutside) {
      this.clickOutsideHandler = this.handleClickOutside.bind(this);
      setTimeout(() => {
        document.addEventListener('click', this.clickOutsideHandler!);
      }, 100);
    }

    // REAL FIX: Set up dragging for ALL containers, not just popups
    if (this.state.currentContainer) {
      this.makeDraggable(this.state.currentContainer);
    }
  }

  private removeContainerInteractions(): void {
    if (this.clickOutsideHandler) {
      document.removeEventListener('click', this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
  }

  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `vocabulary-list-manager-container position-${this.config.position}`;

    this.applyContainerStyles(container);

    if (this.config.position === 'popup') {
      // Add draggable functionality for popup
      this.makeDraggable(container);
      document.body.appendChild(container);
      this.positionPopup(container);
    }

    return container;
  }

  private makeDraggable(container: HTMLElement): void {
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    const onMouseDown = (e: MouseEvent) => {
      // REAL FIX: Use composedPath to find shadow DOM elements
      const path = e.composedPath();
      const shadowHost = path.find(node => 
        (node as Element)?.classList?.contains('vocabulary-list-host')
      );
      
      if (!shadowHost) return;

      // Look for the header in the composed path
      const header = path.find(node => 
        (node as Element)?.classList?.contains('vocabulary-header')
      );
      
      if (!header) return;

      isDragging = true;
      const rect = container.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      
      container.style.cursor = 'grabbing';
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      
      e.preventDefault();
      e.stopPropagation();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const x = e.clientX - dragOffset.x;
      const y = e.clientY - dragOffset.y;
      
      const maxX = window.innerWidth - container.offsetWidth;
      const maxY = window.innerHeight - container.offsetHeight;
      
      const boundedX = Math.max(0, Math.min(x, maxX));
      const boundedY = Math.max(0, Math.min(y, maxY));

      container.style.left = `${boundedX}px`;
      container.style.top = `${boundedY}px`;
      container.style.transform = 'none';
      
      e.preventDefault();
    };

    const onMouseUp = () => {
      isDragging = false;
      container.style.cursor = '';
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    (container as any)._dragCleanup = () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }

  private applyContainerStyles(container: HTMLElement): void {
    const baseStyles = {
      position: 'fixed' as const,
      zIndex: '2147483647',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    };

    const positionStyles = this.getPositionStyles();

    Object.assign(container.style, baseStyles, positionStyles);
  }

  private getPositionStyles(): Partial<CSSStyleDeclaration> {
    switch (this.config.position) {
      case 'popup':
        return {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          maxWidth: '90vw',
          maxHeight: '90vh',
        };

      case 'sidebar':
        return {
          top: '0',
          right: '0',
          width: '400px',
          height: '100vh',
          borderLeft: '1px solid #e2e8f0',
        };

      case 'modal':
        return {
          top: '0',
          left: '0',
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        };

      default:
        return {};
    }
  }

  private positionPopup(container: HTMLElement): void {
    const playerInfo = this.getPlayerModeInfo();
    const containerWidth = 400; // Default vocabulary list width
    const containerHeight = 600; // Default vocabulary list height

    this.logger?.debug('Positioning vocabulary list with player context', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        playerMode: playerInfo.mode,
        playerDimensions: playerInfo.dimensions,
      },
    });

    let x: number, y: number;

    switch (playerInfo.mode) {
      case 'fullscreen':
        // In fullscreen, position on the right side with margin from controls
        x = window.innerWidth - containerWidth - 20;
        y = (window.innerHeight - containerHeight) / 2;
        break;

      case 'theater':
        // In theater mode, position to the right of the player
        x = Math.min(
          playerInfo.dimensions.left + playerInfo.dimensions.width + 20,
          window.innerWidth - containerWidth - 20
        );
        y = Math.max(
          playerInfo.dimensions.top,
          (window.innerHeight - containerHeight) / 2
        );
        break;

      case 'mini-player':
        // For mini-player, position in a non-interfering location
        x = Math.max(20, playerInfo.dimensions.left - containerWidth - 20);
        y = Math.max(20, playerInfo.dimensions.top);
        break;

      case 'default':
      default:
        // Default mode: position to the right of the player or below if no space
        const spaceRight = window.innerWidth - (playerInfo.dimensions.left + playerInfo.dimensions.width);
        
        if (spaceRight >= containerWidth + 40) {
          // Position to the right of the player
          x = playerInfo.dimensions.left + playerInfo.dimensions.width + 20;
          y = Math.max(
            playerInfo.dimensions.top,
            (window.innerHeight - containerHeight) / 2
          );
        } else {
          // Position below the player if not enough space on the right
          x = Math.max(20, Math.min(
            playerInfo.dimensions.left,
            window.innerWidth - containerWidth - 20
          ));
          y = Math.min(
            playerInfo.dimensions.top + playerInfo.dimensions.height + 20,
            window.innerHeight - containerHeight - 20
          );
        }
        break;
    }

    // Apply boundary constraints
    x = Math.max(20, Math.min(x, window.innerWidth - containerWidth - 20));
    y = Math.max(20, Math.min(y, window.innerHeight - containerHeight - 20));

    // Apply the calculated position
    container.style.left = `${x}px`;
    container.style.top = `${y}px`;
    container.style.transform = 'none';

    // Apply player-mode specific styling
    this.applyPlayerModeStyles(container, playerInfo);

    this.logger?.debug('Vocabulary list positioned', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        finalPosition: { x, y },
        playerMode: playerInfo.mode,
        containerSize: { width: containerWidth, height: containerHeight },
      },
    });
  }

  /**
   * Apply player-mode specific styling adjustments
   */
  private applyPlayerModeStyles(container: HTMLElement, playerInfo: PlayerModeInfo): void {
    // Reset any previous mode-specific classes
    container.classList.remove('fullscreen-mode', 'theater-mode', 'mini-player-mode', 'default-mode');
    
    // Add current mode class
    container.classList.add(`${playerInfo.mode.replace('-', '')}-mode`);

    // Apply mode-specific z-index and styling
    switch (playerInfo.mode) {
      case 'fullscreen':
        container.style.zIndex = '2147483647'; // Highest z-index for fullscreen
        container.style.maxWidth = '35vw';
        container.style.maxHeight = '90vh';
        break;

      case 'theater':
        container.style.zIndex = '2147483646';
        container.style.maxWidth = '400px';
        container.style.maxHeight = '80vh';
        break;

      case 'mini-player':
        container.style.zIndex = '2147483645';
        container.style.maxWidth = '350px';
        container.style.maxHeight = '400px';
        break;

      case 'default':
      default:
        container.style.zIndex = '2147483644';
        container.style.maxWidth = '400px';
        container.style.maxHeight = '600px';
        break;
    }
  }

  private getYouTubeUIElements(): Array<{ rect: DOMRect; priority: number }> {
    const selectors = [
      { selector: '#player-container', priority: 10 },
      { selector: '.ytp-chrome-bottom', priority: 8 },
      { selector: '.ytp-chrome-top', priority: 7 },
      { selector: '#secondary', priority: 5 },
      { selector: '#primary', priority: 3 },
    ];

    const elements: Array<{ rect: DOMRect; priority: number }> = [];

    for (const { selector, priority } of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        elements.push({ rect: element.getBoundingClientRect(), priority });
      }
    }

    return elements;
  }

  /**
   * Enhanced YouTube player mode detection with detailed context
   */
  private getPlayerModeInfo(): PlayerModeInfo {
    try {
      // Check for fullscreen mode
      if (document.fullscreenElement || 
          document.querySelector('.ytp-fullscreen') ||
          window.innerHeight === screen.height) {
        return this.getFullscreenModeInfo();
      }

      // Check for theater mode
      if (document.querySelector('.watch-wide') || 
          document.querySelector('[theater]') ||
          document.querySelector('.ytd-watch-flexy[theater]')) {
        return this.getTheaterModeInfo();
      }

      // Check for mini-player mode
      if (document.querySelector('[mini-player]') ||
          document.querySelector('.ytp-miniplayer') ||
          window.innerWidth < 600) {
        return this.getMiniPlayerModeInfo();
      }

      // Default mode
      return this.getDefaultModeInfo();
    } catch (error) {
      this.logger?.warn('Failed to detect YouTube player mode', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return this.getDefaultModeInfo();
    }
  }

  private getFullscreenModeInfo(): PlayerModeInfo {
    return {
      mode: 'fullscreen',
      dimensions: {
        width: window.innerWidth,
        height: window.innerHeight,
        top: 0,
        left: 0,
      },
      controls: {
        bottom: 80,
        top: 60,
      },
    };
  }

  private getTheaterModeInfo(): PlayerModeInfo {
    const player = document.querySelector('#player-container') || 
                   document.querySelector('#movie_player');
    const rect = player?.getBoundingClientRect() || {
      width: window.innerWidth,
      height: window.innerHeight * 0.7,
      top: 60,
      left: 0,
    };

    return {
      mode: 'theater',
      dimensions: {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
      },
      controls: {
        bottom: 60,
        top: 50,
      },
    };
  }

  private getMiniPlayerModeInfo(): PlayerModeInfo {
    const player = document.querySelector('.ytp-miniplayer') || 
                   document.querySelector('#player-container');
    const rect = player?.getBoundingClientRect() || {
      width: 300,
      height: 200,
      top: window.innerHeight - 220,
      left: window.innerWidth - 320,
    };

    return {
      mode: 'mini-player',
      dimensions: {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
      },
      controls: {
        bottom: 30,
        top: 20,
      },
    };
  }

  private getDefaultModeInfo(): PlayerModeInfo {
    const player = document.querySelector('#player-container') || 
                   document.querySelector('#movie_player');
    const rect = player?.getBoundingClientRect() || {
      width: Math.min(window.innerWidth * 0.7, 854),
      height: Math.min(window.innerHeight * 0.6, 480),
      top: 100,
      left: 50,
    };

    return {
      mode: 'default',
      dimensions: {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
      },
      controls: {
        bottom: 50,
        top: 40,
      },
    };
  }

  /**
   * Save vocabulary list preferences to Chrome Storage
   */
  private async saveVocabularyListPreferences(preferences: Partial<VocabularyListSettings>): Promise<void> {
    try {
      // Get current settings
      const settingsResult = await this.storageService.getSettings();
      if (!settingsResult.success || !settingsResult.data) {
        this.logger?.warn('Failed to get current settings for vocabulary list preferences', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { error: settingsResult.error?.message },
        });
        return;
      }

      // Update vocabulary list settings
      const updatedSettings = {
        ...settingsResult.data,
        ui: {
          ...settingsResult.data.ui,
          vocabularyList: {
            ...settingsResult.data.ui.vocabularyList,
            ...preferences,
          },
        },
      };

      // Save updated settings
      const saveResult = await this.storageService.saveSettings(updatedSettings);
      if (saveResult.success) {
        this.logger?.debug('Vocabulary list preferences saved successfully', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { preferences },
        });
      } else {
        this.logger?.warn('Failed to save vocabulary list preferences', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { error: saveResult.error?.message },
        });
      }
    } catch (error) {
      this.logger?.error('Error saving vocabulary list preferences', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  /**
   * Load vocabulary list preferences from Chrome Storage
   */
  private async loadVocabularyListPreferences(): Promise<VocabularyListSettings | null> {
    try {
      const result = await this.storageService.getSettings();
      if (result.success && result.data) {
        this.logger?.debug('Vocabulary list preferences loaded successfully', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { preferences: result.data.ui.vocabularyList },
        });
        return result.data.ui.vocabularyList;
      } else {
        this.logger?.warn('Failed to load vocabulary list preferences', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { error: result.error?.message },
        });
        return null;
      }
    } catch (error) {
      this.logger?.error('Error loading vocabulary list preferences', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      });
      return null;
    }
  }

  /**
   * Setup component events and state synchronization
   */
  private setupComponentEvents(component: VocabularyListComponent): void {
    const events: VocabularyListEvents = {
      onWordSelect: (word: VocabularyItem) => {
        this.handleWordSelect(word);
      },
      onWordEdit: (word: VocabularyItem) => {
        this.handleWordEdit(word);
      },
      onWordDelete: (word: VocabularyItem) => {
        this.handleWordDelete(word);
      },
      onWordNavigate: (word: VocabularyItem) => {
        this.handleWordNavigate(word);
      },
      onBulkAction: (action: string, words: VocabularyItem[]) => {
        this.handleBulkAction(action, words);
      },
      onSearchChange: (query: string) => {
        this.handleSearchChange(query);
      },
      onFilterChange: (filter: string) => {
        this.handleFilterChange(filter);
      },
      onImportRequest: (format: 'json' | 'csv' | 'anki') => {
        this.handleImportRequest(format);
      },
      onExportRequest: (format: 'json' | 'csv' | 'anki') => {
        this.handleExportRequest(format);
      },
    };

    // Set up component event handlers
    Object.entries(events).forEach(([eventName, handler]) => {
      component.on(eventName as keyof VocabularyListEvents, handler as any);
    });

    // CRITICAL FIX: Sync with Enhanced Playback Controls vocabulary mode
    this.syncWithVocabularyMode();
  }

  /**
   * Synchronize vocabulary list display with Enhanced Playback Controls vocabulary mode
   */
  private syncWithVocabularyMode(): void {
    if (!this.enhancedPlaybackControls) {
      this.logger?.debug('Enhanced Playback Controls not available for vocabulary mode sync', {
        component: ComponentType.WORD_LOOKUP,
      });
      return;
    }

    // Check initial vocabulary mode state
    const isVocabularyModeActive = this.enhancedPlaybackControls.isVocabularyModeActive();
    
    this.logger?.debug('Syncing vocabulary list with vocabulary mode', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        isVocabularyModeActive,
        hasActiveComponent: !!this.state.activeComponent,
      },
    });

    // Apply vocabulary mode styling/highlighting to the list
    this.applyVocabularyModeDisplay(isVocabularyModeActive);
  }

  /**
   * Apply vocabulary mode display changes to the vocabulary list
   */
  private applyVocabularyModeDisplay(isActive: boolean): void {
    if (!this.state.activeComponent || !this.state.currentContainer) {
      return;
    }

    try {
      // Add/remove vocabulary mode class to container for styling
      const container = this.state.currentContainer;
      if (isActive) {
        container.classList.add('vocabulary-mode-active');
        
        this.logger?.debug('Applied vocabulary mode active styling', {
          component: ComponentType.WORD_LOOKUP,
        });
      } else {
        container.classList.remove('vocabulary-mode-active');
        
        this.logger?.debug('Removed vocabulary mode active styling', {
          component: ComponentType.WORD_LOOKUP,
        });
      }

      // Refresh the component display to show highlighting changes
      this.state.activeComponent.refresh();
      
    } catch (error) {
      this.logger?.error('Error applying vocabulary mode display', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          isActive,
        },
      });
    }
  }

  /**
   * Handle vocabulary mode changes from Enhanced Playback Controls
   */
  public onVocabularyModeChanged(isActive: boolean): void {
    this.logger?.info('Vocabulary mode changed, updating list display', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        isActive,
        isListVisible: this.state.isVisible,
      },
    });

    this.applyVocabularyModeDisplay(isActive);
  }

  private handleWordSelect(word: VocabularyItem): void {
    // Handle close button click
    if (word.word === 'close') {
      this.hide();
      return;
    }

    this.logger?.info('Word selected', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        word: word.word,
        language: word.sourceLanguage,
        hasTranslation: !!word.translation,
      },
    });

    this.customWordSelectHandler?.(word);
  }

  private async handleWordNavigate(word: VocabularyItem): Promise<void> {
    try {
      this.logger?.info('Handling vocabulary word navigation', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: word.word,
          wordId: word.id,
          videoId: word.videoId,
          timestamp: word.timestamp,
          hasEnhancedControls: !!this.enhancedPlaybackControls,
        },
      });

      if (!this.enhancedPlaybackControls) {
        this.logger?.warn('Enhanced Playback Controls not available for navigation', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { word: word.word },
        });
        return;
      }

      if (!this.enhancedPlaybackControls.isReady()) {
        this.logger?.warn('Enhanced Playback Controls not ready for navigation', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word: word.word,
            playerReady: this.enhancedPlaybackControls.isReady(),
          },
        });
        return;
      }

      // CRITICAL FIX: Validate current video context, but be less restrictive
      const currentVideoId = this.getCurrentVideoId();
      
      // CRITICAL FIX: Only skip if word explicitly has different video ID
      if (word.videoId && currentVideoId && word.videoId !== currentVideoId) {
        this.logger?.warn('Vocabulary word is from different video - navigation skipped for safety', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word: word.word,
            wordVideoId: word.videoId,
            currentVideoId: currentVideoId,
          },
        });
        
        // Show user-friendly message instead of navigating to wrong video
        this.showNavigationError(`Word "${word.word}" is from a different video. Switch to that video to navigate.`);
        return;
      }

      let navigationSuccess = false;

      // CRITICAL FIX: Add comprehensive debugging for sentence detection
      this.logger?.debug('Starting vocabulary word navigation attempts', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: word.word,
          hasTimestamp: !!word.timestamp,
          currentVideoId: currentVideoId,
        },
      });

      // CRITICAL FIX: Try vocabulary word search first (most reliable and safe)
      try {
        const wordSearchSuccess = this.enhancedPlaybackControls.jumpToVocabularyWord(word.word, {
          caseSensitive: false,
          wholeWord: true,
          bufferTime: 0.1, // Reduced from 0.5 to 0.1 for more precise timing
        });
        
        if (wordSearchSuccess) {
          navigationSuccess = true;
          this.logger?.info('Successfully navigated using vocabulary word search', {
            component: ComponentType.WORD_LOOKUP,
            metadata: { word: word.word },
          });
        } else {
          this.logger?.warn('Vocabulary word search failed - investigating subtitle availability', {
            component: ComponentType.WORD_LOOKUP,
            metadata: { word: word.word },
          });
          
          // CRITICAL FIX: Debug subtitle track availability
          await this.debugSubtitleAvailability();
        }
      } catch (error) {
        this.logger?.error('Error during vocabulary word search', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word: word.word,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }

      // If word search failed, try alternative methods
      if (!navigationSuccess) {
        // Try subtitle mapping as final option
        try {
          const subtitleLookup = await this.vocabularyManager.getSubtitlesByVocabularyWords([word.word]);
          
          if (subtitleLookup.success && subtitleLookup.data && subtitleLookup.data.length > 0) {
            // Found subtitle mapping - validate it's from current video if we have video context
            const lookup = subtitleLookup.data[0];
            const shouldUseSubtitleMapping = !currentVideoId || // No video context, allow
                                            !lookup.vocabularyItem.videoId || // No word video context, allow  
                                            lookup.vocabularyItem.videoId === currentVideoId; // Same video, allow

            if (shouldUseSubtitleMapping) {
              this.logger?.info('Using subtitle mapping for navigation', {
                component: ComponentType.WORD_LOOKUP,
                metadata: {
                  word: word.word,
                  subtitleId: lookup.subtitleId,
                  timestamp: lookup.timestamp,
                },
              });
              
              const success = this.enhancedPlaybackControls.jumpToSubtitleWithContext(lookup.subtitleId, {
                bufferTime: 0.1, // Reduced from 0.3 to 0.1 for more precise timing
                highlightDuration: 3000,
                enableAutoLoop: false,
              });
              
              navigationSuccess = success;
            } else {
              this.logger?.warn('Subtitle mapping is from different video - skipped', {
                component: ComponentType.WORD_LOOKUP,
                metadata: {
                  word: word.word,
                  mappingVideoId: lookup.vocabularyItem.videoId,
                  currentVideoId: currentVideoId,
                },
              });
            }
          }
        } catch (error) {
          this.logger?.error('Error during subtitle mapping navigation', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              word: word.word,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }

        // If all methods failed, show informative error
        if (!navigationSuccess) {
          this.logger?.warn('Unable to navigate to vocabulary word - all methods failed', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              word: word.word,
              hasTimestamp: !!word.timestamp,
              currentVideoId: currentVideoId,
            },
          });
          this.showNavigationError(`Unable to locate "${word.word}" in current video. This may be due to subtitle loading issues.`);
        }
      }

      // Provide user feedback based on navigation success
      if (navigationSuccess) {
        this.logger?.info('Vocabulary word navigation completed successfully', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word: word.word,
          },
        });
      }

    } catch (error) {
      this.logger?.error('Error handling vocabulary word navigation', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: word.word,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.showNavigationError(`Navigation failed for "${word.word}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleWordEdit(word: VocabularyItem): Promise<void> {
    this.logger?.info('Edit word', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        word: word.word,
        wordId: word.id,
      },
    });
    // Could open edit dialog or integrate with existing edit functionality
  }

  private async handleWordDelete(word: VocabularyItem): Promise<void> {
    if (confirm(`Are you sure you want to delete "${word.word}"?`)) {
      try {
        const result = await this.vocabularyManager.removeWords([word.id]);
        if (result.successful.length > 0) {
          this.logger?.info('Word deleted', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              word: word.word,
              wordId: word.id,
            },
          });
          await this.refresh();
        } else {
          this.logger?.error('Failed to delete word', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              word: word.word,
              error: result.failed[0]?.error || 'Unknown error',
            },
          });
        }
      } catch (error) {
        this.logger?.error('Error deleting word', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            word: word.word,
          },
        });
      }
    }
  }

  private async handleBulkAction(action: string, words: VocabularyItem[]): Promise<void> {
    this.logger?.info('Bulk action', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        action: action,
        wordCount: words.length,
      },
    });

    switch (action) {
      case 'bulk-delete':
        if (confirm(`Are you sure you want to delete ${words.length} words?`)) {
          try {
            const result = await this.vocabularyManager.removeWords(words.map((w) => w.id));
            this.logger?.info('Deleted words', {
              component: ComponentType.WORD_LOOKUP,
              metadata: {
                successful: result.successful.length,
                total: words.length,
              },
            });
            if (result.failed.length > 0) {
              this.logger?.error('Failed to delete some words', {
                component: ComponentType.WORD_LOOKUP,
                metadata: {
                  failedCount: result.failed.length,
                  failedEntries: result.failed,
                },
              });
            }
            await this.refresh();
          } catch (error) {
            this.logger?.error('Error in bulk delete', {
              component: ComponentType.WORD_LOOKUP,
              metadata: {
                error: error instanceof Error ? error.message : String(error),
                wordCount: words.length,
              },
            });
          }
        }
        break;

      case 'bulk-export':
        try {
          const result = await this.vocabularyManager.exportVocabulary('json');
          if (result.success && result.data) {
            this.downloadFile(result.data, 'vocabulary-export.json', 'application/json');
          }
        } catch (error) {
          this.logger?.error('Error in bulk export', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
        }
        break;
    }
  }

  private handleSearchChange(query: string): void {
    this.logger?.info('Search query changed', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        query: query,
        queryLength: query.length,
      },
    });
  }

  private handleFilterChange(filters: any): void {
    this.logger?.info('Filters changed', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        filters: filters,
      },
    });
  }

  private async handleImportRequest(format: 'json' | 'csv' | 'anki'): Promise<void> {
    this.logger?.info('Import requested', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        format: format,
      },
    });

    try {
      // Create a file input for importing
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = format === 'json' ? '.json' : format === 'csv' ? '.csv' : '.txt';
      
      fileInput.onchange = async (event) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (file) {
          try {
            const content = await this.readFileContent(file);
            const words = await this.parseImportContent(content, format);
            
                         // Import the words
             let successCount = 0;
             for (const word of words) {
               try {
                 // Validate required fields
                 if (!word.word || !word.translation || !word.context || !word.sourceLanguage || !word.targetLanguage) {
                   this.logger?.warn('Skipping word with missing required fields', {
                     component: ComponentType.WORD_LOOKUP,
                     metadata: { word: word.word || 'unknown' },
                   });
                   continue;
                 }
                 
                 await this.vocabularyManager.saveWord(
                   word.word,
                   word.translation,
                   word.context,
                   {
                     sourceLanguage: word.sourceLanguage,
                     targetLanguage: word.targetLanguage,
                     videoId: word.videoId,
                     videoTitle: word.videoTitle,
                     timestamp: word.timestamp,
                   }
                 );
                 successCount++;
               } catch (error) {
                 this.logger?.warn('Failed to import word', {
                   component: ComponentType.WORD_LOOKUP,  
                   metadata: {
                     word: word.word || 'unknown',
                     error: error instanceof Error ? error.message : String(error),
                   },
                 });
               }
             }
            
            this.logger?.info('Import completed', {
              component: ComponentType.WORD_LOOKUP,
              metadata: {
                format: format,
                totalWords: words.length,
                successCount: successCount,
              },
            });
            
            // Refresh the list to show imported words
            await this.refresh();
            
            // Show success message to user
            alert(`Successfully imported ${successCount} out of ${words.length} words.`);
            
          } catch (error) {
            this.logger?.error('Import failed', {
              component: ComponentType.WORD_LOOKUP,
              metadata: {
                error: error instanceof Error ? error.message : String(error),
                format: format,
              },
            });
            alert(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
      };
      
      // Trigger file selection
      fileInput.click();
      
    } catch (error) {
      this.logger?.error('Error starting import', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          format: format,
        },
      });
    }
  }

  private async handleExportRequest(format: 'json' | 'csv' | 'anki'): Promise<void> {
    this.logger?.info('Export requested', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        format: format,
      },
    });

    try {
      const exportResult = await this.vocabularyManager.exportVocabulary(format);
      if (exportResult.success && exportResult.data) {
        const { data } = exportResult;
        const filename =
          format === 'json'
            ? 'vocabulary-export.json'
            : format === 'csv'
              ? 'vocabulary-export.csv'
              : 'vocabulary-export.txt';
        const mimeType =
          format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain';

        this.downloadFile(data, filename, mimeType);
        this.logger?.info('Export completed', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { filename, format },
        });
      } else {
        this.logger?.error('Export failed', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { format, error: exportResult.error?.message },
        });
      }
    } catch (error) {
      this.logger?.error('Error during export', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          format: format,
        },
      });
    }
  }

  private handleKeyboardShortcut(event: KeyboardEvent): void {
    if (!this.config.keyboardShortcut) return;

    // Don't interfere if user is typing in input fields
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Only respond to specific modifier key combinations to avoid conflicts
    const shortcut = this.config.keyboardShortcut.toLowerCase();
    
    // Parse the expected shortcut (e.g., "Ctrl+Shift+V")
    const expectedKeys = shortcut.split('+').map(k => k.trim().toLowerCase());
    const actualKeys: string[] = [];
    
    if (event.ctrlKey) actualKeys.push('ctrl');
    if (event.shiftKey) actualKeys.push('shift');
    if (event.altKey) actualKeys.push('alt');
    if (event.metaKey) actualKeys.push('meta');
    actualKeys.push(event.key.toLowerCase());

    // Check if pressed combination matches expected
    const matches = expectedKeys.length === actualKeys.length && 
                   expectedKeys.every(key => actualKeys.includes(key));

    if (matches) {
      event.preventDefault();
      event.stopPropagation();
      
      // Toggle visibility - this now works properly with the fixed container system
      if (this.state.isVisible) {
        this.hide();
      } else {
        this.show();
      }
    }
  }

  private handleClickOutside(event: Event): void {
    if (!this.state.currentContainer || !this.state.isVisible) return;

    const target = event.target as Node;
    if (!this.state.currentContainer.contains(target)) {
      this.hide();
    }
  }

  private handleResize(): void {
    if (this.state.isVisible && this.state.currentContainer && this.config.position === 'popup') {
      this.positionPopup(this.state.currentContainer);
    }
  }

  private applyTheme(): void {
    if (!this.state.currentContainer) return;

    const theme = this.config.theme === 'auto' ? this.detectTheme() : this.config.theme;
    this.state.currentContainer.setAttribute('data-theme', theme);
  }

  private detectTheme(): 'light' | 'dark' {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private convertToCSV(words: VocabularyItem[]): string {
    const headers = ['Word', 'Translation', 'Context', 'Source Language', 'Target Language', 'Video Title', 'Timestamp', 'Created At'];
    const csvRows = [headers.join(',')];
    
    for (const word of words) {
      const row = [
        `"${word.word.replace(/"/g, '""')}"`,
        `"${word.translation.replace(/"/g, '""')}"`,
        `"${word.context.replace(/"/g, '""')}"`,
        `"${word.sourceLanguage}"`,
        `"${word.targetLanguage}"`,
        `"${word.videoTitle || ''}"`,
        `"${word.timestamp || ''}"`,
        `"${new Date(word.createdAt).toISOString()}"`,
      ];
      csvRows.push(row.join(','));
    }
    
    return csvRows.join('\n');
  }

  private convertToAnki(words: VocabularyItem[]): string {
    // Anki format: Front\tBack\tExtra
    const ankiRows = [];
    
    for (const word of words) {
      const front = word.word;
      const back = word.translation;
      const extra = `${word.context}${word.videoTitle ? ` (from: ${word.videoTitle})` : ''}`;
      ankiRows.push(`${front}\t${back}\t${extra}`);
    }
    
    return ankiRows.join('\n');
  }

  private readFileContent(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        resolve(event.target?.result as string);
      };
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsText(file);
    });
  }

  private async parseImportContent(content: string, format: 'json' | 'csv' | 'anki'): Promise<Partial<VocabularyItem>[]> {
    switch (format) {
      case 'json':
        try {
          const parsed = JSON.parse(content);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch (error) {
          throw new Error('Invalid JSON format');
        }
      
      case 'csv':
        const lines = content.split('\n').filter(line => line.trim());
        if (lines.length < 2) throw new Error('CSV file must have headers and at least one data row');
        
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        const words: Partial<VocabularyItem>[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
          if (values.length >= 5) {
            words.push({
              word: values[0],
              translation: values[1],
              context: values[2],
              sourceLanguage: values[3],
              targetLanguage: values[4],
              videoTitle: values[5] || undefined,
              timestamp: values[6] ? parseFloat(values[6]) : undefined,
            });
          }
        }
        return words;
      
      case 'anki':
        const ankiLines = content.split('\n').filter(line => line.trim());
        return ankiLines.map(line => {
          const parts = line.split('\t');
          if (parts.length >= 2) {
            return {
              word: parts[0],
              translation: parts[1],
              context: parts[2] || '',
              sourceLanguage: 'en', // Default
              targetLanguage: 'es', // Default
            };
          }
          return null;
        }).filter(Boolean) as Partial<VocabularyItem>[];
      
      default:
        throw new Error(`Unsupported import format: ${format}`);
    }
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Set up player state listeners for automatic repositioning
   */
  private setupPlayerStateListeners(): void {
    try {
      // Listen for fullscreen changes
      const fullscreenChangeHandler = () => {
        if (this.state.isVisible && this.state.currentContainer) {
          setTimeout(() => {
            this.positionPopup(this.state.currentContainer!);
          }, 100); // Small delay to ensure DOM is updated
        }
      };

      // Listen for window resize (affects all player modes)
      const resizeHandler = () => {
        if (this.state.isVisible && this.state.currentContainer) {
          this.positionPopup(this.state.currentContainer!);
        }
      };

      // Listen for YouTube-specific events (theater mode toggle, etc.)
      const observePlayerChanges = () => {
        const targetNode = document.body;
        const observer = new MutationObserver((mutations) => {
          let shouldReposition = false;
          
          mutations.forEach((mutation) => {
            if (mutation.type === 'attributes') {
              const target = mutation.target as HTMLElement;
              if (target.matches('[theater]') || 
                  target.matches('.ytp-fullscreen') ||
                  target.classList.contains('watch-wide')) {
                shouldReposition = true;
              }
            }
          });

          if (shouldReposition && this.state.isVisible && this.state.currentContainer) {
            setTimeout(() => {
              this.positionPopup(this.state.currentContainer!);
            }, 200);
          }
        });

        observer.observe(targetNode, {
          attributes: true,
          attributeFilter: ['theater', 'class'],
          subtree: true,
        });

        this.playerStateListeners.push(() => observer.disconnect());
      };

      // Register event listeners
      document.addEventListener('fullscreenchange', fullscreenChangeHandler);
      document.addEventListener('webkitfullscreenchange', fullscreenChangeHandler);
      document.addEventListener('mozfullscreenchange', fullscreenChangeHandler);
      document.addEventListener('msfullscreenchange', fullscreenChangeHandler);
      window.addEventListener('resize', resizeHandler);

      // Set up mutation observer for YouTube-specific changes
      observePlayerChanges();

      // Store cleanup functions
      this.playerStateListeners.push(
        () => document.removeEventListener('fullscreenchange', fullscreenChangeHandler),
        () => document.removeEventListener('webkitfullscreenchange', fullscreenChangeHandler),
        () => document.removeEventListener('mozfullscreenchange', fullscreenChangeHandler),
        () => document.removeEventListener('msfullscreenchange', fullscreenChangeHandler),
        () => window.removeEventListener('resize', resizeHandler)
      );

      this.logger?.info('Player state listeners setup completed', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          listenersCount: this.playerStateListeners.length,
        },
      });
    } catch (error) {
      this.logger?.warn('Failed to setup player state listeners', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Clean up player state listeners
   */
  private cleanupPlayerStateListeners(): void {
    this.playerStateListeners.forEach((cleanup) => cleanup());
    this.playerStateListeners = [];
  }

  /**
   * Helper to get the current video ID from the Enhanced Playback Controls
   */
  private getCurrentVideoId(): string | undefined {
    if (!this.enhancedPlaybackControls) {
      this.logger?.warn('Enhanced Playback Controls not available to get video ID', {
        component: ComponentType.WORD_LOOKUP,
      });
      return undefined;
    }

    const videoId = this.enhancedPlaybackControls.getVideoId();
    this.logger?.debug('Current video ID', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        videoId: videoId,
      },
    });
    return videoId;
  }

  /**
   * Helper to show a user-friendly error message
   */
  private showNavigationError(message: string): void {
    try {
      // Lazy import to avoid bundling issues if tree-shaken
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { showToast } = require('./Toast') as { showToast: (m: string, v?: any, d?: number) => void };
      showToast(message, 'error', 4000);
    } catch {
      // Fallback minimal inline toast if dynamic import fails
      const div = document.createElement('div');
      div.textContent = `[LinguaTube] ${message}`;
      div.style.cssText = 'position:fixed;top:20px;right:20px;background:#f56565;color:#fff;padding:12px 20px;border-radius:8px;z-index:2147483647;';
      document.body.appendChild(div);
      setTimeout(() => div.parentNode && div.parentNode.removeChild(div), 4000);
    }
    this.logger?.warn('Navigation error shown to user', {
      component: ComponentType.WORD_LOOKUP,
      metadata: { message },
    });
  }

  /**
   * Helper to show a user-friendly success message
   */
  private showNavigationSuccess(message: string): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { showToast } = require('./Toast') as { showToast: (m: string, v?: any, d?: number) => void };
      showToast(message, 'success', 4000);
    } catch {
      const div = document.createElement('div');
      div.textContent = `[LinguaTube] ${message}`;
      div.style.cssText = 'position:fixed;top:20px;right:20px;background:#4CAF50;color:#fff;padding:12px 20px;border-radius:8px;z-index:2147483647;';
      document.body.appendChild(div);
      setTimeout(() => div.parentNode && div.parentNode.removeChild(div), 4000);
    }
    this.logger?.info('Navigation success shown to user', {
      component: ComponentType.WORD_LOOKUP,
      metadata: { message },
    });
  }

  /**
   * Debug subtitle availability by attempting to jump to a known subtitle
   */
  private async debugSubtitleAvailability(): Promise<void> {
    this.logger?.debug('Attempting to debug subtitle availability', {
      component: ComponentType.WORD_LOOKUP,
    });

    const subtitleLookup = await this.vocabularyManager.getSubtitlesByVocabularyWords(['hello']);
    if (subtitleLookup.success && subtitleLookup.data && subtitleLookup.data.length > 0) {
      this.logger?.info('Subtitle track found for "hello"', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          subtitleId: subtitleLookup.data[0].subtitleId,
          word: 'hello',
        },
      });
      // If subtitle track is found, try to jump to it
      try {
        if (!this.enhancedPlaybackControls) {
          this.logger?.warn('Enhanced playback controls not available for debug subtitle jump', {
            component: ComponentType.WORD_LOOKUP,
          });
          return;
        }
        
        const success = this.enhancedPlaybackControls.jumpToSubtitleWithContext(subtitleLookup.data[0].subtitleId, {
          bufferTime: 0.1, // Reduced from 0.3 to 0.1 for more precise timing
          highlightDuration: 3000,
          enableAutoLoop: false,
        });
        if (success) {
          this.logger?.info('Successfully navigated to subtitle track for "hello"', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              subtitleId: subtitleLookup.data[0].subtitleId,
              word: 'hello',
            },
          });
          this.showNavigationSuccess(`Navigated to subtitle for "hello"`);
        } else {
          this.logger?.warn('Failed to navigate to subtitle track for "hello"', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              subtitleId: subtitleLookup.data[0].subtitleId,
              word: 'hello',
            },
          });
        }
      } catch (error) {
        this.logger?.error('Error during subtitle jump debug', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            subtitleId: subtitleLookup.data[0].subtitleId,
            word: 'hello',
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    } else {
      this.logger?.warn('No subtitle track found for "hello"', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: 'hello',
        },
      });
      this.showNavigationError(`Subtitle track for "hello" not found. Ensure subtitles are loaded.`);
    }
  }
}

// ========================================
// Convenience Functions
// ========================================

/**
 * Show vocabulary list (convenience function)
 */
export async function showVocabularyList(
  config?: Partial<VocabularyListManagerConfig>,
  container?: HTMLElement,
): Promise<VocabularyListManager> {
  const manager = VocabularyListManager.getInstance(config);
  await manager.initialize();
  await manager.show(container);
  return manager;
}

/**
 * Hide vocabulary list (convenience function)
 */
export function hideVocabularyList(): void {
  const manager = VocabularyListManager.getInstance();
  manager.hide();
}

/**
 * Toggle vocabulary list (convenience function)
 */
export async function toggleVocabularyList(
  config?: Partial<VocabularyListManagerConfig>,
  container?: HTMLElement,
): Promise<VocabularyListManager> {
  const manager = VocabularyListManager.getInstance(config);
  await manager.initialize();
  await manager.toggle(container);
  return manager;
}
