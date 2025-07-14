/**
 * Vocabulary List Manager for LinguaTube
 * High-level interface for managing vocabulary list UI components
 */

import {
  VocabularyListComponent,
  VocabularyListConfig,
  VocabularyListEvents,
} from './VocabularyListComponent';
import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { VocabularyItem } from '../storage/types';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';

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
// Default Configuration
// ========================================

export const DEFAULT_MANAGER_CONFIG: VocabularyListManagerConfig = {
  position: 'popup',
  theme: 'light',
  autoShow: false,
  showOnHover: false,
  hideOnClickOutside: true,
  enableKeyboardShortcuts: true,
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
  private readonly logger = Logger.getInstance();

  private constructor(config: Partial<VocabularyListManagerConfig> = {}) {
    this.config = { ...DEFAULT_MANAGER_CONFIG, ...config };
    this.vocabularyManager = VocabularyManager.getInstance();
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
    if (this.state.isVisible) return;

    try {
      const targetContainer = container || this.createContainer();

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

      this.logger?.info('Vocabulary list shown', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          position: this.config.position,
          hasContainer: !!container,
        },
      });
    } catch (error) {
      this.logger?.error('Failed to show vocabulary list', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          position: this.config.position,
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
      if (this.state.activeComponent) {
        this.state.activeComponent.destroy();
      }

      if (this.state.currentContainer && this.config.position === 'popup') {
        document.body.removeChild(this.state.currentContainer);
      }

      this.removeContainerInteractions();

      this.state = {
        ...this.state,
        isVisible: false,
        currentContainer: null,
        activeComponent: null,
      };

      this.logger?.info('Vocabulary list hidden', {
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
      document.body.appendChild(container);
      this.positionPopup(container);
    }

    return container;
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
    // Smart positioning to avoid YouTube UI elements
    const youtubeElements = this.getYouTubeUIElements();
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    // Default center position
    let x = viewport.width / 2;
    let y = viewport.height / 2;

    // Adjust if overlapping with YouTube UI
    for (const element of youtubeElements) {
      const rect = element.rect;
      const centerX = viewport.width / 2;
      const centerY = viewport.height / 2;

      if (
        centerX >= rect.left &&
        centerX <= rect.right &&
        centerY >= rect.top &&
        centerY <= rect.bottom
      ) {
        // Move to avoid overlap
        if (rect.left > viewport.width / 3) {
          x = rect.left - 220; // Position to the left
        } else if (rect.right < (2 * viewport.width) / 3) {
          x = rect.right + 20; // Position to the right
        } else {
          y = rect.top - 300; // Position above
        }
        break;
      }
    }

    container.style.left = `${Math.max(20, Math.min(x - 200, viewport.width - 420))}px`;
    container.style.top = `${Math.max(20, Math.min(y - 250, viewport.height - 520))}px`;
    container.style.transform = 'none';
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

  private setupComponentEvents(component: VocabularyListComponent): void {
    const events: VocabularyListEvents = {
      onWordSelect: this.handleWordSelect.bind(this),
      onWordEdit: this.handleWordEdit.bind(this),
      onWordDelete: this.handleWordDelete.bind(this),
      onBulkAction: this.handleBulkAction.bind(this),
      onSearchChange: this.handleSearchChange.bind(this),
      onFilterChange: this.handleFilterChange.bind(this),
      onImportRequest: this.handleImportRequest.bind(this),
      onExportRequest: this.handleExportRequest.bind(this),
    };

    Object.entries(events).forEach(([event, handler]) => {
      component.on(event as keyof VocabularyListEvents, handler);
    });
  }

  private handleWordSelect(word: VocabularyItem): void {
    this.logger?.info('Word selected', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        word: word.word,
        wordId: word.id,
      },
    });
    // Could emit custom events or trigger other actions
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
    this.logger?.info('Import completed', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        format: format,
      },
    });
    // The actual import is handled by the VocabularyListComponent
    // This is just for logging and potential additional actions
    await this.refresh();
  }

  private async handleExportRequest(format: 'json' | 'csv' | 'anki'): Promise<void> {
    this.logger?.info('Export requested', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        format: format,
      },
    });

    try {
      const result = await this.vocabularyManager.exportVocabulary(format);
      if (result.success && result.data) {
        const filename = `vocabulary-export.${format}`;
        const mimeType = format === 'json' ? 'application/json' : 'text/plain';
        this.downloadFile(result.data, filename, mimeType);
        this.logger?.info('Export completed', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            filename: filename,
            format: format,
          },
        });
      } else {
        this.logger?.error('Export failed', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            error: result.error?.message || 'Unknown error',
            format: format,
          },
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

    const shortcut = this.config.keyboardShortcut.toLowerCase();
    const pressed = [];

    if (event.ctrlKey) pressed.push('ctrl');
    if (event.shiftKey) pressed.push('shift');
    if (event.altKey) pressed.push('alt');
    pressed.push(event.key.toLowerCase());

    const pressedShortcut = pressed.join('+');

    if (pressedShortcut === shortcut) {
      event.preventDefault();
      this.toggle();
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
