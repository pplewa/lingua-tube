/**
 * Vocabulary List Component for LinguaTube
 * Provides a comprehensive UI for displaying, searching, and managing vocabulary words
 */

import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { VocabularyObserver, VocabularyEventType } from '../vocabulary/VocabularyObserver';
import { VocabularyItem } from '../storage/types';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';

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
  onBulkAction: (action: string, words: VocabularyItem[]) => void;
  onSearchChange: (query: string) => void;
  onFilterChange: (filters: any) => void;
  onImportRequest: (format: 'json' | 'csv' | 'anki') => void;
  onExportRequest: (format: 'json' | 'csv' | 'anki') => void;
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
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .search-container {
    position: relative;
    flex: 1;
    min-width: 200px;
  }

  .search-input {
    width: 100%;
    padding: 8px 12px 8px 36px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 14px;
    background: #ffffff;
    transition: border-color 0.2s;
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

  @media (max-width: 768px) {
    .vocabulary-controls {
      flex-direction: column;
      align-items: stretch;
    }
    
    .search-container {
      min-width: auto;
    }
    
    .item-meta {
      flex-direction: column;
      gap: 4px;
    }
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

  private state: ListState = {
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

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private virtualScrollOffset = 0;
  private visibleRange = { start: 0, end: 0 };

  constructor(config: Partial<VocabularyListConfig> = {}) {
    this.config = { ...DEFAULT_LIST_CONFIG, ...config };
    this.vocabularyManager = VocabularyManager.getInstance();
    this.vocabularyObserver = VocabularyObserver.getInstance();

    this.setupEventListeners();
  }

  // ========================================
  // Public API
  // ========================================

  public async initialize(container: HTMLElement): Promise<void> {
    this.container = container;
    this.createShadowDOM();
    this.render();
    await this.loadVocabulary();
  }

  public async refresh(): Promise<void> {
    await this.loadVocabulary();
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
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    this.searchTimeout = setTimeout(() => {
      this.updateState({ searchQuery: query, currentPage: 0 });
      this.filterAndSort();
      this.events.onSearchChange?.(query);
    }, this.config.searchDebounceMs);
  }

  public sort(sortBy: string, sortOrder: 'asc' | 'desc' = 'asc'): void {
    this.updateState({ sortBy, sortOrder });
    this.filterAndSort();
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
        component: ComponentType.WORD_LOOKUP,
        action: 'vocabulary_load_start',
      });

      const result = await this.vocabularyManager.getVocabulary();
      
      this.logger?.debug('Vocabulary manager returned result', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          success: result.success,
          hasData: !!result.data,
          dataLength: result.data?.length || 0,
          error: result.error?.message,
        },
      });

      if (result.success && result.data) {
        this.updateState({
          words: result.data,
          isLoading: false,
        });
        
        this.filterAndSort();
        
        this.logger?.debug('Vocabulary loaded successfully', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            wordCount: this.state.words.length,
          },
        });
      } else {
        const errorMsg = result.error?.message || 'Failed to load vocabulary';
        this.updateState({
          error: errorMsg,
          isLoading: false,
        });
        
        this.logger?.warn('Failed to load vocabulary', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            error: errorMsg,
          },
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.updateState({
        error: errorMsg,
        isLoading: false,
      });
      
      this.logger?.error('Error loading vocabulary', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: errorMsg,
        },
      });
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
      containerDiv.innerHTML = this.renderContent();
      this.shadowRoot.appendChild(containerDiv);
      this.attachEventHandlers();
    }
  }

  private renderContent(): string {
    return `
      ${this.renderHeader()}
      ${this.renderControls()}
      ${this.renderList()}
      ${this.renderBulkActions()}
    `;
  }

  private renderHeader(): string {
    const totalWords = this.state.words.length;
    const filteredWords = this.state.filteredWords.length;
    const selectedCount = this.state.selectedWords.size;

    return `
      <div class="vocabulary-header">
        <h3 class="vocabulary-title">
          <span class="drag-handle" title="Drag to move">⋮⋮</span>
          Vocabulary List
          <span class="vocabulary-stats">
            ${filteredWords}${totalWords !== filteredWords ? ` of ${totalWords}` : ''} words
            ${selectedCount > 0 ? ` • ${selectedCount} selected` : ''}
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
        ${this.config.enableSearch ? this.renderSearch() : ''}
        ${this.config.enableSorting ? this.renderSortControls() : ''}
        ${this.config.enableImport || this.config.enableExport ? this.renderImportExport() : ''}
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

  private renderSortControls(): string {
    const sortOptions = [
      { value: 'dateAdded', label: 'Date Added' },
      { value: 'word', label: 'Word' },
      { value: 'translation', label: 'Translation' },
      { value: 'reviewCount', label: 'Review Count' },
    ];

    return `
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
      <button class="sort-button" data-action="toggle-sort-order">
        ${this.state.sortOrder === 'asc' ? '↑' : '↓'}
      </button>
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
      return `
        <div class="empty-state">
          ${this.state.searchQuery ? 'No words match your search.' : 'No vocabulary words yet.'}
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
          <div class="item-word">${this.escapeHtml(word.word)}</div>
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
    if (!this.shadowRoot) return;

    // Search input
    const searchInput = this.shadowRoot.querySelector('.search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.search((e.target as HTMLInputElement).value);
      });
    }

    // Sort controls
    const sortSelect = this.shadowRoot.querySelector('.sort-select') as HTMLSelectElement;
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this.sort((e.target as HTMLSelectElement).value, this.state.sortOrder);
      });
    }

    // Action buttons
    this.shadowRoot.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const action = target.getAttribute('data-action');
      const wordId = target.getAttribute('data-word-id');
      const format = target.getAttribute('data-format') as 'json' | 'csv' | 'anki';

      // REAL FIX: Handle close action separately without requiring wordId
      if (action === 'close') {
        this.handleAction('close', ''); // Close doesn't need wordId
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
  }

  private handleAction(action: string, wordId: string): void {
    const word = this.state.words.find((w) => w.id === wordId);
    
    switch (action) {
      case 'close':
        // Emit close event for the manager to handle
        this.events.onWordSelect?.({ id: 'close', word: 'close' } as any);
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
            component: ComponentType.WORD_LOOKUP,
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
            component: ComponentType.WORD_LOOKUP,
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
          component: ComponentType.WORD_LOOKUP,
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
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            format: format,
            filename: filename,
            wordCount: this.state.words.length,
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
      this.logger?.error('Export error', {
        component: ComponentType.WORD_LOOKUP,
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
      return `
        <div class="empty-state">
          ${this.state.searchQuery ? 'No words match your search.' : 'No vocabulary words yet.'}
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
