// Translation caching service for Microsoft Translator API integration
// Provides Chrome storage-based caching with TTL, compression, and cache management

import { CacheConfig, TranslationErrorCode, LanguageCode } from './types';
import { configService } from './ConfigService';
import { TranslationErrorImpl } from './TranslationApiService';

// ============================================================================
// Cache Storage Keys
// ============================================================================

const CACHE_STORAGE_KEYS = {
  TRANSLATIONS: 'translator_cache_translations',
  METADATA: 'translator_cache_metadata',
  STATS: 'translator_cache_stats',
} as const;

// ============================================================================
// Cache Types
// ============================================================================

interface CacheEntry {
  text: string;
  translation: string;
  fromLanguage: string;
  toLanguage: string;
  timestamp: number;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
  size: number;
  compressed?: boolean;
}

interface CacheMetadata {
  totalEntries: number;
  totalSize: number;
  lastCleanup: number;
  version: string;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  compressionSavings: number;
  lastReset: number;
}

interface CacheKey {
  text: string;
  fromLanguage: string;
  toLanguage: string;
}

interface CacheLookupResult {
  found: boolean;
  translation?: string;
  entry?: CacheEntry;
}

// ============================================================================
// Translation Cache Service
// ============================================================================

export class TranslationCacheService {
  private config: CacheConfig | null = null;
  private metadata: CacheMetadata | null = null;
  private stats: CacheStats | null = null;
  private lastConfigUpdate: number = 0;
  private cleanupInterval: number | null = null;

  // --------------------------------------------------------------------------
  // Initialization and Configuration
  // --------------------------------------------------------------------------

  /**
   * Initialize the caching service
   */
  async initialize(): Promise<void> {
    try {
      await this.loadConfig();
      await this.loadMetadata();
      await this.loadStats();

      if (this.config?.enabled) {
        this.startPeriodicCleanup();
      }
    } catch (error) {
      throw new TranslationErrorImpl(
        'Failed to initialize translation cache service',
        TranslationErrorCode.CACHE_ERROR,
        { originalError: error },
      );
    }
  }

  /**
   * Load configuration from the config service
   */
  private async loadConfig(): Promise<void> {
    const translationConfig = await configService.getConfig();
    this.config = translationConfig.cacheConfig;
    this.lastConfigUpdate = Date.now();
  }

  /**
   * Load cache metadata
   */
  private async loadMetadata(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([CACHE_STORAGE_KEYS.METADATA]);
      this.metadata = result[CACHE_STORAGE_KEYS.METADATA] || {
        totalEntries: 0,
        totalSize: 0,
        lastCleanup: Date.now(),
        version: '1.0',
      };
    } catch (error) {
      this.metadata = {
        totalEntries: 0,
        totalSize: 0,
        lastCleanup: Date.now(),
        version: '1.0',
      };
    }
  }

  /**
   * Load cache statistics
   */
  private async loadStats(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([CACHE_STORAGE_KEYS.STATS]);
      this.stats = result[CACHE_STORAGE_KEYS.STATS] || {
        hits: 0,
        misses: 0,
        evictions: 0,
        compressionSavings: 0,
        lastReset: Date.now(),
      };
    } catch (error) {
      this.stats = {
        hits: 0,
        misses: 0,
        evictions: 0,
        compressionSavings: 0,
        lastReset: Date.now(),
      };
    }
  }

  // --------------------------------------------------------------------------
  // Cache Operations
  // --------------------------------------------------------------------------

  /**
   * Get translation from cache
   */
  async get(text: string, fromLanguage: string, toLanguage: string): Promise<string | null> {
    await this.ensureInitialized();

    if (!this.config?.enabled) {
      return null;
    }

    try {
      const key = this.generateCacheKey({ text, fromLanguage, toLanguage });
      const result = await this.lookupEntry(key);

      if (result.found && result.entry) {
        // Check if entry is expired
        if (result.entry.expiresAt < Date.now()) {
          await this.removeEntry(key);
          this.stats!.misses++;
          await this.saveStats();
          return null;
        }

        // Update access statistics
        result.entry.accessCount++;
        result.entry.lastAccessed = Date.now();
        await this.updateEntry(key, result.entry);

        this.stats!.hits++;
        await this.saveStats();

        return result.translation!;
      }

      this.stats!.misses++;
      await this.saveStats();
      return null;
    } catch (error) {
      console.warn('Cache lookup failed:', error);
      this.stats!.misses++;
      await this.saveStats();
      return null;
    }
  }

  /**
   * Store translation in cache
   */
  async set(
    text: string,
    translation: string,
    fromLanguage: string,
    toLanguage: string,
  ): Promise<void> {
    await this.ensureInitialized();

    if (!this.config?.enabled) {
      return;
    }

    try {
      const key = this.generateCacheKey({ text, fromLanguage, toLanguage });
      const now = Date.now();

      // Calculate entry size
      const originalSize = this.calculateEntrySize(text, translation);
      let compressedData = translation;
      let isCompressed = false;

      // Apply compression if enabled and beneficial
      if (this.config.compressionEnabled && originalSize > 200) {
        try {
          compressedData = this.compressData(translation);
          const compressedSize = compressedData.length;

          if (compressedSize < originalSize * 0.8) {
            // Only use if significant savings
            isCompressed = true;
            this.stats!.compressionSavings += originalSize - compressedSize;
          } else {
            compressedData = translation;
          }
        } catch (error) {
          console.warn('Compression failed, storing uncompressed:', error);
        }
      }

      const entry: CacheEntry = {
        text,
        translation: compressedData,
        fromLanguage,
        toLanguage,
        timestamp: now,
        expiresAt: now + this.config.ttlHours * 60 * 60 * 1000,
        accessCount: 0,
        lastAccessed: now,
        size: isCompressed ? compressedData.length : originalSize,
        compressed: isCompressed,
      };

      // Check if we need to make space
      await this.ensureSpace(entry.size);

      // Store the entry
      await this.storeEntry(key, entry);
    } catch (error) {
      console.warn('Cache store failed:', error);
      throw new TranslationErrorImpl(
        'Failed to store translation in cache',
        TranslationErrorCode.CACHE_ERROR,
        { originalError: error },
      );
    }
  }

  /**
   * Remove specific entry from cache
   */
  async remove(text: string, fromLanguage: string, toLanguage: string): Promise<void> {
    await this.ensureInitialized();

    if (!this.config?.enabled) {
      return;
    }

    try {
      const key = this.generateCacheKey({ text, fromLanguage, toLanguage });
      await this.removeEntry(key);
    } catch (error) {
      console.warn('Cache removal failed:', error);
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();

    try {
      await chrome.storage.local.remove([CACHE_STORAGE_KEYS.TRANSLATIONS]);

      this.metadata!.totalEntries = 0;
      this.metadata!.totalSize = 0;
      this.metadata!.lastCleanup = Date.now();

      await this.saveMetadata();
    } catch (error) {
      throw new TranslationErrorImpl(
        'Failed to clear translation cache',
        TranslationErrorCode.CACHE_ERROR,
        { originalError: error },
      );
    }
  }

  // --------------------------------------------------------------------------
  // Cache Management
  // --------------------------------------------------------------------------

  /**
   * Ensure there's enough space for a new entry
   */
  private async ensureSpace(newEntrySize: number): Promise<void> {
    if (!this.metadata || !this.config) return;

    const maxSize = 5 * 1024 * 1024; // 5MB default cache size limit
    const maxEntries = this.config.maxEntries;

    // Check if we need to free up space
    if (
      this.metadata.totalSize + newEntrySize > maxSize ||
      this.metadata.totalEntries >= maxEntries
    ) {
      await this.evictEntries(newEntrySize);
    }
  }

  /**
   * Evict cache entries using LRU strategy
   */
  private async evictEntries(spaceNeeded: number): Promise<void> {
    try {
      const result = await chrome.storage.local.get([CACHE_STORAGE_KEYS.TRANSLATIONS]);
      const cache = result[CACHE_STORAGE_KEYS.TRANSLATIONS] || {};

      // Get all entries with their keys
      const entries: Array<{ key: string; entry: CacheEntry }> = [];
      for (const [key, entry] of Object.entries(cache)) {
        entries.push({ key, entry: entry as CacheEntry });
      }

      // Sort by last accessed time (LRU)
      entries.sort((a, b) => a.entry.lastAccessed - b.entry.lastAccessed);

      let freedSpace = 0;
      let evictedCount = 0;

      // Remove oldest entries until we have enough space
      for (const { key, entry } of entries) {
        if (freedSpace >= spaceNeeded && this.metadata!.totalEntries < this.config!.maxEntries) {
          break;
        }

        delete cache[key];
        freedSpace += entry.size;
        evictedCount++;

        this.metadata!.totalEntries--;
        this.metadata!.totalSize -= entry.size;
      }

      // Save updated cache and metadata
      if (evictedCount > 0) {
        await chrome.storage.local.set({
          [CACHE_STORAGE_KEYS.TRANSLATIONS]: cache,
        });

        this.stats!.evictions += evictedCount;
        await this.saveMetadata();
        await this.saveStats();
      }
    } catch (error) {
      console.warn('Cache eviction failed:', error);
    }
  }

  /**
   * Cleanup expired entries
   */
  async cleanup(): Promise<void> {
    await this.ensureInitialized();

    if (!this.config?.enabled) return;

    try {
      const result = await chrome.storage.local.get([CACHE_STORAGE_KEYS.TRANSLATIONS]);
      const cache = result[CACHE_STORAGE_KEYS.TRANSLATIONS] || {};
      const now = Date.now();

      let cleanedCount = 0;
      let freedSize = 0;

      for (const [key, entry] of Object.entries(cache)) {
        const cacheEntry = entry as CacheEntry;

        if (cacheEntry.expiresAt < now) {
          delete cache[key];
          cleanedCount++;
          freedSize += cacheEntry.size;
        }
      }

      if (cleanedCount > 0) {
        await chrome.storage.local.set({
          [CACHE_STORAGE_KEYS.TRANSLATIONS]: cache,
        });

        this.metadata!.totalEntries -= cleanedCount;
        this.metadata!.totalSize -= freedSize;
        this.metadata!.lastCleanup = now;

        await this.saveMetadata();
      }
    } catch (error) {
      console.warn('Cache cleanup failed:', error);
    }
  }

  // --------------------------------------------------------------------------
  // Cache Utilities
  // --------------------------------------------------------------------------

  /**
   * Generate cache key for a translation request
   */
  private generateCacheKey(params: CacheKey): string {
    // Normalize the key components
    const normalizedText = params.text.trim().toLowerCase();
    const normalizedFrom = params.fromLanguage.toLowerCase();
    const normalizedTo = params.toLanguage.toLowerCase();

    // Create a hash-like key (simple implementation)
    return `${normalizedFrom}-${normalizedTo}-${this.hashString(normalizedText)}`;
  }

  /**
   * Simple string hashing function
   */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Lookup cache entry
   */
  private async lookupEntry(key: string): Promise<CacheLookupResult> {
    try {
      const result = await chrome.storage.local.get([CACHE_STORAGE_KEYS.TRANSLATIONS]);
      const cache = result[CACHE_STORAGE_KEYS.TRANSLATIONS] || {};

      if (cache[key]) {
        const entry = cache[key] as CacheEntry;
        let translation = entry.translation;

        // Decompress if necessary
        if (entry.compressed) {
          try {
            translation = this.decompressData(translation);
          } catch (error) {
            console.warn('Decompression failed:', error);
            return { found: false };
          }
        }

        return {
          found: true,
          translation,
          entry,
        };
      }

      return { found: false };
    } catch (error) {
      console.warn('Cache lookup error:', error);
      return { found: false };
    }
  }

  /**
   * Store cache entry
   */
  private async storeEntry(key: string, entry: CacheEntry): Promise<void> {
    const result = await chrome.storage.local.get([CACHE_STORAGE_KEYS.TRANSLATIONS]);
    const cache = result[CACHE_STORAGE_KEYS.TRANSLATIONS] || {};

    // Check if this is an update or new entry
    const isUpdate = !!cache[key];
    const oldSize = isUpdate ? (cache[key] as CacheEntry).size : 0;

    cache[key] = entry;

    await chrome.storage.local.set({
      [CACHE_STORAGE_KEYS.TRANSLATIONS]: cache,
    });

    // Update metadata
    if (!isUpdate) {
      this.metadata!.totalEntries++;
    }
    this.metadata!.totalSize = this.metadata!.totalSize - oldSize + entry.size;

    await this.saveMetadata();
  }

  /**
   * Update existing cache entry
   */
  private async updateEntry(key: string, entry: CacheEntry): Promise<void> {
    await this.storeEntry(key, entry);
  }

  /**
   * Remove cache entry
   */
  private async removeEntry(key: string): Promise<void> {
    try {
      const result = await chrome.storage.local.get([CACHE_STORAGE_KEYS.TRANSLATIONS]);
      const cache = result[CACHE_STORAGE_KEYS.TRANSLATIONS] || {};

      if (cache[key]) {
        const entry = cache[key] as CacheEntry;
        delete cache[key];

        await chrome.storage.local.set({
          [CACHE_STORAGE_KEYS.TRANSLATIONS]: cache,
        });

        this.metadata!.totalEntries--;
        this.metadata!.totalSize -= entry.size;

        await this.saveMetadata();
      }
    } catch (error) {
      console.warn('Cache entry removal failed:', error);
    }
  }

  /**
   * Calculate entry size in bytes
   */
  private calculateEntrySize(text: string, translation: string): number {
    return new Blob([text + translation]).size;
  }

  /**
   * Simple compression using base64 encoding (placeholder for real compression)
   */
  private compressData(data: string): string {
    // In a real implementation, you might use pako or another compression library
    // For now, we'll use a simple approach
    try {
      return btoa(encodeURIComponent(data));
    } catch (error) {
      throw new Error('Compression failed');
    }
  }

  /**
   * Simple decompression
   */
  private decompressData(data: string): string {
    try {
      return decodeURIComponent(atob(data));
    } catch (error) {
      throw new Error('Decompression failed');
    }
  }

  // --------------------------------------------------------------------------
  // Statistics and Monitoring
  // --------------------------------------------------------------------------

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    hits: number;
    misses: number;
    hitRate: number;
    totalEntries: number;
    totalSize: number;
    evictions: number;
    compressionSavings: number;
  }> {
    await this.ensureInitialized();

    const totalRequests = this.stats!.hits + this.stats!.misses;
    const hitRate = totalRequests > 0 ? (this.stats!.hits / totalRequests) * 100 : 0;

    return {
      hits: this.stats!.hits,
      misses: this.stats!.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      totalEntries: this.metadata!.totalEntries,
      totalSize: this.metadata!.totalSize,
      evictions: this.stats!.evictions,
      compressionSavings: this.stats!.compressionSavings,
    };
  }

  /**
   * Reset cache statistics
   */
  async resetStats(): Promise<void> {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      compressionSavings: 0,
      lastReset: Date.now(),
    };
    await this.saveStats();
  }

  // --------------------------------------------------------------------------
  // Storage Management
  // --------------------------------------------------------------------------

  /**
   * Save metadata to storage
   */
  private async saveMetadata(): Promise<void> {
    if (!this.metadata) return;

    try {
      await chrome.storage.local.set({
        [CACHE_STORAGE_KEYS.METADATA]: this.metadata,
      });
    } catch (error) {
      console.warn('Failed to save cache metadata:', error);
    }
  }

  /**
   * Save statistics to storage
   */
  private async saveStats(): Promise<void> {
    if (!this.stats) return;

    try {
      await chrome.storage.local.set({
        [CACHE_STORAGE_KEYS.STATS]: this.stats,
      });
    } catch (error) {
      console.warn('Failed to save cache stats:', error);
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle Management
  // --------------------------------------------------------------------------

  /**
   * Start periodic cleanup
   */
  private startPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Run cleanup every hour
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup().catch((error) => console.warn('Periodic cache cleanup failed:', error));
      },
      60 * 60 * 1000,
    ) as any;
  }

  /**
   * Stop periodic cleanup
   */
  private stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.config || !this.metadata || !this.stats) {
      await this.initialize();
    }

    // Check if config needs to be reloaded (every 5 minutes)
    if (Date.now() - this.lastConfigUpdate > 5 * 60 * 1000) {
      await this.loadConfig();
    }
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    this.stopPeriodicCleanup();
  }

  // --------------------------------------------------------------------------
  // Static Utilities
  // --------------------------------------------------------------------------

  /**
   * Get cache storage keys
   */
  static getStorageKeys() {
    return CACHE_STORAGE_KEYS;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

// Export a singleton instance for use throughout the application
export const translationCacheService = new TranslationCacheService();
