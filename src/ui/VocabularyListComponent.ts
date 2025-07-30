/**
 * Vocabulary List Component for LinguaTube
 * Provides a comprehensive UI for displaying, searching, and managing vocabulary words
 */

import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { VocabularyObserver, VocabularyEventType } from '../vocabulary/VocabularyObserver';
import { VocabularyItem } from '../storage/types';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';
import { storageService, VocabularyListSettings } from '../storage'; // CRITICAL FIX: Add StorageService for persistence

// ========================================
// Types and Interfaces
// ========================================

export interface VocabularyListConfig {
  readonly maxHeight: number;
  readonly itemHeight: number;
  readonly bufferSize: number;
  readonly searchDebounceMs: number;
  readonly animationDuration: number;
  readonly enableVirtualScrolling: boolean;
  readonly enableSearch: boolean;
  readonly enableFilters: boolean;
  readonly enableSorting: boolean;
  readonly enableBulkActions: boolean;
  readonly enableImport: boolean;
  readonly enableExport: boolean;
  readonly showWordCount: boolean;
  readonly showProgress: boolean;
  readonly pageSize: number;
}

export interface VocabularyListEvents {
  onWordSelect: (word: VocabularyItem) => void;
  onWordEdit: (word: VocabularyItem) => void;
  onWordDelete: (word: VocabularyItem) => void;
  onWordNavigate?: (word: VocabularyItem) => void; // New navigation event
  onBulkAction: (action: string, words: VocabularyItem[]) => void;
  onSearchChange: (query: string) => void;
  onFilterChange: (filters: any) => void;
  onImportRequest: (format: 'json' | 'csv' | 'anki') => void;
  onExportRequest: (format: 'json' | 'csv' | 'anki') => void;
  onVocabularyLoaded?: (words: VocabularyItem[]) => void; // New event for vocabulary loading
}

export interface ListState {
  readonly words: VocabularyItem[];
  readonly filteredWords: VocabularyItem[];
  readonly selectedWords: Set<string>;
  readonly searchQuery: string;
  readonly sortBy: string;
  readonly sortOrder: 'asc' | 'desc';
  readonly currentPage: number;
  readonly isLoading: boolean;
  readonly error: string | null;
}

// ========================================
// Default Configuration
// ========================================

export const DEFAULT_LIST_CONFIG: VocabularyListConfig = {
  maxHeight: 600,
  itemHeight: 80,
  bufferSize: 5,
  searchDebounceMs: 300,
  animationDuration: 250,
  enableVirtualScrolling: false, // Disable virtual scrolling to show all words
  enableSearch: true,
  enableFilters: true,
  enableSorting: true,
  enableBulkActions: true,
  enableImport: true,
  enableExport: true,
  showWordCount: true,
  showProgress: true,
  pageSize: 50,
};

// ========================================
// CSS Styles
// ========================================

const VOCABULARY_LIST_STYLES = `
  .vocabulary-list-container {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #ffffff;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    border: 1px solid rgba(0, 0, 0, 0.1);
    max-height: 600px;
    display: flex;
    flex-direction: column;
  }

  .vocabulary-header {
    padding: 16px 20px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: grab; /* Show that header is draggable */
  }

  .vocabulary-header:active {
    cursor: grabbing;
  }

  .vocabulary-title {
    font-size: 18px;
    font-weight: 600;
    color: #2d3748;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .drag-handle {
    font-size: 16px;
    color: #a0aec0;
    cursor: grab;
    user-select: none;
    padding: 4px;
    line-height: 1;
  }

  .drag-handle:hover {
    color: #718096;
  }

  .close-button {
    background: none;
    border: none;
    font-size: 20px;
    color: #a0aec0;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
    transition: all 0.2s;
  }

  .close-button:hover {
    background: #e2e8f0;
    color: #4a5568;
  }

  .vocabulary-stats {
    font-size: 14px;
    color: #718096;
    display: flex;
    gap: 16px;
  }

  .vocabulary-controls {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .controls-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    cursor: pointer;
    border-bottom: 1px solid #e2e8f0;
    transition: background-color 0.2s;
  }

  .controls-toggle:hover {
    background: #edf2f7;
  }

  .controls-toggle-text {
    font-size: 14px;
    font-weight: 500;
    color: #4a5568;
  }

  .controls-toggle-icon {
    font-size: 12px;
    color: #718096;
    transition: transform 0.2s;
  }

  .controls-toggle-icon.expanded {
    transform: rotate(180deg);
  }

  .controls-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    transition: max-height 0.3s ease-out, opacity 0.2s ease-out;
    overflow: hidden;
  }

  .controls-content.collapsed {
    max-height: 0;
    padding: 0 16px;
    opacity: 0;
  }

  .controls-content:not(.collapsed) {
    max-height: 200px;
    opacity: 1;
  }

  .search-container {
    position: relative;
    width: 100%;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
  }

  .filter-container {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
  }

  .filter-label {
    font-size: 14px;
    font-weight: 500;
    color: #4a5568;
    min-width: 50px;
    flex-shrink: 0;
  }

  .controls-row {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .search-input {
    width: 100%;
    padding: 8px 12px 8px 36px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 14px;
    background: #ffffff;
    transition: border-color 0.2s;
    box-sizing: border-box;
  }

  .search-input:focus {
    outline: none;
    border-color: #4299e1;
    box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.1);
  }

  .search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: #a0aec0;
    pointer-events: none;
  }

  .filter-select {
    padding: 8px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 14px;
    background: #ffffff;
    cursor: pointer;
    min-width: 160px;
    flex: 1;
    appearance: none;
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3e%3c/svg%3e");
    background-position: right 8px center;
    background-repeat: no-repeat;
    background-size: 16px 16px;
    padding-right: 32px;
  }

  .filter-select:focus {
    outline: none;
    border-color: #4299e1;
    box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.1);
  }

  .filter-select option:disabled {
    color: #a0aec0;
  }

  .sort-button {
    padding: 8px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #ffffff;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: background-color 0.2s;
  }

  .sort-button:hover {
    background: #f7fafc;
  }

  .import-export-container {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .import-button, .export-button {
    padding: 8px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #ffffff;
    cursor: pointer;
    font-size: 14px;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: background-color 0.2s;
  }

  .import-button:hover, .export-button:hover {
    background: #f7fafc;
  }

  .import-button {
    color: #2b6cb0;
    border-color: #bee3f8;
  }

  .export-button {
    color: #2f855a;
    border-color: #c6f6d5;
  }

  .file-input {
    display: none;
  }

  .format-dropdown {
    position: relative;
    display: inline-block;
  }

  .format-menu {
    position: absolute;
    top: 100%;
    left: 0;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    min-width: 120px;
    display: none;
  }

  .format-menu.show {
    display: block;
  }

  .format-option {
    padding: 8px 12px;
    cursor: pointer;
    font-size: 14px;
    border-bottom: 1px solid #f1f5f9;
  }

  .format-option:last-child {
    border-bottom: none;
  }

  .format-option:hover {
    background: #f8fafc;
  }

  .vocabulary-list {
    flex: 1;
    overflow-y: auto;
    position: relative;
  }

  .list-item {
    padding: 16px 20px;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: background-color 0.2s;
    cursor: pointer;
  }

  .list-item:hover {
    background: #f8fafc;
  }

  .list-item.selected {
    background: #ebf8ff;
    border-left: 3px solid #4299e1;
  }

  /* CRITICAL FIX: Add keyboard focus styling for accessibility */
  .list-item.keyboard-focus {
    background: #fef5e7;
    border: 2px solid #f6ad55;
    box-shadow: 0 0 0 2px rgba(246, 173, 85, 0.2);
    outline: none;
  }

  /* Combined states: selected and keyboard focused */
  .list-item.selected.keyboard-focus {
    background: #e6fffa;
    border: 2px solid #38b2ac;
    border-left: 3px solid #4299e1;
    box-shadow: 0 0 0 2px rgba(56, 178, 172, 0.2);
  }

  /* CRITICAL FIX: Vocabulary mode active styling */
  .vocabulary-mode-active .list-item {
    transition: all 0.2s ease-in-out;
  }

  .vocabulary-mode-active .list-item .item-word {
    font-weight: 600;
    color: #2d3748;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }

  .vocabulary-mode-active .list-item:hover .item-word {
    color: #4299e1;
    transform: translateX(2px);
  }

  .vocabulary-mode-active .list-item .item-translation {
    font-style: italic;
    color: #4a5568;
  }

  .vocabulary-mode-active .vocabulary-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .vocabulary-mode-active .vocabulary-title {
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  }

  .item-checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .item-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .item-word {
    font-size: 16px;
    font-weight: 600;
    color: #2d3748;
    margin-bottom: 4px;
    cursor: pointer; /* Make word clickable */
    transition: all 0.2s ease;
    padding: 4px 8px;
    border-radius: 4px;
    display: inline-block;
  }

  .item-word:hover {
    background-color: #e2e8f0;
    color: #1a365d;
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .item-word:active {
    transform: translateY(0);
    background-color: #cbd5e0;
  }

  .vocabulary-navigation-highlight {
    background-color: #fbbf24 !important;
    color: #1f2937 !important;
    box-shadow: 0 0 0 2px #fbbf24, 0 4px 8px rgba(251, 191, 36, 0.3) !important;
    transform: translateY(-1px) !important;
    animation: vocabulary-highlight-pulse 0.6s ease-in-out;
  }

  @keyframes vocabulary-highlight-pulse {
    0% {
      box-shadow: 0 0 0 2px #fbbf24, 0 4px 8px rgba(251, 191, 36, 0.3);
      transform: translateY(-1px) scale(1);
    }
    50% {
      box-shadow: 0 0 0 4px #fbbf24, 0 6px 12px rgba(251, 191, 36, 0.4);
      transform: translateY(-2px) scale(1.02);
    }
    100% {
      box-shadow: 0 0 0 2px #fbbf24, 0 4px 8px rgba(251, 191, 36, 0.3);
      transform: translateY(-1px) scale(1);
    }
  }

  /* ========================================
   * YouTube Player Mode Adaptations
   * ======================================== */

  .vocabulary-list-manager-container.fullscreenmode .vocabulary-list-container {
    max-width: 35vw;
    max-height: 90vh;
    font-size: 14px;
  }

  .vocabulary-list-manager-container.fullscreenmode .vocabulary-header {
    padding: 12px 16px;
  }

  .vocabulary-list-manager-container.fullscreenmode .vocabulary-title {
    font-size: 16px;
  }

  .vocabulary-list-manager-container.fullscreenmode .item-height {
    min-height: 70px;
  }

  .vocabulary-list-manager-container.theatermode .vocabulary-list-container {
    max-width: 400px;
    max-height: 80vh;
  }

  .vocabulary-list-manager-container.theatermode .vocabulary-header {
    padding: 14px 18px;
  }

  .vocabulary-list-manager-container.miniplayermode .vocabulary-list-container {
    max-width: 350px;
    max-height: 400px;
    font-size: 13px;
  }

  .vocabulary-list-manager-container.miniplayermode .vocabulary-header {
    padding: 10px 14px;
  }

  .vocabulary-list-manager-container.miniplayermode .vocabulary-title {
    font-size: 16px;
  }

  .vocabulary-list-manager-container.miniplayermode .item-height {
    min-height: 65px;
  }

  .vocabulary-list-manager-container.miniplayermode .search-input,
  .vocabulary-list-manager-container.miniplayermode .filter-select {
    padding: 6px 10px;
    font-size: 12px;
  }

  .vocabulary-list-manager-container.defaultmode .vocabulary-list-container {
    max-width: 400px;
    max-height: 600px;
  }

  /* Responsive adjustments for different screen sizes */
  @media (max-width: 1200px) {
    .vocabulary-list-manager-container.theatermode .vocabulary-list-container,
    .vocabulary-list-manager-container.defaultmode .vocabulary-list-container {
      max-width: 350px;
    }
  }

  @media (max-width: 900px) {
    .vocabulary-list-manager-container .vocabulary-list-container {
      max-width: 320px;
      font-size: 13px;
    }
    
    .vocabulary-list-manager-container .vocabulary-header {
      padding: 12px 14px;
    }
  }

  .item-translation {
    font-size: 14px;
    color: #4a5568;
  }

  .item-meta {
    font-size: 12px;
    color: #718096;
    display: flex;
    gap: 12px;
  }

  .item-actions {
    display: flex;
    gap: 8px;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .list-item:hover .item-actions {
    opacity: 1;
  }

  .action-button {
    padding: 6px 8px;
    border: none;
    border-radius: 4px;
    background: #e2e8f0;
    color: #4a5568;
    cursor: pointer;
    font-size: 12px;
    transition: background-color 0.2s;
  }

  .action-button:hover {
    background: #cbd5e0;
  }

  .action-button.danger:hover {
    background: #feb2b2;
    color: #c53030;
  }

  .bulk-actions {
    padding: 12px 20px;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
    display: none;
    align-items: center;
    gap: 12px;
  }

  .bulk-actions.visible {
    display: flex;
  }

  .loading-state {
    padding: 40px 20px;
    text-align: center;
    color: #718096;
  }

  .empty-state {
    padding: 40px 20px;
    text-align: center;
    color: #718096;
  }

  .error-state {
    padding: 20px;
    background: #fed7d7;
    color: #c53030;
    border-radius: 6px;
    margin: 12px;
  }

  .progress-bar {
    height: 4px;
    background: #e2e8f0;
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #4299e1;
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .drag-handle {
    cursor: grab;
    user-select: none;
    padding: 0 8px;
  }

  .close-button {
    background: none;
    border: none;
    font-size: 24px;
    color: #a0aec0;
    cursor: pointer;
    padding: 0 8px;
    transition: color 0.2s;
  }

  .close-button:hover {
    color: #718096;
  }
`;

// ========================================
// Vocabulary List Component
// ========================================

export class VocabularyListComponent {
  private container: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;

  private vocabularyManager: VocabularyManager;
  private vocabularyObserver: VocabularyObserver;

  private config: VocabularyListConfig;
  private events: { [K in keyof VocabularyListEvents]?: VocabularyListEvents[K] } = {};
  private readonly logger = Logger.getInstance();

  private state: ListState;
  private eventListenersAttached: boolean = false; // CRITICAL FIX: Track event listener attachment
  private currentFocusIndex: number = -1; // Track currently focused item for keyboard navigation
  private currentVideoFilter: 'all' | 'current' = 'current'; // Track video filter mode - default to current video
  private controlsCollapsed: boolean = true; // Controls are collapsed by default to save space
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private virtualScrollOffset = 0;
  private visibleRange = { start: 0, end: 0 };

  constructor(config: Partial<VocabularyListConfig> = {}) {
    this.config = { ...DEFAULT_LIST_CONFIG, ...config };
    this.vocabularyManager = VocabularyManager.getInstance();
    this.vocabularyObserver = VocabularyObserver.getInstance();

    // Initialize state
    this.state = {
      words: [],
      filteredWords: [],
      selectedWords: new Set(),
      searchQuery: '',
      sortBy: 'dateAdded',
      sortOrder: 'desc',
      currentPage: 0,
      isLoading: false,
      error: null,
    };

    this.setupEventListeners();
    this.setupVideoChangeListener();
  }

  /**
   * Focus the vocabulary list for keyboard navigation
   */
  public focus(): void {
    if (this.shadowRoot) {
      const container = this.shadowRoot.querySelector('.vocabulary-list-container') as HTMLElement;
      if (container) {
        container.focus();
        // Reset focus index when manually focusing
        this.currentFocusIndex = -1;
        this.updateFocusHighlight();
      }
    }
  }

  /**
   * Load vocabulary list preferences from Chrome Storage
   */
  private async loadPreferences(): Promise<void> {
    try {
      const result = await storageService.getSettings();
      if (result.success && result.data) {
        const preferences = result.data.ui.vocabularyList;
        
        // Apply loaded preferences to component state
        this.updateState({
          sortBy: preferences.sortBy,
          sortOrder: preferences.sortOrder,
        });

        this.logger?.debug('Vocabulary list preferences loaded and applied', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            sortBy: preferences.sortBy,
            sortOrder: preferences.sortOrder,
            filterBy: preferences.filterBy,
            enableKeyboardNavigation: preferences.enableKeyboardNavigation,
          },
        });
      }
    } catch (error) {
      this.logger?.warn('Failed to load vocabulary list preferences', {
        component: ComponentType.VOCABULARY_LIST,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Save vocabulary list preferences to Chrome Storage
   */
  private async savePreferences(updates: Partial<VocabularyListSettings>): Promise<void> {
    try {
      // Get current settings
      const result = await storageService.getSettings();
      if (!result.success || !result.data) {
        this.logger?.warn('Failed to get current settings for saving preferences', {
          component: ComponentType.VOCABULARY_LIST,
        });
        return;
      }

      // Update vocabulary list settings
      const updatedSettings = {
        ...result.data,
        ui: {
          ...result.data.ui,
          vocabularyList: {
            ...result.data.ui.vocabularyList,
            ...updates,
          },
        },
      };

      // Save updated settings
      const saveResult = await storageService.saveSettings(updatedSettings);
      if (saveResult.success) {
        this.logger?.debug('Vocabulary list preferences saved', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: { updates },
        });
      } else {
        this.logger?.warn('Failed to save vocabulary list preferences', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: { error: saveResult.error?.message },
        });
      }
    } catch (error) {
      this.logger?.error('Error saving vocabulary list preferences', {
        component: ComponentType.VOCABULARY_LIST,  
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Set up listener for video changes to refresh vocabulary list
   */
  private setupVideoChangeListener(): void {
    let currentVideoId = this.getCurrentVideoId();
    
    // Listen for URL changes (YouTube navigation)
    const checkVideoChange = () => {
      const newVideoId = this.getCurrentVideoId();
      if (newVideoId !== currentVideoId) {
        this.logger?.debug('Video changed, refreshing vocabulary list', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            oldVideoId: currentVideoId,
            newVideoId: newVideoId,
          },
        });
        currentVideoId = newVideoId;
        this.loadVocabulary(); // Refresh with new video filter
      }
    };
    
    // Check for video changes every 2 seconds
    setInterval(checkVideoChange, 2000);
    
    // Also listen for popstate events (back/forward navigation)
    window.addEventListener('popstate', checkVideoChange);
  }

  // ========================================
  // Public API
  // ========================================

  public async initialize(container: HTMLElement): Promise<void> {
    this.logger?.debug('VocabularyListComponent initialization started', {
      component: ComponentType.VOCABULARY_LIST,
      metadata: {
        containerId: container.id,
        containerClass: container.className,
      },
    });

    // CRITICAL FIX: Reset event listener flag to ensure clean initialization
    this.eventListenersAttached = false;

    this.container = container;
    this.createShadowDOM();
    this.render();
    
    // CRITICAL FIX: Load preferences before loading vocabulary
    await this.loadPreferences();
    
    await this.loadVocabulary();
    
    this.logger?.debug('VocabularyListComponent initialization completed', {
      component: ComponentType.VOCABULARY_LIST,
      metadata: {
        wordsLoaded: this.state.words.length,
        hasError: !!this.state.error,
        error: this.state.error,
      },
    });
  }

  public async refresh(): Promise<void> {
    await this.loadVocabulary();
  }

  /**
   * Handle keyboard navigation within the vocabulary list
   */
  private handleKeyboardNavigation(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    
    // Don't interfere with typing in search input
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      if (event.key === 'Escape') {
        // Allow escape to close the list even from input fields
        this.handleAction('close', '');
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    const filteredWords = this.state.filteredWords;
    
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.currentFocusIndex = Math.min(this.currentFocusIndex + 1, filteredWords.length - 1);
        this.updateFocusHighlight();
        break;
        
      case 'ArrowUp':
        event.preventDefault();
        this.currentFocusIndex = Math.max(this.currentFocusIndex - 1, -1);
        this.updateFocusHighlight();
        break;
        
      case 'Enter':
        event.preventDefault();
        if (this.currentFocusIndex >= 0 && this.currentFocusIndex < filteredWords.length) {
          const word = filteredWords[this.currentFocusIndex];
          this.handleAction('navigate', word.id);
        }
        break;
        
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.handleAction('close', '');
        break;
        
      case 'Home':
        event.preventDefault();
        this.currentFocusIndex = filteredWords.length > 0 ? 0 : -1;
        this.updateFocusHighlight();
        break;
        
      case 'End':
        event.preventDefault();
        this.currentFocusIndex = filteredWords.length - 1;
        this.updateFocusHighlight();
        break;
    }
  }

  /**
   * Update visual focus highlight for keyboard navigation
   */
  private updateFocusHighlight(): void {
    if (!this.shadowRoot) return;

    // Remove existing focus highlights
    const existingHighlights = this.shadowRoot.querySelectorAll('.list-item.keyboard-focus');
    existingHighlights.forEach(item => item.classList.remove('keyboard-focus'));

    // Add focus to current item
    if (this.currentFocusIndex >= 0) {
      const items = this.shadowRoot.querySelectorAll('.list-item');
      const targetItem = items[this.currentFocusIndex];
      if (targetItem) {
        targetItem.classList.add('keyboard-focus');
        // Scroll item into view if needed
        targetItem.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'nearest',
          inline: 'nearest'
        });
      }
    }
  }

  public destroy(): void {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    // Remove event listeners
    this.vocabularyObserver.off(VocabularyEventType.WORD_ADDED);
    this.vocabularyObserver.off(VocabularyEventType.WORD_REMOVED);
    this.vocabularyObserver.off(VocabularyEventType.WORD_UPDATED);
    this.vocabularyObserver.off(VocabularyEventType.VOCABULARY_CLEARED);

    // CRITICAL FIX: Reset event listener flag to allow reattachment if component is recreated
    this.eventListenersAttached = false;

    if (this.container && this.shadowRoot) {
      this.container.removeChild(this.shadowRoot.host);
    }
  }

  public on<K extends keyof VocabularyListEvents>(
    event: K,
    callback: VocabularyListEvents[K],
  ): void {
    this.events[event] = callback;
  }

  public off<K extends keyof VocabularyListEvents>(event: K): void {
    delete this.events[event];
  }

  public getSelectedWords(): VocabularyItem[] {
    return this.state.words.filter((word) => this.state.selectedWords.has(word.id));
  }

  public clearSelection(): void {
    this.updateState({ selectedWords: new Set() });
  }

  public selectAll(): void {
    const allIds = new Set(this.state.filteredWords.map((word) => word.id));
    this.updateState({ selectedWords: allIds });
  }

  public search(query: string): void {
    this.updateState({ searchQuery: query });
    
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }
    
    this.searchTimeout = setTimeout(() => {
      this.logger?.debug('search timeout executing, calling applyFiltersAndSearch()', {
        component: ComponentType.VOCABULARY_LIST,
      });
      this.applyFiltersAndSearch();
    }, 300);
  }

  /**
   * Apply both search and video filtering
   */
  private applyFiltersAndSearch(): void {
    let filteredWords = this.state.words;
    const currentVideoId = this.getCurrentVideoId();

    this.logger?.debug('Applying filters and search', {
      component: ComponentType.VOCABULARY_LIST,
      metadata: {
        totalWords: this.state.words.length,
        currentVideoFilter: this.currentVideoFilter,
        currentVideoId,
        searchQuery: this.state.searchQuery,
        sampleWords: this.state.words.slice(0, 3).map(w => ({ word: w.word, videoId: w.videoId })),
      },
    });

    // Apply video filtering first if enabled
    if (this.currentVideoFilter === 'current') {
      if (currentVideoId) {
        const wordsForVideo = filteredWords.filter(word => {
          const matches = word.videoId === currentVideoId;
          if (!matches && filteredWords.length <= 5) {
            // Only log when there are few words to avoid spam
            this.logger?.debug('Word video ID mismatch', {
              component: ComponentType.VOCABULARY_LIST,
              metadata: {
                wordVideoId: word.videoId,
                currentVideoId,
                word: word.word,
              },
            });
          }
          return matches;
        });
        this.logger?.debug('Video filtering result', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            beforeFilter: filteredWords.length,
            afterFilter: wordsForVideo.length,
            currentVideoId,
            matchingWords: wordsForVideo.slice(0, 3).map(w => ({ word: w.word, videoId: w.videoId })),
            nonMatchingVideoIds: filteredWords.filter(w => w.videoId !== currentVideoId).slice(0, 3).map(w => w.videoId),
          },
        });
        filteredWords = wordsForVideo;
      } else {
        this.logger?.debug('No current video ID - showing no words', {
          component: ComponentType.VOCABULARY_LIST,
        });
        filteredWords = []; // No current video, show nothing
      }
    }

    // Apply search filtering
    const query = this.state.searchQuery;
    if (query) {
      filteredWords = filteredWords.filter((word) =>
        word.word.toLowerCase().includes(query.toLowerCase()) ||
        word.translation.toLowerCase().includes(query.toLowerCase())
      );
    }

    // Apply sorting
    filteredWords.sort((a, b) => {
      let aValue: any, bValue: any;

      switch (this.state.sortBy) {
        case 'word':
          aValue = a.word.toLowerCase();
          bValue = b.word.toLowerCase();
          break;
        case 'translation':
          aValue = a.translation.toLowerCase();
          bValue = b.translation.toLowerCase();
          break;
        case 'dateAdded':
          aValue = a.createdAt;
          bValue = b.createdAt;
          break;
        case 'reviewCount':
          aValue = a.reviewCount || 0;
          bValue = b.reviewCount || 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return this.state.sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return this.state.sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    this.logger?.debug('Final filtered and sorted result', {
      component: ComponentType.VOCABULARY_LIST,
      metadata: {
        finalCount: filteredWords.length,
        sampleFiltered: filteredWords.slice(0, 3).map(w => ({ word: w.word, videoId: w.videoId })),
        sortBy: this.state.sortBy,
        sortOrder: this.state.sortOrder,
      },
    });

    this.updateState({ filteredWords });
    // Reset keyboard navigation focus when search results change
    this.currentFocusIndex = -1;
    this.updateFocusHighlight();
    
    // CRITICAL FIX: Re-render to show the filtered results
    this.render();
  }

  /**
   * Toggle the controls section visibility
   */
  private toggleControls(): void {
    this.controlsCollapsed = !this.controlsCollapsed;
    this.render(); // Re-render to update the UI
    
    this.logger?.debug('Controls toggled', {
      component: ComponentType.VOCABULARY_LIST,
      metadata: {
        collapsed: this.controlsCollapsed,
      },
    });
  }

  /**
   * Set the video filter mode and apply filters
   */
  private setVideoFilter(filterMode: 'all' | 'current'): void {
    this.currentVideoFilter = filterMode;
    this.applyFiltersAndSearch();
    
    this.logger?.debug('Video filter changed', {
      component: ComponentType.VOCABULARY_LIST,
      metadata: {
        filterMode,
        currentVideoId: this.getCurrentVideoId(),
        totalWords: this.state.words.length,
        filteredWords: this.state.filteredWords.length,
      },
    });
  }

  public sort(sortBy: string, sortOrder: 'asc' | 'desc'): void {
    // CRITICAL FIX: Save preferences when sorting changes
    this.savePreferences({ 
      sortBy: sortBy as VocabularyListSettings['sortBy'], 
      sortOrder: sortOrder 
    });

    this.updateState({ sortBy, sortOrder });
    // Use the new filter method that includes video filtering and renders
    this.applyFiltersAndSearch();
  }

  // ========================================
  // Private Methods
  // ========================================

  private setupEventListeners(): void {
    this.vocabularyObserver.on(VocabularyEventType.WORD_ADDED, () => {
      this.loadVocabulary();
    });

    this.vocabularyObserver.on(VocabularyEventType.WORD_REMOVED, () => {
      this.loadVocabulary();
    });

    this.vocabularyObserver.on(VocabularyEventType.WORD_UPDATED, () => {
      this.loadVocabulary();
    });

    this.vocabularyObserver.on(VocabularyEventType.VOCABULARY_CLEARED, () => {
      this.updateState({ words: [], filteredWords: [] });
    });
  }

  private createShadowDOM(): void {
    if (!this.container) return;

    const host = document.createElement('div');
    host.className = 'vocabulary-list-host';
    this.shadowRoot = host.attachShadow({ mode: 'open' });

    // FINAL FIX: Smart keyboard isolation - only block events that would trigger YouTube shortcuts
    // Allow normal typing in input fields, but prevent YouTube shortcuts when not in inputs
    const keyboardEventTypes = ['keydown', 'keyup', 'keypress'];
    keyboardEventTypes.forEach(eventType => {
      host.addEventListener(eventType, (e) => {
        const keyboardEvent = e as KeyboardEvent;
        const target = keyboardEvent.target as HTMLElement;
        
        // NEVER block keyboard events if user is typing in input fields
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return; // Let it work normally
        }

        // Only block events that could trigger YouTube shortcuts (single key presses)
        const isYouTubeShortcut = !keyboardEvent.ctrlKey && !keyboardEvent.shiftKey && !keyboardEvent.altKey && !keyboardEvent.metaKey && 
                                 keyboardEvent.key.length === 1 && keyboardEvent.key.match(/[a-zA-Z0-9]/);
        
        if (isYouTubeShortcut) {
          keyboardEvent.stopPropagation();
          keyboardEvent.stopImmediatePropagation();
        }
      }, true);
    });

    // Add styles
    const style = document.createElement('style');
    style.textContent = VOCABULARY_LIST_STYLES;
    this.shadowRoot.appendChild(style);

    this.container.appendChild(host);
  }

  private async loadVocabulary(): Promise<void> {
    this.updateState({ isLoading: true, error: null });

    try {
      this.logger?.debug('Loading vocabulary data...', {
        component: ComponentType.VOCABULARY_LIST,
        action: 'vocabulary_load_start',
      });

      // CRITICAL FIX: Load all vocabulary by default, not filtered by current video
      const result = await this.vocabularyManager.getVocabulary();
      
      this.logger?.debug('Vocabulary manager returned result', {
        component: ComponentType.VOCABULARY_LIST,
        metadata: {
          success: result.success,
          hasData: !!result.data,
          dataLength: result.data?.length || 0,
          sampleData: result.data ? result.data.slice(0, 3).map(w => ({ word: w.word, videoId: w.videoId })) : null,
          error: result.error?.message,
        },
      });

      // DEBUG: Also check what's actually in Chrome storage
      try {
        const rawStorageData = await chrome.storage.local.get(['lingua_vocabulary']);
        this.logger?.debug('Raw Chrome storage vocabulary data', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            hasStorageData: !!rawStorageData.lingua_vocabulary,
            storageLength: rawStorageData.lingua_vocabulary?.length || 0,
            storageSample: rawStorageData.lingua_vocabulary?.slice(0, 3) || null,
          },
        });
      } catch (storageError) {
        this.logger?.warn('Failed to check raw storage', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: { error: storageError },
        });
      }

      if (result.success && result.data) {
        const words = Array.isArray(result.data) ? result.data : [];
        this.updateState({ 
          words,
          filteredWords: words,
          isLoading: false, 
          error: null 
        });
        
        // Apply any active filters to the loaded vocabulary
        this.applyFiltersAndSearch();
        
        // COMPREHENSIVE DEBUG: Show what video IDs are in the vocabulary
        const uniqueVideoIds = [...new Set(words.map(w => w.videoId))];
        this.logger?.debug('Unique video IDs in vocabulary', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            uniqueVideoIds,
            currentVideoId: this.getCurrentVideoId(),
            currentFilterMode: this.currentVideoFilter,
          },
        });
        
        this.events.onVocabularyLoaded?.(words);
      } else {
        this.updateState({ 
          words: [],
          filteredWords: [],
          isLoading: false, 
          error: result.error?.message || 'Failed to load vocabulary' 
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.updateState({
        error: errorMsg,
        isLoading: false,
      });
      
      this.logger?.error('Error loading vocabulary', {
        component: ComponentType.VOCABULARY_LIST,
        metadata: {
          error: errorMsg,
        },
      });
    }
  }

  /**
   * Get current video ID from URL for filtering vocabulary by current video
   */
  private getCurrentVideoId(): string | null {
    try {
      const url = new URL(window.location.href);
      const videoId = url.searchParams.get('v');
      this.logger?.debug('Getting current video ID', {
        component: ComponentType.VOCABULARY_LIST,
        metadata: {
          url: window.location.href,
          videoId,
        },
      });
      return videoId;
    } catch (error) {
      this.logger?.warn('Failed to parse URL for video ID', {
        component: ComponentType.VOCABULARY_LIST,
        metadata: {
          url: window.location.href,
          error: String(error),
        },
      });
      return null;
    }
  }

  private filterAndSort(): void {
    let filtered = [...this.state.words];

    // Apply search filter
    if (this.state.searchQuery) {
      const query = this.state.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (word) =>
          word.word.toLowerCase().includes(query) ||
          word.translation.toLowerCase().includes(query) ||
          word.context?.toLowerCase().includes(query),
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;

      switch (this.state.sortBy) {
        case 'word':
          aValue = a.word.toLowerCase();
          bValue = b.word.toLowerCase();
          break;
        case 'translation':
          aValue = a.translation.toLowerCase();
          bValue = b.translation.toLowerCase();
          break;
        case 'dateAdded':
          aValue = a.createdAt;
          bValue = b.createdAt;
          break;
        case 'reviewCount':
          aValue = a.reviewCount || 0;
          bValue = b.reviewCount || 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return this.state.sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return this.state.sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    this.updateState({ filteredWords: filtered });
    
    // REAL FINAL FIX: Only update the results list, don't destroy the search input
    this.renderResultsOnly();
  }

  private updateState(updates: Partial<ListState>): void {
    this.state = { ...this.state, ...updates };
  }

  private render(): void {
    if (!this.shadowRoot) return;

    const existingContainer = this.shadowRoot.querySelector('.vocabulary-list-container');
    
    if (existingContainer) {
      // ULTIMATE FIX: Preserve search input by only updating non-input areas
      const existingSearchInput = existingContainer.querySelector('.search-input') as HTMLInputElement;
      const searchValue = existingSearchInput?.value || '';
      const isFocused = existingSearchInput && document.activeElement === existingSearchInput;
      const cursorPos = isFocused ? existingSearchInput.selectionStart : null;

      // Update the container content
      existingContainer.innerHTML = this.renderContent();
      
      // CRITICAL FIX: Reset event listeners flag since DOM was rebuilt
      this.eventListenersAttached = false;
      
      // Restore search input state if it existed
      if (existingSearchInput && searchValue) {
        const newSearchInput = existingContainer.querySelector('.search-input') as HTMLInputElement;
        if (newSearchInput) {
          newSearchInput.value = searchValue;
          if (isFocused) {
            newSearchInput.focus();
            if (cursorPos !== null) {
              newSearchInput.setSelectionRange(cursorPos, cursorPos);
            }
          }
        }
      }
      
      this.attachEventHandlers();
    } else {
      // Create the container if it doesn't exist
      const containerDiv = document.createElement('div');
      containerDiv.className = 'vocabulary-list-container';
      containerDiv.setAttribute('tabindex', '0'); // CRITICAL FIX: Make focusable for keyboard navigation
      containerDiv.innerHTML = this.renderContent();
      this.shadowRoot.appendChild(containerDiv);
      this.attachEventHandlers();
    }
  }

  private renderContent(): string {
    return `
      ${this.renderHeader()}
      ${this.config.enableSearch ? this.renderSearch() : ''}
      ${this.renderControls()}
      ${this.renderList()}
      ${this.renderBulkActions()}
    `;
  }

  private renderHeader(): string {
    const totalWords = this.state.words.length;
    const filteredWords = this.state.filteredWords.length;
    const selectedCount = this.state.selectedWords.size;
    const isFilteredByVideo = this.currentVideoFilter === 'current';

    return `
      <div class="vocabulary-header">
        <h3 class="vocabulary-title">
          <span class="drag-handle" title="Drag to move">⋮⋮</span>
          Vocabulary List${isFilteredByVideo ? ' - Current Video' : ''}
          <span class="vocabulary-stats">
            ${filteredWords}${totalWords !== filteredWords ? ` of ${totalWords}` : ''} words
            ${selectedCount > 0 ? ` • ${selectedCount} selected` : ''}
            ${isFilteredByVideo ? ' • 📺' : ''}
          </span>
          <button class="close-button" data-action="close" title="Close (you can reopen from playback controls)">×</button>
        </h3>
        ${this.config.showProgress ? this.renderProgress() : ''}
      </div>
    `;
  }

  private renderProgress(): string {
    const reviewedWords = this.state.words.filter((w) => (w.reviewCount || 0) > 0).length;
    const totalWords = this.state.words.length;
    const percentage = totalWords > 0 ? (reviewedWords / totalWords) * 100 : 0;

    return `
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${percentage}%"></div>
      </div>
    `;
  }

  private renderControls(): string {
    if (
      !this.config.enableSearch &&
      !this.config.enableFilters &&
      !this.config.enableSorting &&
      !this.config.enableImport &&
      !this.config.enableExport
    ) {
      return '';
    }

    return `
      <div class="vocabulary-controls">
        <div class="controls-toggle" data-action="toggle-controls">
          <span class="controls-toggle-text">Options</span>
          <span class="controls-toggle-icon ${this.controlsCollapsed ? '' : 'expanded'}">▼</span>
        </div>
        <div class="controls-content ${this.controlsCollapsed ? 'collapsed' : ''}">
          ${this.config.enableFilters || this.config.enableSorting ? `
            <div class="controls-row">
              ${this.config.enableFilters ? this.renderVideoFilter() : ''}
              ${this.config.enableSorting ? this.renderSortControls() : ''}
            </div>
          ` : ''}
          ${this.config.enableImport || this.config.enableExport ? `
            <div class="controls-row">
              ${this.renderImportExport()}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderSearch(): string {
    return `
      <div class="search-container">
        <input 
          type="text" 
          class="search-input" 
          placeholder="Search vocabulary..."
          value="${this.state.searchQuery}"
        >
        <span class="search-icon">🔍</span>
      </div>
    `;
  }

  private renderVideoFilter(): string {
    const currentVideoId = this.getCurrentVideoId();
    const hasCurrentVideo = !!currentVideoId;

    return `
      <div class="filter-container">
        <label class="filter-label">Show:</label>
        <select class="filter-select" data-action="filter-by-video">
          <option value="all" ${this.currentVideoFilter === 'all' ? 'selected' : ''}>All Videos</option>
          <option value="current" ${this.currentVideoFilter === 'current' ? 'selected' : ''} ${!hasCurrentVideo ? 'disabled' : ''}>Current Video Only</option>
        </select>
      </div>
    `;
  }

  private renderSortControls(): string {
    const sortOptions = [
      { value: 'dateAdded', label: 'Date Added' },
      { value: 'word', label: 'Word' },
      { value: 'translation', label: 'Translation' },
      { value: 'reviewCount', label: 'Review Count' },
    ];

    return `
      <div class="filter-container">
        <label class="filter-label">Sort:</label>
        <select class="filter-select sort-select">
          ${sortOptions
            .map(
              (option) => `
            <option value="${option.value}" ${option.value === this.state.sortBy ? 'selected' : ''}>
              ${option.label}
            </option>
          `,
            )
            .join('')}
        </select>
        <button class="sort-button" data-action="toggle-sort-order" title="Toggle sort direction">
          ${this.state.sortOrder === 'asc' ? '↑' : '↓'}
        </button>
      </div>
    `;
  }

  private renderImportExport(): string {
    return `
      <div class="import-export-container">
        ${
          this.config.enableImport
            ? `
          <div class="format-dropdown">
            <button class="import-button" data-action="show-import-menu">
              📥 Import
            </button>
            <div class="format-menu" id="import-menu">
              <div class="format-option" data-action="import" data-format="json">JSON</div>
              <div class="format-option" data-action="import" data-format="csv">CSV</div>
              <div class="format-option" data-action="import" data-format="anki">Anki</div>
            </div>
            <input type="file" class="file-input" id="import-file-input" accept=".json,.csv,.txt">
          </div>
        `
            : ''
        }
        ${
          this.config.enableExport
            ? `
          <div class="format-dropdown">
            <button class="export-button" data-action="show-export-menu">
              📤 Export
            </button>
            <div class="format-menu" id="export-menu">
              <div class="format-option" data-action="export" data-format="json">JSON</div>
              <div class="format-option" data-action="export" data-format="csv">CSV</div>
              <div class="format-option" data-action="export" data-format="anki">Anki</div>
            </div>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  private renderList(): string {
    if (this.state.isLoading) {
      return '<div class="loading-state">Loading vocabulary...</div>';
    }

    if (this.state.error) {
      return `<div class="error-state">${this.state.error}</div>`;
    }

    if (this.state.filteredWords.length === 0) {
      const currentVideoId = this.getCurrentVideoId();
      const isFilteredByVideo = !!currentVideoId;
      
      return `
        <div class="empty-state">
          ${this.state.searchQuery 
            ? 'No words match your search.' 
            : isFilteredByVideo 
              ? 'No vocabulary words found for this video.<br>Words will appear here as you add them.' 
              : 'No vocabulary words yet.<br>Start learning to see your saved words here.'
          }
        </div>
      `;
    }

    const startIndex = this.config.enableVirtualScrolling ? this.visibleRange.start : 0;
    const endIndex = this.config.enableVirtualScrolling
      ? Math.min(this.visibleRange.end, this.state.filteredWords.length)
      : this.state.filteredWords.length;

    const visibleWords = this.state.filteredWords.slice(startIndex, endIndex);

    return `
      <div class="vocabulary-list" style="height: ${this.config.maxHeight}px">
        ${visibleWords.map((word, index) => this.renderListItem(word, startIndex + index)).join('')}
      </div>
    `;
  }

  private renderListItem(word: VocabularyItem, index: number): string {
    const isSelected = this.state.selectedWords.has(word.id);
    const dateAdded = new Date(word.createdAt).toLocaleDateString();

    return `
      <div class="list-item ${isSelected ? 'selected' : ''}" data-word-id="${word.id}">
        ${
          this.config.enableBulkActions
            ? `
          <input 
            type="checkbox" 
            class="item-checkbox" 
            ${isSelected ? 'checked' : ''}
            data-word-id="${word.id}"
          >
        `
            : ''
        }
        <div class="item-content">
          <div class="item-word" 
               data-action="navigate" 
               data-word-id="${word.id}"
               title="Click to jump to subtitle">
            ${this.escapeHtml(word.word)}
          </div>
          <div class="item-translation">${this.escapeHtml(word.translation)}</div>
          <div class="item-meta">
            <span>Added: ${dateAdded}</span>
            <span>Reviews: ${word.reviewCount || 0}</span>
            ${word.difficulty ? `<span>Difficulty: ${word.difficulty}</span>` : ''}
          </div>
        </div>
        <div class="item-actions">
          <button class="action-button" data-action="edit" data-word-id="${word.id}">
            Edit
          </button>
          <button class="action-button danger" data-action="delete" data-word-id="${word.id}">
            Delete
          </button>
        </div>
      </div>
    `;
  }

  private renderBulkActions(): string {
    if (!this.config.enableBulkActions || this.state.selectedWords.size === 0) {
      return '<div class="bulk-actions"></div>';
    }

    return `
      <div class="bulk-actions visible">
        <span>${this.state.selectedWords.size} words selected</span>
        <button class="action-button" data-action="bulk-delete">Delete Selected</button>
        <button class="action-button" data-action="bulk-export">Export Selected</button>
        <button class="action-button" data-action="clear-selection">Clear Selection</button>
      </div>
    `;
  }

  private attachEventHandlers(): void {
    if (this.eventListenersAttached) return; // Prevent multiple attachments

    if (!this.shadowRoot) return;

    // Search input
    const searchInput = this.shadowRoot.querySelector('.search-input') as HTMLInputElement;
    this.logger?.debug('Search input found:', {
      component: ComponentType.VOCABULARY_LIST,
      metadata: {
        searchInput: !!searchInput,
      },
    });
      
    if (searchInput) {
      this.logger?.debug('Adding search input listener', {
        component: ComponentType.VOCABULARY_LIST,
        metadata: {
          searchInput: !!searchInput,
        },
      });
      searchInput.addEventListener('input', (e) => {
        const query = (e.target as HTMLInputElement).value;
        this.logger?.debug('Search input changed:', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            searchInput: query,
          },
        });
        this.search(query);
      });
    } else {
      this.logger?.warn('Search input not found in shadow DOM', {
        component: ComponentType.VOCABULARY_LIST,
        metadata: {
          searchInput: !!searchInput,
        },
      });
    }

    // Unified change event handler for all selects
    this.shadowRoot.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      
      // Sort controls
      if (target.classList.contains('sort-select')) {
        this.logger?.debug('Sort changed to:', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            sort: target.value,
          },
        });
        this.sort(target.value, this.state.sortOrder);
      }
      
      // Video filter
      if (target.hasAttribute('data-action') && target.getAttribute('data-action') === 'filter-by-video') {
        const selectedFilter = target.value as 'all' | 'current';
        this.logger?.debug('Video filter changed to:', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            videoFilter: selectedFilter,
          },
        });
        this.setVideoFilter(selectedFilter);
      }
    });

    // Action buttons
    this.shadowRoot.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const actionElement = target.closest('[data-action]') as HTMLElement;
      const action = actionElement?.getAttribute('data-action');
      const wordId = actionElement?.getAttribute('data-word-id');
      const format = actionElement?.getAttribute('data-format') as 'json' | 'csv' | 'anki';
      
      this.logger?.debug('Click detected:', {
        component: ComponentType.VOCABULARY_LIST,
        metadata: {
          target: target.tagName,
          action,
          hasActionElement: !!actionElement,
        },
      });

      // REAL FIX: Handle actions that don't need wordId
      if (action === 'close') {
        this.handleAction('close', ''); // Close doesn't need wordId
      } else if (action === 'toggle-controls') {
        this.handleAction('toggle-controls', ''); // Toggle controls doesn't need wordId
      } else if (action && wordId) {
        this.handleAction(action, wordId);
      } else if (action === 'import' && format) {
        this.handleImport(format);
      } else if (action === 'export' && format) {
        this.handleExport(format);
      } else if (action === 'show-import-menu') {
        this.toggleMenu('import-menu');
      } else if (action === 'show-export-menu') {
        this.toggleMenu('export-menu');
      } else if (action) {
        this.handleBulkAction(action);
      }
    });

    // Checkbox selection
    this.shadowRoot.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.type === 'checkbox' && target.classList.contains('item-checkbox')) {
        const wordId = target.getAttribute('data-word-id');
        if (wordId) {
          this.toggleSelection(wordId, target.checked);
        }
      }
    });

    // CRITICAL FIX: Add keyboard navigation support
    this.shadowRoot.addEventListener('keydown', (e) => {
      this.handleKeyboardNavigation(e as KeyboardEvent);
    });

    this.eventListenersAttached = true; // Mark as attached
  }

  private handleAction(action: string, wordId: string): void {
    const word = this.state.words.find((w) => w.id === wordId);
    
    switch (action) {
      case 'close':
        // Emit close event for the manager to handle
        this.events.onWordSelect?.({ id: 'close', word: 'close' } as any);
        break;
      case 'navigate':
        if (word) {
          this.logger?.info('Vocabulary word clicked for navigation', {
            component: ComponentType.VOCABULARY_LIST,
            metadata: {
              word: word.word,
              wordId: word.id,
              videoId: word.videoId,
              timestamp: word.timestamp,
            },
          });
          this.events.onWordNavigate?.(word);
        }
        break;
      case 'edit':
        if (word) this.events.onWordEdit?.(word);
        break;
      case 'delete':
        if (word) this.events.onWordDelete?.(word);
        break;
      case 'toggle-sort-order':
        this.sort(this.state.sortBy, this.state.sortOrder === 'asc' ? 'desc' : 'asc');
        break;
      case 'toggle-controls':
        this.toggleControls();
        break;
    }
  }

  private handleBulkAction(action: string): void {
    const selectedWords = this.getSelectedWords();

    switch (action) {
      case 'bulk-delete':
      case 'bulk-export':
        this.events.onBulkAction?.(action, selectedWords);
        break;
      case 'clear-selection':
        this.clearSelection();
        this.render();
        break;
    }
  }

  private toggleSelection(wordId: string, selected: boolean): void {
    const newSelection = new Set(this.state.selectedWords);
    if (selected) {
      newSelection.add(wordId);
    } else {
      newSelection.delete(wordId);
    }
    this.updateState({ selectedWords: newSelection });
    this.render();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private toggleMenu(menuId: string): void {
    if (!this.shadowRoot) return;

    // Close all menus first
    const allMenus = this.shadowRoot.querySelectorAll('.format-menu');
    allMenus.forEach((menu) => menu.classList.remove('show'));

    // Open the requested menu
    const menu = this.shadowRoot.getElementById(menuId);
    if (menu) {
      menu.classList.add('show');
    }

    // Close menu when clicking outside
    const closeMenus = (e: Event) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.format-dropdown')) {
        allMenus.forEach((menu) => menu.classList.remove('show'));
        document.removeEventListener('click', closeMenus);
      }
    };

    setTimeout(() => {
      document.addEventListener('click', closeMenus);
    }, 0);
  }

  private async handleImport(format: 'json' | 'csv' | 'anki'): Promise<void> {
    if (!this.shadowRoot) return;

    const fileInput = this.shadowRoot.getElementById('import-file-input') as HTMLInputElement;
    if (!fileInput) return;

    fileInput.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const result = await this.vocabularyManager.importVocabulary(text, format);

        let message = '';
        if (result.successful.length > 0) {
          this.logger?.info(`Successfully imported ${result.successful.length} words`, {
            component: ComponentType.VOCABULARY_LIST,
            metadata: {
              importedCount: result.successful.length,
              format: format,
            },
          });
          message += `Successfully imported ${result.successful.length} words.`;
          await this.refresh();
        }

        if (result.failed.length > 0) {
          this.logger?.warn(`Failed to import ${result.failed.length} words`, {
            component: ComponentType.VOCABULARY_LIST,
            metadata: {
              failedCount: result.failed.length,
              format: format,
              failedEntries: result.failed,
            },
          });
          message += ` Failed to import ${result.failed.length} words.`;
        }

        if (message) {
          // Show success/warning message to user
          alert(message);
        }

        // Trigger event for external handling
        this.events.onImportRequest?.(format);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger?.error('Import error', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            error: errorMsg,
            format: format,
          },
        });
        alert(`Import failed: ${errorMsg}`);
      }

      // Reset file input
      fileInput.value = '';
    };

    fileInput.click();
  }

  private async handleExport(format: 'json' | 'csv' | 'anki'): Promise<void> {
    try {
      const result = await this.vocabularyManager.exportVocabulary(format);
      if (result.success && result.data) {
        // Create and trigger download
        const filename = `vocabulary-export.${format === 'anki' ? 'txt' : format}`;
        const mimeType = format === 'json' ? 'application/json' : 
                        format === 'csv' ? 'text/csv' : 'text/plain';
        
        const blob = new Blob([result.data], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        this.logger?.info(`Successfully exported ${this.state.words.length} words`, {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            format: format,
            filename: filename,
            wordCount: this.state.words.length,
          },
        });
      } else {
        this.logger?.error('Export failed', {
          component: ComponentType.VOCABULARY_LIST,
          metadata: {
            error: result.error?.message || 'Unknown error',
            format: format,
          },
        });
      }
    } catch (error) {
      this.logger?.error('Export error', {
        component: ComponentType.VOCABULARY_LIST,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
          format: format,
        },
      });
    }
    
    // Also trigger event for external handling
    this.events.onExportRequest?.(format);
  }

  private renderResultsOnly(): void {
    if (!this.shadowRoot) return;

    // REAL ULTIMATE FIX: Find the existing results list and update ONLY that
    const existingResultsList = this.shadowRoot.querySelector('.vocabulary-list');
    
    if (existingResultsList) {
      // Generate just the list items without the wrapper div
      const listItemsHtml = this.generateListItemsHtml();
      existingResultsList.innerHTML = listItemsHtml;
    } else {
      // First time - need to render everything
      this.render();
    }
  }

  private generateListItemsHtml(): string {
    if (this.state.isLoading) {
      return '<div class="loading-state">Loading vocabulary...</div>';
    }

    if (this.state.error) {
      return `<div class="error-state">${this.state.error}</div>`;
    }

    if (this.state.filteredWords.length === 0) {
      const currentVideoId = this.getCurrentVideoId();
      const isFilteredByVideo = !!currentVideoId;
      
      return `
        <div class="empty-state">
          ${this.state.searchQuery 
            ? 'No words match your search.' 
            : isFilteredByVideo 
              ? 'No vocabulary words found for this video.<br>Words will appear here as you add them.' 
              : 'No vocabulary words yet.<br>Start learning to see your saved words here.'
          }
        </div>
      `;
    }

    const startIndex = this.config.enableVirtualScrolling ? this.visibleRange.start : 0;
    const endIndex = this.config.enableVirtualScrolling
      ? Math.min(this.visibleRange.end, this.state.filteredWords.length)
      : this.state.filteredWords.length;

    const visibleWords = this.state.filteredWords.slice(startIndex, endIndex);

    // Return just the list items, not the wrapper div
    return visibleWords.map((word, index) => this.renderListItem(word, startIndex + index)).join('');
  }
}
