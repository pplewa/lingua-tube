/**
 * LinguaTube Chrome Storage Module - Main Export
 * Provides a clean API for all storage-related functionality
 */

// Export all types and interfaces
export * from './types'

// Export default settings and helpers
export * from './defaults'

// Export the main storage service
export { LinguaTubeStorageService, storageService } from './StorageService'

// Re-export singleton instance as default
export { storageService as default } from './StorageService'
