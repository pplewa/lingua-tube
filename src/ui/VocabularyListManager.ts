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
    try {
      // REAL FIX: Work with ContentScript's container system properly
      const targetContainer = container || this.createContainer();
      
      // If we already have a component and the same container, just make it visible
      if (this.state.activeComponent && this.state.currentContainer === targetContainer) {
        if (targetContainer.style.display === 'none') {
          targetContainer.style.display = 'block';
        }
        this.state = { ...this.state, isVisible: true };
        return;
      }

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
      // REAL FIX: Don't destroy the component if using ContentScript's container
      // Just hide it so we can reopen properly
      if (this.state.currentContainer) {
        if (this.state.currentContainer.id === 'linguatube-vocabulary-list-container') {
          // This is ContentScript's container - just hide it
          this.state.currentContainer.style.display = 'none';
        } else {
          // This is our popup container - remove it  
          if (this.state.activeComponent) {
            this.state.activeComponent.destroy();
          }
          document.body.removeChild(this.state.currentContainer);
          this.state = { ...this.state, currentContainer: null, activeComponent: null };
        }
      }

      this.removeContainerInteractions();
      this.state = { ...this.state, isVisible: false };

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

  /**
   * Set a custom handler for word selection events
   */
  public setWordSelectHandler(handler: (word: VocabularyItem) => void): void {
    this.customWordSelectHandler = handler;
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
      // Get vocabulary data directly since exportVocabulary doesn't exist
      const result = await this.vocabularyManager.getVocabulary();
      if (result.success && result.data) {
        let exportData: string;
        let filename: string;
        let mimeType: string;

        switch (format) {
          case 'json':
            exportData = JSON.stringify(result.data, null, 2);
            filename = 'vocabulary-export.json';
            mimeType = 'application/json';
            break;
          case 'csv':
            exportData = this.convertToCSV(result.data);
            filename = 'vocabulary-export.csv';
            mimeType = 'text/csv';
            break;
          case 'anki':
            exportData = this.convertToAnki(result.data);
            filename = 'vocabulary-export.txt';
            mimeType = 'text/plain';
            break;
          default:
            throw new Error(`Unsupported export format: ${format}`);
        }

        this.downloadFile(exportData, filename, mimeType);
        this.logger?.info('Export completed', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            filename: filename,
            format: format,
            wordCount: result.data.length,
          },
        });
      } else {
        this.logger?.error('Export failed - no vocabulary data', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            error: result.error?.message || 'No vocabulary data available',
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
