/**
 * LinguaTube Vocabulary Manager
 * Enhanced vocabulary management with search, filtering, and batch operations
 */

import { VocabularyItem, StorageResult, StorageEventType, storageService } from '../storage';

/**
 * Vocabulary search and filter options
 */
export interface VocabularyFilters {
  searchTerm?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  difficulty?: VocabularyItem['difficulty'];
  learningStatus?: VocabularyItem['learningStatus'];
  tags?: string[];
  videoId?: string;
  dateRange?: {
    start: number;
    end: number;
  };
  reviewCountRange?: {
    min: number;
    max: number;
  };
  frequencyRange?: {
    min: number;
    max: number;
  };
}

/**
 * Vocabulary sorting options
 */
export interface VocabularySortOptions {
  field:
    | 'word'
    | 'translation'
    | 'createdAt'
    | 'lastReviewed'
    | 'reviewCount'
    | 'difficulty'
    | 'learningStatus'
    | 'frequency'
    | 'lastModified';
  direction: 'asc' | 'desc';
}

/**
 * Batch operation result
 */
export interface BatchOperationResult {
  successful: string[];
  failed: Array<{ id: string; error: string }>;
  totalProcessed: number;
}

/**
 * Word highlighting configuration
 */
export interface HighlightConfig {
  color: string;
  backgroundColor?: string;
  className?: string;
  caseSensitive?: boolean;
}

/**
 * Enhanced vocabulary management service
 */
export class VocabularyManager {
  private static instance: VocabularyManager | null = null;
  private vocabularyCache: VocabularyItem[] = [];
  private lastCacheUpdate = 0;
  private readonly CACHE_TTL = 0; // no cache

  private constructor() {
    this.setupEventListeners();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): VocabularyManager {
    if (!VocabularyManager.instance) {
      VocabularyManager.instance = new VocabularyManager();
    }
    return VocabularyManager.instance;
  }

  // ========================================
  // Enhanced CRUD Operations
  // ========================================

  /**
   * Save a word with automatic duplicate handling and context enrichment
   */
  async saveWord(
    word: string,
    translation: string,
    context: string,
    options: {
      sourceLanguage: string;
      targetLanguage: string;
      videoId?: string;
      videoTitle?: string;
      timestamp?: number;
      difficulty?: VocabularyItem['difficulty'];
    },
  ): Promise<StorageResult<VocabularyItem>> {
    const vocabularyItem: Omit<VocabularyItem, 'id' | 'createdAt'> = {
      word: word.trim(),
      translation: translation.trim(),
      context: context.trim(),
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      videoId: options.videoId,
      videoTitle: options.videoTitle,
      timestamp: options.timestamp || Date.now(),
      reviewCount: 0,
      difficulty: options.difficulty,
    };

    return await storageService.saveWord(vocabularyItem);
  }

  /**
   * Check if a word is already saved
   */
  async isWordSaved(word: string, sourceLanguage: string): Promise<boolean> {
    const vocabulary = await this.getVocabularyCached();
    return vocabulary.some(
      (item) =>
        item.word.toLowerCase() === word.toLowerCase() && item.sourceLanguage === sourceLanguage,
    );
  }

  /**
   * Get vocabulary with optional filtering and sorting
   */
  async getVocabulary(
    filters?: VocabularyFilters,
    sort?: VocabularySortOptions,
  ): Promise<StorageResult<VocabularyItem[]>> {
    try {
      const vocabulary = await this.getVocabularyCached();
      let filteredVocabulary = this.applyFilters(vocabulary, filters);

      if (sort) {
        filteredVocabulary = this.applySorting(filteredVocabulary, sort);
      }

      return {
        success: true,
        data: filteredVocabulary,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR' as any,
          message: 'Failed to get vocabulary',
          details: { error },
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Search vocabulary with fuzzy matching
   */
  async searchVocabulary(
    searchTerm: string,
    options: {
      fuzzy?: boolean;
      fields?: Array<keyof VocabularyItem>;
      limit?: number;
    } = {},
  ): Promise<StorageResult<VocabularyItem[]>> {
    try {
      const vocabulary = await this.getVocabularyCached();
      const { fuzzy = false, fields = ['word', 'translation', 'context'], limit = 50 } = options;

      const searchResults = vocabulary
        .filter((item) => {
          return fields.some((field) => {
            const fieldValue = item[field];
            if (typeof fieldValue !== 'string') return false;

            if (fuzzy) {
              return this.fuzzyMatch(searchTerm.toLowerCase(), fieldValue.toLowerCase());
            } else {
              return fieldValue.toLowerCase().includes(searchTerm.toLowerCase());
            }
          });
        })
        .slice(0, limit);

      return {
        success: true,
        data: searchResults,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR' as any,
          message: 'Failed to search vocabulary',
          details: { error },
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };
    }
  }

  // ========================================
  // Batch Operations
  // ========================================

  /**
   * Remove multiple words by IDs
   */
  async removeWords(ids: string[]): Promise<BatchOperationResult> {
    const result: BatchOperationResult = {
      successful: [],
      failed: [],
      totalProcessed: ids.length,
    };

    for (const id of ids) {
      try {
        const removeResult = await storageService.removeWord(id);
        if (removeResult.success) {
          result.successful.push(id);
        } else {
          result.failed.push({
            id,
            error: removeResult.error?.message || 'Unknown error',
          });
        }
      } catch (error) {
        result.failed.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Update multiple words with the same changes
   */
  async updateWords(
    ids: string[],
    updates: Partial<VocabularyItem>,
  ): Promise<BatchOperationResult> {
    const result: BatchOperationResult = {
      successful: [],
      failed: [],
      totalProcessed: ids.length,
    };

    for (const id of ids) {
      try {
        const updateResult = await storageService.updateWord(id, updates);
        if (updateResult.success) {
          result.successful.push(id);
        } else {
          result.failed.push({
            id,
            error: updateResult.error?.message || 'Unknown error',
          });
        }
      } catch (error) {
        result.failed.push({
          id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return result;
  }

  /**
   * Import vocabulary from various formats
   */
  async importVocabulary(
    data: string,
    format: 'json' | 'csv' | 'anki',
  ): Promise<BatchOperationResult> {
    try {
      let vocabularyItems: Omit<VocabularyItem, 'id' | 'createdAt'>[];

      switch (format) {
        case 'json':
          vocabularyItems = this.parseJsonImport(data);
          break;
        case 'csv':
          vocabularyItems = this.parseCsvImport(data);
          break;
        case 'anki':
          vocabularyItems = this.parseAnkiImport(data);
          break;
        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      const result: BatchOperationResult = {
        successful: [],
        failed: [],
        totalProcessed: vocabularyItems.length,
      };

      for (const item of vocabularyItems) {
        try {
          const saveResult = await storageService.saveWord(item);
          if (saveResult.success && saveResult.data) {
            result.successful.push(saveResult.data.id);
          } else {
            result.failed.push({
              id: item.word,
              error: saveResult.error?.message || 'Unknown error',
            });
          }
        } catch (error) {
          result.failed.push({
            id: item.word,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return result;
    } catch (error) {
      return {
        successful: [],
        failed: [{ id: 'import', error: error instanceof Error ? error.message : 'Unknown error' }],
        totalProcessed: 0,
      };
    }
  }

  /**
   * Export vocabulary in various formats
   */
  async exportVocabulary(
    format: 'json' | 'csv' | 'anki',
    filters?: VocabularyFilters,
  ): Promise<StorageResult<string>> {
    try {
      const vocabularyResult = await this.getVocabulary(filters);
      if (!vocabularyResult.success || !vocabularyResult.data) {
        return {
          success: false,
          error: vocabularyResult.error || {
            code: 'UNKNOWN_ERROR' as any,
            message: 'Failed to get vocabulary data',
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        };
      }

      const vocabulary = vocabularyResult.data;
      let exportData: string;

      switch (format) {
        case 'json':
          exportData = this.formatJsonExport(vocabulary);
          break;
        case 'csv':
          exportData = this.formatCsvExport(vocabulary);
          break;
        case 'anki':
          exportData = this.formatAnkiExport(vocabulary);
          break;
        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      return {
        success: true,
        data: exportData,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR' as any,
          message: 'Failed to export vocabulary',
          details: { error },
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };
    }
  }

  // ========================================
  // Word Highlighting
  // ========================================

  /**
   * Highlight saved vocabulary words in text
   */
  async highlightVocabularyInText(
    text: string,
    config: HighlightConfig = { color: '#ffeb3b' },
  ): Promise<string> {
    const vocabulary = await this.getVocabularyCached();
    if (vocabulary.length === 0) return text;

    // Create a map for fast lookup
    const wordMap = new Map<string, VocabularyItem>();
    vocabulary.forEach((item) => {
      const key = config.caseSensitive ? item.word : item.word.toLowerCase();
      wordMap.set(key, item);
    });

    // Use regex to find and replace words
    const wordPattern = Array.from(wordMap.keys())
      .sort((a, b) => b.length - a.length) // Sort by length to match longer words first
      .map((word) => this.escapeRegExp(word))
      .join('|');

    if (!wordPattern) return text;

    const regex = new RegExp(`\\b(${wordPattern})\\b`, config.caseSensitive ? 'g' : 'gi');

    return text.replace(regex, (match) => {
      const lookupKey = config.caseSensitive ? match : match.toLowerCase();
      const vocabularyItem = wordMap.get(lookupKey);

      if (!vocabularyItem) return match;

      const className = config.className || 'lingua-vocabulary-highlight';
      const style = this.buildHighlightStyle(config);

      return `<span class="${className}" style="${style}" data-word-id="${vocabularyItem.id}" title="${vocabularyItem.translation}">${match}</span>`;
    });
  }

  /**
   * Get vocabulary words that appear in given text
   */
  async getVocabularyInText(text: string): Promise<VocabularyItem[]> {
    const vocabulary = await this.getVocabularyCached();
    const textLower = text.toLowerCase();

    return vocabulary.filter((item) => textLower.includes(item.word.toLowerCase()));
  }

  // ========================================
  // Statistics and Analytics
  // ========================================

  // ========================================
  // Metadata Management
  // ========================================

  /**
   * Update metadata for a vocabulary item
   */
  async updateMetadata(
    id: string,
    metadata: {
      tags?: string[];
      learningStatus?: VocabularyItem['learningStatus'];
      notes?: string;
      difficulty?: VocabularyItem['difficulty'];
      frequency?: number;
    },
  ): Promise<StorageResult<VocabularyItem>> {
    try {
      const updates: Partial<VocabularyItem> = {
        ...metadata,
        lastModified: Date.now(),
      };

      const result = await storageService.updateWord(id, updates);
      if (result.success) {
        this.invalidateCache();
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR' as any,
          message: 'Failed to update metadata',
          details: { error },
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Add tags to a vocabulary item
   */
  async addTags(id: string, newTags: string[]): Promise<StorageResult<VocabularyItem>> {
    try {
      const vocabulary = await this.getVocabularyCached();
      const item = vocabulary.find((v) => v.id === id);

      if (!item) {
        return {
          success: false,
          error: {
            code: 'INVALID_DATA' as any,
            message: 'Vocabulary item not found',
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        };
      }

      const existingTags = item.tags || [];
      const uniqueTags = [...new Set([...existingTags, ...newTags])];

      return this.updateMetadata(id, { tags: uniqueTags });
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR' as any,
          message: 'Failed to add tags',
          details: { error },
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Remove tags from a vocabulary item
   */
  async removeTags(id: string, tagsToRemove: string[]): Promise<StorageResult<VocabularyItem>> {
    try {
      const vocabulary = await this.getVocabularyCached();
      const item = vocabulary.find((v) => v.id === id);

      if (!item) {
        return {
          success: false,
          error: {
            code: 'INVALID_DATA' as any,
            message: 'Vocabulary item not found',
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        };
      }

      const existingTags = item.tags || [];
      const filteredTags = existingTags.filter((tag) => !tagsToRemove.includes(tag));

      return this.updateMetadata(id, { tags: filteredTags });
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR' as any,
          message: 'Failed to remove tags',
          details: { error },
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Get all unique tags from vocabulary
   */
  async getAllTags(): Promise<string[]> {
    const vocabulary = await this.getVocabularyCached();
    const allTags = vocabulary.flatMap((item) => item.tags || []);
    return [...new Set(allTags)].sort();
  }

  /**
   * Update learning status for a vocabulary item
   */
  async updateLearningStatus(
    id: string,
    status: VocabularyItem['learningStatus'],
  ): Promise<StorageResult<VocabularyItem>> {
    return this.updateMetadata(id, { learningStatus: status });
  }

  /**
   * Update notes for a vocabulary item
   */
  async updateNotes(id: string, notes: string): Promise<StorageResult<VocabularyItem>> {
    return this.updateMetadata(id, { notes });
  }

  /**
   * Increment frequency counter for a vocabulary item
   */
  async incrementFrequency(id: string): Promise<StorageResult<VocabularyItem>> {
    try {
      const vocabulary = await this.getVocabularyCached();
      const item = vocabulary.find((v) => v.id === id);

      if (!item) {
        return {
          success: false,
          error: {
            code: 'INVALID_DATA' as any,
            message: 'Vocabulary item not found',
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        };
      }

      const currentFrequency = item.frequency || 0;
      return this.updateMetadata(id, { frequency: currentFrequency + 1 });
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR' as any,
          message: 'Failed to increment frequency',
          details: { error },
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Get vocabulary statistics including metadata
   */
  async getVocabularyStats(): Promise<{
    total: number;
    byLanguage: Record<string, number>;
    byDifficulty: Record<string, number>;
    byLearningStatus: Record<string, number>;
    byVideo: Record<string, number>;
    averageReviewCount: number;
    recentlyAdded: number; // Last 7 days
    needsReview: number; // Not reviewed in 7+ days
    totalTags: number;
    mostUsedTags: Array<{ tag: string; count: number }>;
    averageFrequency: number;
  }> {
    const vocabulary = await this.getVocabularyCached();
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const stats = {
      total: vocabulary.length,
      byLanguage: {} as Record<string, number>,
      byDifficulty: {} as Record<string, number>,
      byLearningStatus: {} as Record<string, number>,
      byVideo: {} as Record<string, number>,
      averageReviewCount: 0,
      recentlyAdded: 0,
      needsReview: 0,
      totalTags: 0,
      mostUsedTags: [] as Array<{ tag: string; count: number }>,
      averageFrequency: 0,
    };

    let totalReviewCount = 0;
    let totalFrequency = 0;
    const tagCounts = new Map<string, number>();

    for (const item of vocabulary) {
      // By language
      const langPair = `${item.sourceLanguage}-${item.targetLanguage}`;
      stats.byLanguage[langPair] = (stats.byLanguage[langPair] || 0) + 1;

      // By difficulty
      const difficulty = item.difficulty || 'unknown';
      stats.byDifficulty[difficulty] = (stats.byDifficulty[difficulty] || 0) + 1;

      // By learning status
      const learningStatus = item.learningStatus || 'new';
      stats.byLearningStatus[learningStatus] = (stats.byLearningStatus[learningStatus] || 0) + 1;

      // By video
      if (item.videoId) {
        const videoKey = item.videoTitle || item.videoId;
        stats.byVideo[videoKey] = (stats.byVideo[videoKey] || 0) + 1;
      }

      // Review statistics
      totalReviewCount += item.reviewCount;

      // Frequency statistics
      totalFrequency += item.frequency || 0;

      // Tags statistics
      if (item.tags) {
        item.tags.forEach((tag) => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      }

      // Recently added
      if (item.createdAt > sevenDaysAgo) {
        stats.recentlyAdded++;
      }

      // Needs review
      if (!item.lastReviewed || item.lastReviewed < sevenDaysAgo) {
        stats.needsReview++;
      }
    }

    // Calculate averages
    stats.averageReviewCount = vocabulary.length > 0 ? totalReviewCount / vocabulary.length : 0;
    stats.averageFrequency = vocabulary.length > 0 ? totalFrequency / vocabulary.length : 0;

    // Calculate tag statistics
    stats.totalTags = tagCounts.size;
    stats.mostUsedTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 most used tags

    return stats;
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private setupEventListeners(): void {
    storageService.addEventListener(StorageEventType.VOCABULARY_ADDED, () => {
      this.invalidateCache();
    });

    storageService.addEventListener(StorageEventType.VOCABULARY_REMOVED, () => {
      this.invalidateCache();
    });

    storageService.addEventListener(StorageEventType.VOCABULARY_UPDATED, () => {
      this.invalidateCache();
    });
  }

  private async getVocabularyCached(): Promise<VocabularyItem[]> {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.CACHE_TTL) {
      const result = await storageService.getVocabulary();
      if (result.success && result.data) {
        this.vocabularyCache = result.data;
        this.lastCacheUpdate = now;
      }
    }
    return this.vocabularyCache;
  }

  private invalidateCache(): void {
    this.lastCacheUpdate = 0;
  }

  private applyFilters(
    vocabulary: VocabularyItem[],
    filters?: VocabularyFilters,
  ): VocabularyItem[] {
    if (!filters) return vocabulary;

    return vocabulary.filter((item) => {
      // Search term filter
      if (filters.searchTerm) {
        const searchTerm = filters.searchTerm.toLowerCase();
        const searchableText = `${item.word} ${item.translation} ${item.context}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) return false;
      }

      // Language filters
      if (filters.sourceLanguage && item.sourceLanguage !== filters.sourceLanguage) return false;
      if (filters.targetLanguage && item.targetLanguage !== filters.targetLanguage) return false;

      // Difficulty filter
      if (filters.difficulty && item.difficulty !== filters.difficulty) return false;

      // Learning status filter
      if (filters.learningStatus && item.learningStatus !== filters.learningStatus) return false;

      // Tags filter
      if (filters.tags && filters.tags.length > 0) {
        const itemTags = item.tags || [];
        const hasAllTags = filters.tags.every((tag) => itemTags.includes(tag));
        if (!hasAllTags) return false;
      }

      // Video filter
      if (filters.videoId && item.videoId !== filters.videoId) return false;

      // Date range filter
      if (filters.dateRange) {
        if (item.createdAt < filters.dateRange.start || item.createdAt > filters.dateRange.end) {
          return false;
        }
      }

      // Review count filter
      if (filters.reviewCountRange) {
        if (
          item.reviewCount < filters.reviewCountRange.min ||
          item.reviewCount > filters.reviewCountRange.max
        ) {
          return false;
        }
      }

      // Frequency filter
      if (filters.frequencyRange) {
        const frequency = item.frequency || 0;
        if (frequency < filters.frequencyRange.min || frequency > filters.frequencyRange.max) {
          return false;
        }
      }

      return true;
    });
  }

  private applySorting(
    vocabulary: VocabularyItem[],
    sort: VocabularySortOptions,
  ): VocabularyItem[] {
    return [...vocabulary].sort((a, b) => {
      let aValue: any = a[sort.field];
      let bValue: any = b[sort.field];

      // Handle undefined values
      if (aValue === undefined) aValue = sort.field === 'lastReviewed' ? 0 : '';
      if (bValue === undefined) bValue = sort.field === 'lastReviewed' ? 0 : '';

      // Convert to comparable values
      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      let comparison = 0;
      if (aValue < bValue) comparison = -1;
      else if (aValue > bValue) comparison = 1;

      return sort.direction === 'desc' ? -comparison : comparison;
    });
  }

  private fuzzyMatch(search: string, target: string): boolean {
    const searchLen = search.length;
    const targetLen = target.length;

    if (searchLen > targetLen) return false;
    if (searchLen === targetLen) return search === target;

    let searchIndex = 0;
    for (let targetIndex = 0; targetIndex < targetLen && searchIndex < searchLen; targetIndex++) {
      if (search[searchIndex] === target[targetIndex]) {
        searchIndex++;
      }
    }

    return searchIndex === searchLen;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private buildHighlightStyle(config: HighlightConfig): string {
    const styles = [`color: ${config.color}`];

    if (config.backgroundColor) {
      styles.push(`background-color: ${config.backgroundColor}`);
    }

    return styles.join('; ');
  }

  // Import/Export format handlers
  private parseJsonImport(data: string): Omit<VocabularyItem, 'id' | 'createdAt'>[] {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      throw new Error('JSON data must be an array');
    }
    return parsed;
  }

  private parseCsvImport(data: string): Omit<VocabularyItem, 'id' | 'createdAt'>[] {
    const lines = data.split('\n').filter((line) => line.trim());
    const headers = lines[0].split(',').map((h) => h.trim());

    return lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim());
      const item: any = {};

      headers.forEach((header, index) => {
        item[header] = values[index] || '';
      });

      return {
        word: item.word || '',
        translation: item.translation || '',
        context: item.context || '',
        sourceLanguage: item.sourceLanguage || 'en',
        targetLanguage: item.targetLanguage || 'es',
        timestamp: Date.now(),
        reviewCount: 0,
      };
    });
  }

  private parseAnkiImport(data: string): Omit<VocabularyItem, 'id' | 'createdAt'>[] {
    // Anki format: front\tback\ttags
    const lines = data.split('\n').filter((line) => line.trim());

    return lines.map((line) => {
      const parts = line.split('\t');
      return {
        word: parts[0] || '',
        translation: parts[1] || '',
        context: parts[2] || '',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        timestamp: Date.now(),
        reviewCount: 0,
      };
    });
  }

  private formatJsonExport(vocabulary: VocabularyItem[]): string {
    return JSON.stringify(vocabulary, null, 2);
  }

  private formatCsvExport(vocabulary: VocabularyItem[]): string {
    const headers = [
      'word',
      'translation',
      'context',
      'sourceLanguage',
      'targetLanguage',
      'createdAt',
      'reviewCount',
    ];
    const csvLines = [headers.join(',')];

    vocabulary.forEach((item) => {
      const values = headers.map((header) => {
        const value = item[header as keyof VocabularyItem];
        return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
      });
      csvLines.push(values.join(','));
    });

    return csvLines.join('\n');
  }

  private formatAnkiExport(vocabulary: VocabularyItem[]): string {
    return vocabulary
      .map((item) => `${item.word}\t${item.translation}\t${item.context}`)
      .join('\n');
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.vocabularyCache = [];
    this.lastCacheUpdate = 0;
    VocabularyManager.instance = null;
  }
}

// Export singleton instance
export const vocabularyManager = VocabularyManager.getInstance();
