/**
 * LinguaTube Subtitle Cache Service
 * Handles caching of subtitle files with TTL, compression, and storage management
 */

import {
  SubtitleFile,
  SubtitleCache,
  CacheConfig,
  CacheEntry,
  CacheEntryMetadata,
  CacheStats,
  DEFAULT_CACHE_CONFIG,
} from './types'
import { Logger } from '../logging/Logger'
import { ComponentType } from '../logging/types'

/**
 * Internal cache entry structure
 */
interface InternalCacheEntry {
  readonly data: string // Compressed/serialized subtitle file
  readonly metadata: CacheEntryMetadata
  readonly version: number // Cache format version
}

/**
 * Cache statistics tracking
 */
interface CacheStatsTracker {
  hits: number
  misses: number
  evictions: number
  lastCleanup: number
  totalRequests: number
}

/**
 * Subtitle cache implementation using Chrome storage
 */
export class SubtitleCacheService implements SubtitleCache {
  private readonly config: CacheConfig
  private readonly logger: Logger | null = null
  private readonly statsTracker: CacheStatsTracker
  private readonly memoryCache: Map<string, CacheEntry>
  private cleanupTimer?: number

  private static readonly CACHE_VERSION = 1
  private static readonly CACHE_KEY_PREFIX = 'linguatube_subtitle_'
  private static readonly STATS_KEY = 'linguatube_cache_stats'
  private static readonly CONFIG_KEY = 'linguatube_cache_config'

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config }
    this.logger = Logger.getInstance()
    this.memoryCache = new Map()
    this.statsTracker = {
      hits: 0,
      misses: 0,
      evictions: 0,
      lastCleanup: Date.now(),
      totalRequests: 0,
    }

    this.initialize()
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  /**
   * Initialize cache service
   */
  private async initialize(): Promise<void> {
    try {
      this.logger?.info('Initializing subtitle cache service...', {
        component: ComponentType.SUBTITLE_MANAGER,
      })

      // Load existing statistics
      await this.loadStats()

      // Start cleanup timer
      this.startCleanupTimer()

      // Perform initial cleanup if needed
      const timeSinceLastCleanup = Date.now() - this.statsTracker.lastCleanup
      if (timeSinceLastCleanup > this.config.cleanupInterval * 1000) {
        await this.cleanup()
      }

      this.logger?.info('Cache service initialized successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
      })
    } catch (error) {
      this.logger?.error(
        'Cache initialization failed',
        { component: ComponentType.SUBTITLE_MANAGER },
        error instanceof Error ? error : undefined,
      )
    }
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }

    this.cleanupTimer = window.setInterval(async () => {
      await this.cleanup()
    }, this.config.cleanupInterval * 1000)
  }

  // ========================================
  // Main Cache Operations
  // ========================================

  /**
   * Get cached subtitle file
   */
  async get(key: string): Promise<CacheEntry | null> {
    this.statsTracker.totalRequests++

    try {
      // Check memory cache first (if using hybrid storage)
      if (this.config.storageType === 'hybrid' && this.memoryCache.has(key)) {
        const entry = this.memoryCache.get(key)!

        // Check if entry is still valid
        if (entry.metadata.expiresAt > Date.now()) {
          this.statsTracker.hits++
          await this.updateAccessMetadata(entry)
          return entry
        } else {
          // Remove expired entry from memory
          this.memoryCache.delete(key)
        }
      }

      // Check persistent storage
      const cacheKey = this.buildCacheKey(key)
      const stored = await this.getFromStorage(cacheKey)

      if (!stored) {
        this.statsTracker.misses++
        return null
      }

      // Validate and decompress entry
      const entry = await this.deserializeCacheEntry(stored)

      if (!entry || entry.metadata.expiresAt <= Date.now()) {
        // Entry expired, remove it
        await this.delete(key)
        this.statsTracker.misses++
        return null
      }

      // Update access metadata
      await this.updateAccessMetadata(entry)

      // Store in memory cache for faster access
      if (this.config.storageType === 'hybrid') {
        this.memoryCache.set(key, entry)
      }

      this.statsTracker.hits++
      return entry
    } catch (error) {
      this.logger?.error(
        'Cache get error',
        {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { key },
        },
        error instanceof Error ? error : undefined,
      )
      this.statsTracker.misses++
      return null
    }
  }

  /**
   * Store subtitle file in cache
   */
  async set(key: string, data: SubtitleFile, ttl?: number): Promise<void> {
    try {
      const now = Date.now()
      const expiresAt = now + (ttl || this.config.defaultTTL) * 1000

      // Create cache entry
      const entry: CacheEntry = {
        key,
        data,
        metadata: {
          createdAt: now,
          expiresAt,
          lastAccessed: now,
          accessCount: 1,
          size: this.calculateSize(data),
          compressed: this.config.compressionEnabled,
          etag: data.cacheInfo?.etag,
        },
      }

      // Check cache size limits
      await this.ensureCacheSpace(entry.metadata.size)

      // Serialize and store
      const serialized = await this.serializeCacheEntry(entry)
      const cacheKey = this.buildCacheKey(key)

      await this.setInStorage(cacheKey, serialized)

      // Update memory cache
      if (this.config.storageType === 'hybrid') {
        this.memoryCache.set(key, entry)
      }

      this.logger?.debug('Cached subtitle file', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { key, size: entry.metadata.size },
      })
    } catch (error) {
      this.logger?.error(
        'Cache set error',
        {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { key },
        },
        error instanceof Error ? error : undefined,
      )
      throw error
    }
  }

  /**
   * Delete cached entry
   */
  async delete(key: string): Promise<boolean> {
    try {
      const cacheKey = this.buildCacheKey(key)

      // Remove from persistent storage
      const removed = await this.removeFromStorage(cacheKey)

      // Remove from memory cache
      this.memoryCache.delete(key)

      if (removed) {
        this.logger?.debug('Deleted cached entry', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { key },
        })
      }

      return removed
    } catch (error) {
      this.logger?.error(
        'Cache delete error',
        {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { key },
        },
        error instanceof Error ? error : undefined,
      )
      return false
    }
  }

  /**
   * Clear all cached entries
   */
  async clear(): Promise<void> {
    try {
      this.logger?.info('Clearing subtitle cache...', { component: ComponentType.SUBTITLE_MANAGER })

      // Clear memory cache
      this.memoryCache.clear()

      // Clear persistent storage
      const allKeys = await this.getAllCacheKeys()

      if (allKeys.length > 0) {
        await chrome.storage.local.remove(allKeys)
      }

      // Reset statistics
      this.statsTracker.hits = 0
      this.statsTracker.misses = 0
      this.statsTracker.evictions = 0
      this.statsTracker.totalRequests = 0

      await this.saveStats()

      this.logger?.info('Cache cleared', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { entriesRemoved: allKeys.length },
      })
    } catch (error) {
      this.logger?.error(
        'Cache clear error',
        { component: ComponentType.SUBTITLE_MANAGER },
        error instanceof Error ? error : undefined,
      )
      throw error
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const hitRate =
      this.statsTracker.totalRequests > 0
        ? this.statsTracker.hits / this.statsTracker.totalRequests
        : 0

    const missRate =
      this.statsTracker.totalRequests > 0
        ? this.statsTracker.misses / this.statsTracker.totalRequests
        : 0

    return {
      totalSize: this.calculateTotalSize(),
      totalFiles: this.memoryCache.size, // Approximate for hybrid mode
      hitRate,
      missRate,
      evictionCount: this.statsTracker.evictions,
      lastCleanup: this.statsTracker.lastCleanup,
    }
  }

  /**
   * Cleanup expired entries and manage cache size
   */
  async cleanup(): Promise<void> {
    try {
      this.logger?.info('Starting cache cleanup...', { component: ComponentType.SUBTITLE_MANAGER })

      const now = Date.now()
      let removedCount = 0
      let freedSpace = 0

      // Get all cache entries
      const allKeys = await this.getAllCacheKeys()

      for (const cacheKey of allKeys) {
        try {
          const stored = await this.getFromStorage(cacheKey)
          if (!stored) continue

          const entry = await this.deserializeCacheEntry(stored)
          if (!entry) {
            // Invalid entry, remove it
            await chrome.storage.local.remove([cacheKey])
            removedCount++
            continue
          }

          // Remove expired entries
          if (entry.metadata.expiresAt <= now) {
            await chrome.storage.local.remove([cacheKey])
            this.memoryCache.delete(entry.key)
            freedSpace += entry.metadata.size
            removedCount++
            this.statsTracker.evictions++
          }
        } catch (error) {
          this.logger?.warn('Error processing cache entry during cleanup', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: { cacheKey, error: error instanceof Error ? error.message : String(error) },
          })
          // Remove problematic entry
          await chrome.storage.local.remove([cacheKey])
          removedCount++
        }
      }

      // Additional cleanup if cache is still too large
      await this.enforceSizeLimits()

      // Update cleanup timestamp
      this.statsTracker.lastCleanup = now
      await this.saveStats()

      this.logger?.info('Cache cleanup completed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { entriesRemoved: removedCount, bytesFreed: freedSpace },
      })
    } catch (error) {
      this.logger?.error(
        'Cache cleanup failed',
        { component: ComponentType.SUBTITLE_MANAGER },
        error instanceof Error ? error : undefined,
      )
    }
  }

  // ========================================
  // Storage Operations
  // ========================================

  /**
   * Get data from Chrome storage
   */
  private async getFromStorage(key: string): Promise<InternalCacheEntry | null> {
    try {
      const result = await chrome.storage.local.get([key])
      return result[key] || null
    } catch (error) {
      this.logger?.error(
        'Storage get error',
        {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { key },
        },
        error instanceof Error ? error : undefined,
      )
      return null
    }
  }

  /**
   * Set data in Chrome storage
   */
  private async setInStorage(key: string, data: InternalCacheEntry): Promise<void> {
    try {
      await chrome.storage.local.set({ [key]: data })
    } catch (error) {
      this.logger?.error(
        'Storage set error',
        {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { key },
        },
        error instanceof Error ? error : undefined,
      )
      throw error
    }
  }

  /**
   * Remove data from Chrome storage
   */
  private async removeFromStorage(key: string): Promise<boolean> {
    try {
      await chrome.storage.local.remove([key])
      return true
    } catch (error) {
      this.logger?.error(
        'Storage remove error',
        {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: { key },
        },
        error instanceof Error ? error : undefined,
      )
      return false
    }
  }

  /**
   * Get all cache keys from storage
   */
  private async getAllCacheKeys(): Promise<string[]> {
    try {
      const allData = await chrome.storage.local.get(null)
      return Object.keys(allData).filter((key) =>
        key.startsWith(SubtitleCacheService.CACHE_KEY_PREFIX),
      )
    } catch (error) {
      this.logger?.error(
        'Error getting cache keys',
        { component: ComponentType.SUBTITLE_MANAGER },
        error instanceof Error ? error : undefined,
      )
      return []
    }
  }

  // ========================================
  // Serialization and Compression
  // ========================================

  /**
   * Serialize cache entry for storage
   */
  private async serializeCacheEntry(entry: CacheEntry): Promise<InternalCacheEntry> {
    let dataString = JSON.stringify(entry.data)

    // Apply compression if enabled
    if (this.config.compressionEnabled) {
      dataString = await this.compressData(dataString)
    }

    return {
      data: dataString,
      metadata: entry.metadata,
      version: SubtitleCacheService.CACHE_VERSION,
    }
  }

  /**
   * Deserialize cache entry from storage
   */
  private async deserializeCacheEntry(stored: InternalCacheEntry): Promise<CacheEntry | null> {
    try {
      let dataString = stored.data

      // Decompress if needed
      if (stored.metadata.compressed) {
        dataString = await this.decompressData(dataString)
      }

      const subtitleFile: SubtitleFile = JSON.parse(dataString)

      // Reconstruct cache entry
      return {
        key: '', // Will be set by caller
        data: subtitleFile,
        metadata: stored.metadata,
      }
    } catch (error) {
      this.logger?.error(
        'Cache entry deserialization failed',
        { component: ComponentType.SUBTITLE_MANAGER },
        error instanceof Error ? error : undefined,
      )
      return null
    }
  }

  /**
   * Compress data string (simple implementation)
   */
  private async compressData(data: string): Promise<string> {
    // For now, just return the data as-is
    // In a real implementation, you might use compression algorithms
    // like LZ-string or built-in compression APIs
    return data
  }

  /**
   * Decompress data string
   */
  private async decompressData(data: string): Promise<string> {
    // Corresponding decompression for the compression method used
    return data
  }

  // ========================================
  // Cache Management
  // ========================================

  /**
   * Ensure cache has space for new entry
   */
  private async ensureCacheSpace(requiredSize: number): Promise<void> {
    const stats = this.getStats()

    // Check if we exceed file count limit
    if (stats.totalFiles >= this.config.maxFiles) {
      await this.evictLeastRecentlyUsed(1)
    }

    // Check if we exceed size limit
    if (stats.totalSize + requiredSize > this.config.maxSize) {
      const sizeToFree = stats.totalSize + requiredSize - this.config.maxSize
      await this.evictBySize(sizeToFree)
    }
  }

  /**
   * Enforce cache size limits
   */
  private async enforceSizeLimits(): Promise<void> {
    const stats = this.getStats()

    // Remove excess files
    if (stats.totalFiles > this.config.maxFiles) {
      const filesToRemove = stats.totalFiles - this.config.maxFiles
      await this.evictLeastRecentlyUsed(filesToRemove)
    }

    // Remove excess size
    if (stats.totalSize > this.config.maxSize) {
      const sizeToFree = stats.totalSize - this.config.maxSize
      await this.evictBySize(sizeToFree)
    }
  }

  /**
   * Evict least recently used entries
   */
  private async evictLeastRecentlyUsed(count: number): Promise<void> {
    // This is a simplified implementation
    // In practice, you'd need to track access times across all entries
    const entries = Array.from(this.memoryCache.entries())
    entries.sort((a, b) => a[1].metadata.lastAccessed - b[1].metadata.lastAccessed)

    const toEvict = entries.slice(0, count)
    for (const [key] of toEvict) {
      await this.delete(key)
      this.statsTracker.evictions++
    }
  }

  /**
   * Evict entries by total size
   */
  private async evictBySize(targetSize: number): Promise<void> {
    let freedSize = 0
    const entries = Array.from(this.memoryCache.entries())
    entries.sort((a, b) => a[1].metadata.lastAccessed - b[1].metadata.lastAccessed)

    for (const [key, entry] of entries) {
      if (freedSize >= targetSize) break

      await this.delete(key)
      freedSize += entry.metadata.size
      this.statsTracker.evictions++
    }
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Build cache key for storage
   */
  private buildCacheKey(key: string): string {
    return SubtitleCacheService.CACHE_KEY_PREFIX + this.hashKey(key)
  }

  /**
   * Hash cache key for consistent storage
   */
  private hashKey(key: string): string {
    // Simple hash function for cache keys
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Calculate size of subtitle file
   */
  private calculateSize(subtitleFile: SubtitleFile): number {
    return JSON.stringify(subtitleFile).length * 2 // Rough estimate in bytes
  }

  /**
   * Calculate total cache size
   */
  private calculateTotalSize(): number {
    let total = 0
    for (const entry of this.memoryCache.values()) {
      total += entry.metadata.size
    }
    return total
  }

  /**
   * Update access metadata for cache entry
   */
  private async updateAccessMetadata(entry: CacheEntry): Promise<void> {
    const now = Date.now()
    const updatedMetadata = {
      ...entry.metadata,
      lastAccessed: now,
      accessCount: entry.metadata.accessCount + 1,
    }

    // Update memory cache
    if (this.memoryCache.has(entry.key)) {
      const updatedEntry = { ...entry, metadata: updatedMetadata }
      this.memoryCache.set(entry.key, updatedEntry)
    }
  }

  /**
   * Load statistics from storage
   */
  private async loadStats(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([SubtitleCacheService.STATS_KEY])
      const stored = result[SubtitleCacheService.STATS_KEY]

      if (stored) {
        Object.assign(this.statsTracker, stored)
      }
    } catch (error) {
      this.logger?.warn('Failed to load cache stats', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  /**
   * Save statistics to storage
   */
  private async saveStats(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [SubtitleCacheService.STATS_KEY]: this.statsTracker,
      })
    } catch (error) {
      this.logger?.warn('Failed to save cache stats', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: { error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
    }
    this.memoryCache.clear()
  }
}

// ========================================
// Factory and Utilities
// ========================================

/**
 * Create cache service instance
 */
export function createSubtitleCache(config?: Partial<CacheConfig>): SubtitleCacheService {
  return new SubtitleCacheService(config)
}

/**
 * Generate cache key for subtitle URL
 */
export function generateCacheKey(url: string, language?: string): string {
  const base = new URL(url).href
  return language ? `${base}:${language}` : base
}

/**
 * Default cache service instance
 */
export const subtitleCache = createSubtitleCache()
