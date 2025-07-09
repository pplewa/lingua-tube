/**
 * LinguaTube Chrome Storage Service
 * Main implementation of the storage service with full CRUD operations
 */

import {
  StorageService,
  VocabularyItem,
  UserSettings,
  StorageResult,
  StorageError,
  StorageErrorCode,
  StorageEvent,
  StorageEventType,
  STORAGE_KEYS,
  STORAGE_CONFIG,
} from './types';
import {
  DEFAULT_USER_SETTINGS,
  DEFAULT_STORAGE_SCHEMA,
  generateVocabularyId,
  createDefaultSettings,
  validateUserSettings,
} from './defaults';

/**
 * Cache entry structure for internal caching
 */
interface CacheEntry<T = unknown> {
  value: T;
  expiry: number;
  timestamp: number;
}

/**
 * Event listener entry
 */
interface EventListener {
  type: StorageEventType;
  listener: (event: StorageEvent) => void;
}

/**
 * Main storage service implementation
 */
export class LinguaTubeStorageService implements StorageService {
  private cache = new Map<string, CacheEntry>();
  private eventListeners = new Map<StorageEventType, Set<(event: StorageEvent) => void>>();
  private isInitialized = false;

  constructor() {
    this.setupStorageListener();
  }

  // ========================================
  // Initialization & Setup
  // ========================================

  /**
   * Initialize the storage service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.ensureSchemaVersion();
      await this.ensureDefaultSettings();
      this.isInitialized = true;
    } catch (error) {
      console.error('[LinguaTube] Storage initialization failed:', error);
      throw error;
    }
  }

  /**
   * Set up chrome.storage change listener for cross-context sync
   */
  private setupStorageListener(): void {
    if (typeof chrome?.storage?.onChanged !== 'undefined') {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
          this.handleStorageChange(changes);
        }
      });
    }
  }

  /**
   * Handle storage changes for event emission
   */
  private handleStorageChange(changes: { [key: string]: chrome.storage.StorageChange }): void {
    for (const [key, change] of Object.entries(changes)) {
      if (key === STORAGE_KEYS.VOCABULARY) {
        this.emitEvent(StorageEventType.VOCABULARY_UPDATED, change.newValue);
      } else if (key === STORAGE_KEYS.SETTINGS) {
        this.emitEvent(StorageEventType.SETTINGS_UPDATED, change.newValue);
      }
      
      // Invalidate cache for changed keys
      this.cache.delete(key);
    }
  }

  // ========================================
  // Vocabulary Operations
  // ========================================

  async saveWord(item: Omit<VocabularyItem, 'id' | 'createdAt'>): Promise<StorageResult<VocabularyItem>> {
    await this.initialize();
    
    try {
      const vocabulary = await this.getVocabularyRaw();
      
      // Check if word already exists
      const existingIndex = vocabulary.findIndex(
        v => v.word.toLowerCase() === item.word.toLowerCase() && 
             v.sourceLanguage === item.sourceLanguage
      );
      
      const newItem: VocabularyItem = {
        ...item,
        id: generateVocabularyId(),
        createdAt: Date.now(),
        reviewCount: 0,
      };
      
      if (existingIndex >= 0) {
        // Update existing word
        vocabulary[existingIndex] = {
          ...vocabulary[existingIndex],
          ...newItem,
          id: vocabulary[existingIndex].id,
          createdAt: vocabulary[existingIndex].createdAt,
          reviewCount: vocabulary[existingIndex].reviewCount + 1,
        };
      } else {
        // Add new word
        vocabulary.push(newItem);
        
        // Check vocabulary limit
        const settings = await this.getSettingsRaw();
        if (vocabulary.length > settings.vocabulary.maxSavedWords) {
          // Remove oldest items
          vocabulary.sort((a, b) => a.createdAt - b.createdAt);
          vocabulary.splice(0, vocabulary.length - settings.vocabulary.maxSavedWords);
        }
      }
      
      await this.setStorageItem(STORAGE_KEYS.VOCABULARY, vocabulary);
      
      const savedItem = vocabulary[existingIndex >= 0 ? existingIndex : vocabulary.length - 1];
      this.emitEvent(
        existingIndex >= 0 ? StorageEventType.VOCABULARY_UPDATED : StorageEventType.VOCABULARY_ADDED,
        savedItem
      );
      
      return this.createSuccessResult(savedItem);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to save word', error);
    }
  }

  async getVocabulary(): Promise<StorageResult<VocabularyItem[]>> {
    await this.initialize();
    
    try {
      const vocabulary = await this.getVocabularyRaw();
      return this.createSuccessResult(vocabulary);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to get vocabulary', error);
    }
  }

  async removeWord(id: string): Promise<StorageResult<void>> {
    await this.initialize();
    
    try {
      const vocabulary = await this.getVocabularyRaw();
      const index = vocabulary.findIndex(item => item.id === id);
      
      if (index === -1) {
        return this.createErrorResult(StorageErrorCode.INVALID_DATA, 'Word not found');
      }
      
      const removedItem = vocabulary[index];
      vocabulary.splice(index, 1);
      
      await this.setStorageItem(STORAGE_KEYS.VOCABULARY, vocabulary);
      this.emitEvent(StorageEventType.VOCABULARY_REMOVED, removedItem);
      
      return this.createSuccessResult(undefined);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to remove word', error);
    }
  }

  async updateWord(id: string, updates: Partial<VocabularyItem>): Promise<StorageResult<VocabularyItem>> {
    await this.initialize();
    
    try {
      const vocabulary = await this.getVocabularyRaw();
      const index = vocabulary.findIndex(item => item.id === id);
      
      if (index === -1) {
        return this.createErrorResult(StorageErrorCode.INVALID_DATA, 'Word not found');
      }
      
      const updatedItem: VocabularyItem = {
        ...vocabulary[index],
        ...updates,
        id, // Ensure ID cannot be changed
        createdAt: vocabulary[index].createdAt, // Preserve creation time
      };
      
      vocabulary[index] = updatedItem;
      await this.setStorageItem(STORAGE_KEYS.VOCABULARY, vocabulary);
      
      this.emitEvent(StorageEventType.VOCABULARY_UPDATED, updatedItem);
      return this.createSuccessResult(updatedItem);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to update word', error);
    }
  }

  async clearVocabulary(): Promise<StorageResult<void>> {
    await this.initialize();
    
    try {
      await this.setStorageItem(STORAGE_KEYS.VOCABULARY, []);
      this.emitEvent(StorageEventType.VOCABULARY_REMOVED, null);
      return this.createSuccessResult(undefined);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to clear vocabulary', error);
    }
  }

  // ========================================
  // Settings Operations
  // ========================================

  async saveSettings(settings: Partial<UserSettings>): Promise<StorageResult<UserSettings>> {
    await this.initialize();
    
    try {
      const currentSettings = await this.getSettingsRaw();
      const newSettings = createDefaultSettings({
        ...currentSettings,
        ...settings,
        version: STORAGE_CONFIG.SCHEMA_VERSION,
      });
      
      if (!validateUserSettings(newSettings)) {
        return this.createErrorResult(StorageErrorCode.INVALID_DATA, 'Invalid settings format');
      }
      
      await this.setStorageItem(STORAGE_KEYS.SETTINGS, newSettings);
      this.emitEvent(StorageEventType.SETTINGS_UPDATED, newSettings);
      
      return this.createSuccessResult(newSettings);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to save settings', error);
    }
  }

  async getSettings(): Promise<StorageResult<UserSettings>> {
    await this.initialize();
    
    try {
      const settings = await this.getSettingsRaw();
      return this.createSuccessResult(settings);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to get settings', error);
    }
  }

  async resetSettings(): Promise<StorageResult<UserSettings>> {
    await this.initialize();
    
    try {
      await this.setStorageItem(STORAGE_KEYS.SETTINGS, DEFAULT_USER_SETTINGS);
      this.emitEvent(StorageEventType.SETTINGS_UPDATED, DEFAULT_USER_SETTINGS);
      
      return this.createSuccessResult(DEFAULT_USER_SETTINGS);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to reset settings', error);
    }
  }

  // ========================================
  // Cache Operations
  // ========================================

  async setCache<T>(key: string, value: T, ttl?: number): Promise<StorageResult<void>> {
    try {
      const expiry = ttl 
        ? Date.now() + ttl 
        : Date.now() + (STORAGE_CONFIG.CACHE_EXPIRY_HOURS * 60 * 60 * 1000);
      
      const entry: CacheEntry<T> = {
        value,
        expiry,
        timestamp: Date.now(),
      };
      
      this.cache.set(key, entry);
      
      // Also persist to chrome.storage if space allows
      try {
        const cacheData = await this.getStorageItem<Record<string, CacheEntry>>(STORAGE_KEYS.CACHE) || {};
        cacheData[key] = entry;
        await this.setStorageItem(STORAGE_KEYS.CACHE, cacheData);
      } catch {
        // Ignore storage errors for cache
      }
      
      return this.createSuccessResult(undefined);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to set cache', error);
    }
  }

  async getCache<T>(key: string): Promise<StorageResult<T | null>> {
    try {
      // Check in-memory cache first
      let entry = this.cache.get(key) as CacheEntry<T> | undefined;
      
      // If not in memory, check persistent cache
      if (!entry) {
        const cacheData = await this.getStorageItem<Record<string, CacheEntry>>(STORAGE_KEYS.CACHE);
        entry = cacheData?.[key] as CacheEntry<T> | undefined;
        
        // Load back to memory if found
        if (entry) {
          this.cache.set(key, entry);
        }
      }
      
      if (!entry || entry.expiry < Date.now()) {
        // Remove expired entries
        if (entry) {
          this.cache.delete(key);
        }
        return this.createSuccessResult(null);
      }
      
      return this.createSuccessResult(entry.value);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to get cache', error);
    }
  }

  async clearCache(): Promise<StorageResult<void>> {
    try {
      this.cache.clear();
      await this.setStorageItem(STORAGE_KEYS.CACHE, {});
      this.emitEvent(StorageEventType.CACHE_CLEARED, null);
      
      return this.createSuccessResult(undefined);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to clear cache', error);
    }
  }

  // ========================================
  // Event Handling
  // ========================================

  addEventListener(type: StorageEventType, listener: (event: StorageEvent) => void): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)!.add(listener);
  }

  removeEventListener(type: StorageEventType, listener: (event: StorageEvent) => void): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  private emitEvent<T>(type: StorageEventType, data: T): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const event: StorageEvent<T> = {
        type,
        data,
        timestamp: Date.now(),
        source: this.getContextSource(),
      };
      
      listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error('[LinguaTube] Event listener error:', error);
        }
      });
    }
  }

  private getContextSource(): 'content' | 'popup' | 'background' {
    if (typeof window !== 'undefined' && window.location?.hostname === 'youtube.com') {
      return 'content';
    }
    if (typeof chrome?.extension?.getBackgroundPage !== 'undefined') {
      return 'background';
    }
    return 'popup';
  }

  // ========================================
  // Utility Methods
  // ========================================

  async getStorageUsage(): Promise<StorageResult<{ used: number; available: number }>> {
    try {
      const usage = await new Promise<{ [key: string]: number }>((resolve, reject) => {
        chrome.storage.local.getBytesInUse(null, (bytes) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve({ used: bytes });
          }
        });
      });
      
      const quota = chrome.storage.local.QUOTA_BYTES || (5 * 1024 * 1024); // 5MB default
      
      return this.createSuccessResult({
        used: usage.used,
        available: quota - usage.used,
      });
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to get storage usage', error);
    }
  }

  async exportData(): Promise<StorageResult<string>> {
    await this.initialize();
    
    try {
      const [vocabulary, settings] = await Promise.all([
        this.getVocabularyRaw(),
        this.getSettingsRaw(),
      ]);
      
      const exportData = {
        vocabulary,
        settings,
        version: STORAGE_CONFIG.SCHEMA_VERSION,
        exportedAt: Date.now(),
      };
      
      return this.createSuccessResult(JSON.stringify(exportData, null, 2));
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.UNKNOWN_ERROR, 'Failed to export data', error);
    }
  }

  async importData(data: string): Promise<StorageResult<void>> {
    await this.initialize();
    
    try {
      const importData = JSON.parse(data);
      
      if (importData.vocabulary && Array.isArray(importData.vocabulary)) {
        await this.setStorageItem(STORAGE_KEYS.VOCABULARY, importData.vocabulary);
      }
      
      if (importData.settings && validateUserSettings(importData.settings)) {
        await this.setStorageItem(STORAGE_KEYS.SETTINGS, importData.settings);
      }
      
      return this.createSuccessResult(undefined);
    } catch (error) {
      return this.createErrorResult(StorageErrorCode.INVALID_DATA, 'Failed to import data', error);
    }
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private async getVocabularyRaw(): Promise<VocabularyItem[]> {
    const vocabulary = await this.getStorageItem<VocabularyItem[]>(STORAGE_KEYS.VOCABULARY);
    return vocabulary || [];
  }

  private async getSettingsRaw(): Promise<UserSettings> {
    const settings = await this.getStorageItem<UserSettings>(STORAGE_KEYS.SETTINGS);
    return settings || DEFAULT_USER_SETTINGS;
  }

  private async getStorageItem<T>(key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([key], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result[key] || null);
        }
      });
    });
  }

  private async setStorageItem<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  private async ensureSchemaVersion(): Promise<void> {
    const schema = await this.getStorageItem<any>(STORAGE_KEYS.SCHEMA);
    if (!schema || schema.version !== STORAGE_CONFIG.SCHEMA_VERSION) {
      await this.setStorageItem(STORAGE_KEYS.SCHEMA, DEFAULT_STORAGE_SCHEMA);
    }
  }

  private async ensureDefaultSettings(): Promise<void> {
    const settings = await this.getStorageItem<UserSettings>(STORAGE_KEYS.SETTINGS);
    if (!settings || !validateUserSettings(settings)) {
      await this.setStorageItem(STORAGE_KEYS.SETTINGS, DEFAULT_USER_SETTINGS);
    }
  }

  private createSuccessResult<T>(data: T): StorageResult<T> {
    return {
      success: true,
      data,
      timestamp: Date.now(),
    };
  }

  private createErrorResult<T = unknown>(
    code: StorageErrorCode,
    message: string,
    error?: unknown
  ): StorageResult<T> {
    const storageError: StorageError = {
      code,
      message,
      details: error ? { originalError: error } : undefined,
      timestamp: Date.now(),
    };
    
    return {
      success: false,
      error: storageError,
      timestamp: Date.now(),
    };
  }
}

// ========================================
// Singleton Export
// ========================================

export const storageService = new LinguaTubeStorageService(); 