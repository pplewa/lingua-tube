/**
 * LinguaTube Vocabulary Observer System
 * Provides reactive UI updates for vocabulary changes with specialized event handling
 */

import { VocabularyItem, StorageEventType, StorageEvent, storageService } from '../storage';
import { vocabularyManager, VocabularyFilters } from './VocabularyManager';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';

// ========================================
// Vocabulary-Specific Event Types
// ========================================

export enum VocabularyEventType {
  WORD_ADDED = 'WORD_ADDED',
  WORD_REMOVED = 'WORD_REMOVED',
  WORD_UPDATED = 'WORD_UPDATED',
  WORD_REVIEWED = 'WORD_REVIEWED',
  VOCABULARY_CLEARED = 'VOCABULARY_CLEARED',
  VOCABULARY_IMPORTED = 'VOCABULARY_IMPORTED',
  VOCABULARY_EXPORTED = 'VOCABULARY_EXPORTED',
  SEARCH_RESULTS_UPDATED = 'SEARCH_RESULTS_UPDATED',
  STATISTICS_UPDATED = 'STATISTICS_UPDATED',
  HIGHLIGHT_UPDATED = 'HIGHLIGHT_UPDATED',
}

// ========================================
// Event Data Interfaces
// ========================================

export interface VocabularyEventData {
  type: VocabularyEventType;
  timestamp: number;
  source: 'user' | 'system' | 'import' | 'sync';
}

export interface WordEventData extends VocabularyEventData {
  word: VocabularyItem;
  previousWord?: VocabularyItem; // For updates
}

export interface SearchEventData extends VocabularyEventData {
  searchTerm: string;
  filters?: VocabularyFilters;
  results: VocabularyItem[];
  totalCount: number;
}

export interface StatisticsEventData extends VocabularyEventData {
  statistics: {
    total: number;
    byLanguage: Record<string, number>;
    byDifficulty: Record<string, number>;
    byVideo: Record<string, number>;
    averageReviewCount: number;
    recentlyAdded: number;
    needsReview: number;
  };
}

export interface HighlightEventData extends VocabularyEventData {
  elementId: string;
  words: VocabularyItem[];
  highlightedCount: number;
}

export interface BatchEventData extends VocabularyEventData {
  operation: 'import' | 'export' | 'delete' | 'update';
  successful: string[];
  failed: Array<{ id: string; error: string }>;
  totalProcessed: number;
}

export type VocabularyEvent =
  | WordEventData
  | SearchEventData
  | StatisticsEventData
  | HighlightEventData
  | BatchEventData
  | VocabularyEventData;

// ========================================
// Observer Callback Types
// ========================================

export type VocabularyObserverCallback<T extends VocabularyEvent = VocabularyEvent> = (
  event: T,
) => void;

export interface VocabularyObserverCallbacks {
  onWordAdded?: VocabularyObserverCallback<WordEventData>;
  onWordRemoved?: VocabularyObserverCallback<WordEventData>;
  onWordUpdated?: VocabularyObserverCallback<WordEventData>;
  onWordReviewed?: VocabularyObserverCallback<WordEventData>;
  onVocabularyCleared?: VocabularyObserverCallback<VocabularyEventData>;
  onVocabularyImported?: VocabularyObserverCallback<BatchEventData>;
  onVocabularyExported?: VocabularyObserverCallback<BatchEventData>;
  onSearchResultsUpdated?: VocabularyObserverCallback<SearchEventData>;
  onStatisticsUpdated?: VocabularyObserverCallback<StatisticsEventData>;
  onHighlightUpdated?: VocabularyObserverCallback<HighlightEventData>;
  onError?: (error: Error, context?: any) => void;
}

// ========================================
// UI Component Interface
// ========================================

export interface VocabularyUIComponent {
  readonly id: string;
  readonly type: 'list' | 'search' | 'statistics' | 'highlight' | 'popup' | 'settings';
  onVocabularyUpdate?(event: VocabularyEvent): void;
  refresh?(): Promise<void>;
  destroy?(): void;
}

// ========================================
// Main Vocabulary Observer Class
// ========================================

export class VocabularyObserver {
  private static instance: VocabularyObserver | null = null;
  private readonly logger: Logger | null = null;

  private eventListeners = new Map<VocabularyEventType, Set<VocabularyObserverCallback>>();
  private globalCallbacks = new Set<VocabularyObserverCallback>();
  private uiComponents = new Map<string, VocabularyUIComponent>();

  private lastStatisticsUpdate = 0;
  private statisticsCache: StatisticsEventData['statistics'] | null = null;
  private readonly STATISTICS_CACHE_TTL = 30 * 1000; // 30 seconds

  private isInitialized = false;
  private pendingEvents: VocabularyEvent[] = [];

  private constructor() {
    this.logger = Logger.getInstance();
    this.setupStorageEventListeners();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): VocabularyObserver {
    if (!VocabularyObserver.instance) {
      VocabularyObserver.instance = new VocabularyObserver();
    }
    return VocabularyObserver.instance;
  }

  // ========================================
  // Initialization
  // ========================================

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Process any pending events
      const events = [...this.pendingEvents];
      this.pendingEvents = [];

      for (const event of events) {
        this.emitEvent(event);
      }

      // Load initial statistics
      await this.updateStatistics();

      this.isInitialized = true;
      this.logger?.info('Initialized successfully', { component: ComponentType.WORD_LOOKUP });
    } catch (error) {
      this.logger?.error(
        'Initialization failed',
        { component: ComponentType.WORD_LOOKUP },
        error instanceof Error ? error : undefined,
      );
      throw error;
    }
  }

  // ========================================
  // Event Listener Management
  // ========================================

  /**
   * Add event listener for specific vocabulary event type
   */
  public on(eventType: VocabularyEventType, callback: VocabularyObserverCallback): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }

    this.eventListeners.get(eventType)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.eventListeners.get(eventType)?.delete(callback);
    };
  }

  /**
   * Add global event listener for all vocabulary events
   */
  public onAny(callback: VocabularyObserverCallback): () => void {
    this.globalCallbacks.add(callback);

    return () => {
      this.globalCallbacks.delete(callback);
    };
  }

  /**
   * Remove event listener
   */
  public off(eventType: VocabularyEventType, callback?: VocabularyObserverCallback): void {
    if (callback) {
      this.eventListeners.get(eventType)?.delete(callback);
    } else {
      this.eventListeners.delete(eventType);
    }
  }

  /**
   * Add one-time event listener
   */
  public once(eventType: VocabularyEventType, callback: VocabularyObserverCallback): void {
    const unsubscribe = this.on(eventType, (event) => {
      callback(event);
      unsubscribe();
    });
  }

  // ========================================
  // UI Component Management
  // ========================================

  /**
   * Register UI component for automatic updates
   */
  public registerComponent(component: VocabularyUIComponent): () => void {
    this.uiComponents.set(component.id, component);

    // Set up automatic refresh on vocabulary changes
    const unsubscribeCallbacks: (() => void)[] = [];

    if (component.onVocabularyUpdate) {
      unsubscribeCallbacks.push(this.onAny(component.onVocabularyUpdate));
    }

    // Return cleanup function
    return () => {
      this.uiComponents.delete(component.id);
      unsubscribeCallbacks.forEach((unsub) => unsub());
    };
  }

  /**
   * Unregister UI component
   */
  public unregisterComponent(componentId: string): void {
    const component = this.uiComponents.get(componentId);
    if (component && component.destroy) {
      component.destroy();
    }
    this.uiComponents.delete(componentId);
  }

  /**
   * Refresh all registered UI components
   */
  public async refreshAllComponents(): Promise<void> {
    const refreshPromises = Array.from(this.uiComponents.values())
      .filter((component) => component.refresh)
      .map((component) => component.refresh!());

    try {
      await Promise.all(refreshPromises);
    } catch (error) {
      this.logger?.error(
        'Component refresh failed',
        { component: ComponentType.WORD_LOOKUP },
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Refresh specific UI components by type
   */
  public async refreshComponentsByType(type: VocabularyUIComponent['type']): Promise<void> {
    const refreshPromises = Array.from(this.uiComponents.values())
      .filter((component) => component.type === type && component.refresh)
      .map((component) => component.refresh!());

    try {
      await Promise.all(refreshPromises);
    } catch (error) {
      this.logger?.error(
        'Component refresh by type failed',
        {
          component: ComponentType.WORD_LOOKUP,
          metadata: { type },
        },
        error instanceof Error ? error : undefined,
      );
    }
  }

  // ========================================
  // Event Emission
  // ========================================

  /**
   * Emit vocabulary event to all listeners
   */
  public emitEvent(event: VocabularyEvent): void {
    if (!this.isInitialized) {
      this.pendingEvents.push(event);
      return;
    }

    try {
      // Emit to specific event listeners
      const listeners = this.eventListeners.get(event.type);
      
      this.logger?.debug('Emitting vocabulary event', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { 
          eventType: event.type,
          specificListeners: listeners?.size || 0,
          globalListeners: this.globalCallbacks.size,
          registeredComponents: this.uiComponents.size
        },
      });

      if (listeners) {
        listeners.forEach((callback) => {
          try {
            callback(event);
          } catch (error) {
            this.logger?.error(
              'Event listener error',
              {
                component: ComponentType.WORD_LOOKUP,
                metadata: { eventType: event.type },
              },
              error instanceof Error ? error : undefined,
            );
          }
        });
      }

      // Emit to global listeners
      this.globalCallbacks.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          this.logger?.error(
            'Global listener error',
            {
              component: ComponentType.WORD_LOOKUP,
              metadata: { eventType: event.type },
            },
            error instanceof Error ? error : undefined,
          );
        }
      });

      // Update components
      this.notifyComponents(event);
    } catch (error) {
      this.logger?.error(
        'Event emission failed',
        {
          component: ComponentType.WORD_LOOKUP,
          metadata: { eventType: event.type },
        },
        error instanceof Error ? error : undefined,
      );
    }
  }

  // ========================================
  // Convenience Methods for Common Events
  // ========================================

  /**
   * Emit word added event
   */
  public emitWordAdded(word: VocabularyItem, source: VocabularyEventData['source'] = 'user'): void {
    this.logger?.debug('Emitting WORD_ADDED event', {
      component: ComponentType.WORD_LOOKUP,
      metadata: { word: word.word, wordId: word.id, source },
    });

    this.emitEvent({
      type: VocabularyEventType.WORD_ADDED,
      word,
      timestamp: Date.now(),
      source,
    });

    // Trigger statistics update
    this.updateStatisticsAsync();
  }

  /**
   * Emit word removed event
   */
  public emitWordRemoved(
    word: VocabularyItem,
    source: VocabularyEventData['source'] = 'user',
  ): void {
    this.emitEvent({
      type: VocabularyEventType.WORD_REMOVED,
      word,
      timestamp: Date.now(),
      source,
    });

    // Trigger statistics update
    this.updateStatisticsAsync();
  }

  /**
   * Emit word updated event
   */
  public emitWordUpdated(
    word: VocabularyItem,
    previousWord?: VocabularyItem,
    source: VocabularyEventData['source'] = 'user',
  ): void {
    this.emitEvent({
      type: VocabularyEventType.WORD_UPDATED,
      word,
      previousWord,
      timestamp: Date.now(),
      source,
    });
  }

  /**
   * Emit search results updated event
   */
  public emitSearchResults(
    searchTerm: string,
    results: VocabularyItem[],
    filters?: VocabularyFilters,
    source: VocabularyEventData['source'] = 'user',
  ): void {
    this.emitEvent({
      type: VocabularyEventType.SEARCH_RESULTS_UPDATED,
      searchTerm,
      filters,
      results,
      totalCount: results.length,
      timestamp: Date.now(),
      source,
    });
  }

  /**
   * Emit batch operation event
   */
  public emitBatchOperation(
    operation: BatchEventData['operation'],
    successful: string[],
    failed: Array<{ id: string; error: string }>,
    source: VocabularyEventData['source'] = 'user',
  ): void {
    this.emitEvent({
      type:
        operation === 'import'
          ? VocabularyEventType.VOCABULARY_IMPORTED
          : VocabularyEventType.VOCABULARY_EXPORTED,
      operation,
      successful,
      failed,
      totalProcessed: successful.length + failed.length,
      timestamp: Date.now(),
      source,
    });

    // Trigger statistics update for import/delete operations
    if (operation === 'import' || operation === 'delete') {
      this.updateStatisticsAsync();
    }
  }

  // ========================================
  // Statistics Management
  // ========================================

  /**
   * Update vocabulary statistics and emit event
   */
  public async updateStatistics(): Promise<void> {
    try {
      const statistics = await vocabularyManager.getVocabularyStats();

      this.statisticsCache = statistics;
      this.lastStatisticsUpdate = Date.now();

      this.emitEvent({
        type: VocabularyEventType.STATISTICS_UPDATED,
        statistics,
        timestamp: Date.now(),
        source: 'system',
      });
    } catch (error) {
      this.logger?.error(
        'Statistics update failed',
        { component: ComponentType.WORD_LOOKUP },
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Update statistics asynchronously (non-blocking)
   */
  private updateStatisticsAsync(): void {
    const now = Date.now();
    if (now - this.lastStatisticsUpdate < this.STATISTICS_CACHE_TTL) {
      return; // Skip if updated recently
    }

    // Update in background
    this.updateStatistics().catch((error) => {
      this.logger?.error(
        'Async statistics update failed',
        { component: ComponentType.WORD_LOOKUP },
        error instanceof Error ? error : undefined,
      );
    });
  }

  /**
   * Get cached statistics
   */
  public getCachedStatistics(): StatisticsEventData['statistics'] | null {
    const now = Date.now();
    if (now - this.lastStatisticsUpdate > this.STATISTICS_CACHE_TTL) {
      return null; // Cache expired
    }
    return this.statisticsCache;
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private setupStorageEventListeners(): void {
    // Listen to storage events and convert to vocabulary events
    storageService.addEventListener(StorageEventType.VOCABULARY_ADDED, (event) => {
      this.logger?.debug('Storage event received: VOCABULARY_ADDED', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { eventData: event.data },
      });
      
      if (event.data) {
        this.emitWordAdded(event.data as VocabularyItem, 'system');
      }
    });

    storageService.addEventListener(StorageEventType.VOCABULARY_REMOVED, (event) => {
      this.logger?.debug('Storage event received: VOCABULARY_REMOVED', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { eventData: event.data },
      });
      
      if (event.data) {
        this.emitWordRemoved(event.data as VocabularyItem, 'system');
      } else {
        // Vocabulary cleared
        this.emitEvent({
          type: VocabularyEventType.VOCABULARY_CLEARED,
          timestamp: Date.now(),
          source: 'system',
        });
      }
    });

    storageService.addEventListener(StorageEventType.VOCABULARY_UPDATED, (event) => {
      this.logger?.debug('Storage event received: VOCABULARY_UPDATED', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { eventData: event.data },
      });
      
      if (event.data) {
        this.emitWordUpdated(event.data as VocabularyItem, undefined, 'system');
      }
    });
  }

  private notifyComponents(event: VocabularyEvent): void {
    this.uiComponents.forEach((component) => {
      if (component.onVocabularyUpdate) {
        try {
          component.onVocabularyUpdate(event);
        } catch (error) {
          this.logger?.error(
            'Component update failed',
            {
              component: ComponentType.WORD_LOOKUP,
              metadata: { componentId: component.id, eventType: event.type },
            },
            error instanceof Error ? error : undefined,
          );
        }
      }
    });
  }

  // ========================================
  // Cleanup
  // ========================================

  /**
   * Clean up all resources
   */
  public destroy(): void {
    // Clean up all listeners
    this.eventListeners.clear();
    this.globalCallbacks.clear();

    // Clean up all components
    this.uiComponents.forEach((component) => {
      if (component.destroy) {
        component.destroy();
      }
    });
    this.uiComponents.clear();

    // Clear cache
    this.statisticsCache = null;
    this.lastStatisticsUpdate = 0;

    // Clear pending events
    this.pendingEvents = [];

    this.isInitialized = false;
    VocabularyObserver.instance = null;
  }
}

// ========================================
// Convenience Functions and Exports
// ========================================

/**
 * Create a reactive vocabulary component wrapper
 */
export function createReactiveVocabularyComponent<T extends VocabularyUIComponent>(
  component: T,
  callbacks?: Partial<VocabularyObserverCallbacks>,
): T & { unsubscribe: () => void } {
  const observer = VocabularyObserver.getInstance();
  const unsubscribeFunctions: (() => void)[] = [];

  // Register component
  unsubscribeFunctions.push(observer.registerComponent(component));

  // Set up specific callbacks
  if (callbacks) {
    Object.entries(callbacks).forEach(([eventName, callback]) => {
      if (callback && typeof callback === 'function') {
        const eventType = eventName
          .replace('on', '')
          .replace(/([A-Z])/g, '_$1')
          .toUpperCase() as VocabularyEventType;
        if (Object.values(VocabularyEventType).includes(eventType)) {
          unsubscribeFunctions.push(observer.on(eventType, callback as any));
        }
      }
    });
  }

  // Return enhanced component with cleanup
  return {
    ...component,
    unsubscribe: () => {
      unsubscribeFunctions.forEach((unsub) => unsub());
    },
  };
}

// Export singleton instance
export const vocabularyObserver = VocabularyObserver.getInstance();
