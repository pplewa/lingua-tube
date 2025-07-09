// Batching and queueing service for Microsoft Translator API integration
// Optimizes API usage by grouping requests and managing queue overflow

import {
  BatchConfig,
  TranslationErrorCode,
  TranslateTextRequest
} from './types';
import { configService } from './ConfigService';
import { translationApiService, TranslationErrorImpl } from './TranslationApiService';
import { rateLimitService } from './RateLimitService';
import { translationCacheService } from './TranslationCacheService';

// ============================================================================
// Batch Queue Types
// ============================================================================

export enum BatchRequestPriority {
  LOW = 1,
  NORMAL = 2,
  HIGH = 3,
  URGENT = 4
}

export enum BatchRequestStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export interface BatchTranslationRequest {
  id: string;
  text: string;
  fromLanguage?: string;
  toLanguage: string;
  priority: BatchRequestPriority;
  timestamp: number;
  timeout: number;
  category?: string;
  textType?: 'plain' | 'html';
  
  // Callback handling
  resolve: (translation: string) => void;
  reject: (error: Error) => void;
}

export interface ProcessingBatch {
  id: string;
  requests: BatchTranslationRequest[];
  fromLanguage?: string;
  toLanguage: string;
  totalCharacters: number;
  startTime: number;
  status: BatchRequestStatus;
  retryCount: number;
  maxRetries: number;
}

export interface BatchStats {
  totalRequests: number;
  batchesCreated: number;
  batchesCompleted: number;
  batchesFailed: number;
  averageBatchSize: number;
  averageProcessingTime: number;
  queueSize: number;
  cacheHitRate: number;
  charactersSaved: number;
  lastProcessed: number;
}

export interface QueueMetrics {
  pendingRequests: number;
  processingBatches: number;
  completedBatches: number;
  failedBatches: number;
  averageWaitTime: number;
  throughputPerMinute: number;
}

// ============================================================================
// Batch Queue Service
// ============================================================================

export class BatchQueueService {
  private config: BatchConfig | null = null;
  private requestQueue: BatchTranslationRequest[] = [];
  private processingBatches: Map<string, ProcessingBatch> = new Map();
  private stats: BatchStats = this.initializeStats();
  private isProcessing: boolean = false;
  private batchTimer: number | null = null;
  private lastConfigUpdate: number = 0;

  // Batch processing configuration
  private readonly MAX_BATCH_WAIT_TIME = 2000; // 2 seconds max wait
  private readonly MIN_BATCH_SIZE = 1;
  private readonly CLEANUP_INTERVAL = 60000; // 1 minute

  // --------------------------------------------------------------------------
  // Initialization and Configuration
  // --------------------------------------------------------------------------

  /**
   * Initialize the batch queue service
   */
  async initialize(): Promise<void> {
    try {
      await this.loadConfig();
      this.startBatchProcessor();
      this.startPeriodicCleanup();
    } catch (error) {
      throw new TranslationErrorImpl(
        'Failed to initialize batch queue service',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error }
      );
    }
  }

  /**
   * Load configuration from the config service
   */
  private async loadConfig(): Promise<void> {
    const translationConfig = await configService.getConfig();
    this.config = translationConfig.batchConfig;
    this.lastConfigUpdate = Date.now();
  }

  /**
   * Initialize statistics
   */
  private initializeStats(): BatchStats {
    return {
      totalRequests: 0,
      batchesCreated: 0,
      batchesCompleted: 0,
      batchesFailed: 0,
      averageBatchSize: 0,
      averageProcessingTime: 0,
      queueSize: 0,
      cacheHitRate: 0,
      charactersSaved: 0,
      lastProcessed: 0
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Add a translation request to the batch queue
   */
  async translate(
    text: string,
    fromLanguage: string | undefined,
    toLanguage: string,
    priority: BatchRequestPriority = BatchRequestPriority.NORMAL,
    timeout: number = 30000,
    category?: string,
    textType?: 'plain' | 'html'
  ): Promise<string> {
    await this.ensureInitialized();

    // Check cache first
    const cachedTranslation = await translationCacheService.get(text, fromLanguage || 'auto', toLanguage);
    if (cachedTranslation) {
      this.stats.charactersSaved += text.length;
      return cachedTranslation;
    }

    // Create batch request
    return new Promise<string>((resolve, reject) => {
      const request: BatchTranslationRequest = {
        id: this.generateRequestId(),
        text,
        fromLanguage,
        toLanguage,
        priority,
        timestamp: Date.now(),
        timeout,
        category,
        textType,
        resolve,
        reject
      };

      this.addToQueue(request);
    });
  }

  /**
   * Get current queue statistics
   */
  async getStats(): Promise<BatchStats> {
    await this.ensureInitialized();
    
    this.stats.queueSize = this.requestQueue.length;
    this.stats.cacheHitRate = await this.calculateCacheHitRate();
    
    return { ...this.stats };
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(): Promise<QueueMetrics> {
    await this.ensureInitialized();

    const completedBatches = Array.from(this.processingBatches.values())
      .filter(batch => batch.status === BatchRequestStatus.COMPLETED);
    
    const failedBatches = Array.from(this.processingBatches.values())
      .filter(batch => batch.status === BatchRequestStatus.FAILED);

    const processingBatches = Array.from(this.processingBatches.values())
      .filter(batch => batch.status === BatchRequestStatus.PROCESSING);

    // Calculate average wait time
    const now = Date.now();
    const totalWaitTime = this.requestQueue.reduce((sum, req) => sum + (now - req.timestamp), 0);
    const averageWaitTime = this.requestQueue.length > 0 ? totalWaitTime / this.requestQueue.length : 0;

    // Calculate throughput (requests completed in last minute)
    const oneMinuteAgo = now - 60000;
    const recentCompletions = completedBatches
      .filter(batch => batch.startTime > oneMinuteAgo)
      .reduce((sum, batch) => sum + batch.requests.length, 0);

    return {
      pendingRequests: this.requestQueue.length,
      processingBatches: processingBatches.length,
      completedBatches: completedBatches.length,
      failedBatches: failedBatches.length,
      averageWaitTime,
      throughputPerMinute: recentCompletions
    };
  }

  /**
   * Clear the queue and cancel pending requests
   */
  async clearQueue(): Promise<void> {
    // Cancel all pending requests
    for (const request of this.requestQueue) {
      request.reject(new TranslationErrorImpl(
        'Request cancelled due to queue clear',
        TranslationErrorCode.CANCELLED
      ));
    }

    this.requestQueue = [];
    this.stats.queueSize = 0;
  }

  /**
   * Pause batch processing
   */
  pauseProcessing(): void {
    this.isProcessing = false;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Resume batch processing
   */
  resumeProcessing(): void {
    if (!this.isProcessing) {
      this.isProcessing = true;
      this.startBatchProcessor();
    }
  }

  // --------------------------------------------------------------------------
  // Queue Management
  // --------------------------------------------------------------------------

  /**
   * Add request to queue with priority sorting
   */
  private addToQueue(request: BatchTranslationRequest): void {
    // Insert request in priority order
    let inserted = false;
    for (let i = 0; i < this.requestQueue.length; i++) {
      if (request.priority > this.requestQueue[i].priority) {
        this.requestQueue.splice(i, 0, request);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      this.requestQueue.push(request);
    }

    this.stats.totalRequests++;
    this.stats.queueSize = this.requestQueue.length;

    // Trigger immediate processing if queue was empty
    if (this.requestQueue.length === 1 && this.isProcessing) {
      this.processBatch();
    }
  }

  /**
   * Start the batch processing loop
   */
  private startBatchProcessor(): void {
    if (!this.isProcessing) {
      this.isProcessing = true;
    }
    
    this.processBatch();
  }

  /**
   * Process the next batch of requests
   */
  private async processBatch(): Promise<void> {
    if (!this.isProcessing || !this.config?.enabled) {
      return;
    }

    // Clear any existing timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Check if we have requests to process
    if (this.requestQueue.length === 0) {
      // Schedule next check
      this.batchTimer = setTimeout(() => this.processBatch(), 100) as any;
      return;
    }

    try {
      // Create batch from queue
      const batch = await this.createBatch();
      
      if (batch && batch.requests.length > 0) {
        await this.executeBatch(batch);
      }

    } catch (error) {
      console.error('Batch processing error:', error);
    }

    // Schedule next processing cycle
    this.batchTimer = setTimeout(() => this.processBatch(), 50) as any;
  }

  /**
   * Create a batch from queued requests
   */
  private async createBatch(): Promise<ProcessingBatch | null> {
    if (!this.config || this.requestQueue.length === 0) {
      return null;
    }

    const now = Date.now();
    const maxBatchSize = this.config.maxTextsPerBatch;
    const maxBatchBytes = this.config.maxBatchSizeBytes;

    // Find requests that can be batched together (same language pair)
    const batchRequests: BatchTranslationRequest[] = [];
    let totalCharacters = 0;
    let totalBytes = 0;
    let targetLanguagePair: { from?: string; to: string } | null = null;

    // Check if oldest request has been waiting too long
    const oldestRequest = this.requestQueue[0];
    const waitTime = now - oldestRequest.timestamp;
    const forceProcessing = waitTime > this.MAX_BATCH_WAIT_TIME;

    for (let i = 0; i < this.requestQueue.length && batchRequests.length < maxBatchSize; i++) {
      const request = this.requestQueue[i];
      
      // Check timeout
      if (now - request.timestamp > request.timeout) {
        request.reject(new TranslationErrorImpl(
          'Request timeout',
          TranslationErrorCode.TIMEOUT
        ));
        this.requestQueue.splice(i, 1);
        i--;
        continue;
      }

      // Check language pair compatibility
      if (targetLanguagePair === null) {
        targetLanguagePair = { from: request.fromLanguage, to: request.toLanguage };
      } else if (
        request.fromLanguage !== targetLanguagePair.from ||
        request.toLanguage !== targetLanguagePair.to
      ) {
        // Can't batch different language pairs
        if (!forceProcessing) {
          continue;
        }
        break;
      }

      // Check size constraints
      const requestBytes = new Blob([request.text]).size;
      if (totalBytes + requestBytes > maxBatchBytes) {
        break;
      }

      // Add to batch
      batchRequests.push(request);
      totalCharacters += request.text.length;
      totalBytes += requestBytes;

      // Remove from queue
      this.requestQueue.splice(i, 1);
      i--;
    }

    // Only create batch if we have requests and meet minimum criteria
    if (batchRequests.length >= this.MIN_BATCH_SIZE || forceProcessing) {
      const batch: ProcessingBatch = {
        id: this.generateBatchId(),
        requests: batchRequests,
        fromLanguage: targetLanguagePair?.from,
        toLanguage: targetLanguagePair!.to,
        totalCharacters,
        startTime: now,
        status: BatchRequestStatus.PROCESSING,
        retryCount: 0,
        maxRetries: 3
      };

      this.processingBatches.set(batch.id, batch);
      this.stats.batchesCreated++;
      
      return batch;
    }

    return null;
  }

  /**
   * Execute a batch of translation requests
   */
  private async executeBatch(batch: ProcessingBatch): Promise<void> {
    try {
      // Check rate limits
      const rateLimitStatus = await rateLimitService.checkRateLimit(batch.totalCharacters);
      
      if (!rateLimitStatus.allowed) {
        // Rate limit exceeded, requeue requests
        this.requeueBatchRequests(batch, 'Rate limit exceeded');
        return;
      }

      // Extract texts for batch translation
      const texts = batch.requests.map(req => req.text);
      
      // Call translation API
      const startTime = Date.now();
      const translations = await translationApiService.translateTexts(
        texts,
        batch.fromLanguage,
        batch.toLanguage,
        batch.requests[0].category,
        batch.requests[0].textType
      );

      const processingTime = Date.now() - startTime;

      // Record usage
      await rateLimitService.recordUsage(batch.totalCharacters);

      // Process results
      for (let i = 0; i < batch.requests.length; i++) {
        const request = batch.requests[i];
        const translation = translations[i];

        // Cache the translation
        await translationCacheService.set(
          request.text,
          translation,
          request.fromLanguage || 'auto',
          request.toLanguage
        );

        // Resolve the promise
        request.resolve(translation);
      }

      // Update batch status
      batch.status = BatchRequestStatus.COMPLETED;
      this.stats.batchesCompleted++;
      this.stats.averageProcessingTime = this.updateAverage(
        this.stats.averageProcessingTime,
        processingTime,
        this.stats.batchesCompleted
      );

      // Update average batch size
      this.stats.averageBatchSize = this.updateAverage(
        this.stats.averageBatchSize,
        batch.requests.length,
        this.stats.batchesCompleted
      );

      this.stats.lastProcessed = Date.now();

    } catch (error) {
      await this.handleBatchError(batch, error);
    }
  }

  /**
   * Handle batch processing errors
   */
  private async handleBatchError(batch: ProcessingBatch, error: any): Promise<void> {
    batch.retryCount++;

    if (batch.retryCount <= batch.maxRetries && this.isRetryableError(error)) {
      // Retry the batch
      setTimeout(() => {
        this.executeBatch(batch);
      }, Math.pow(2, batch.retryCount) * 1000); // Exponential backoff
    } else {
      // Fail the batch
      batch.status = BatchRequestStatus.FAILED;
      this.stats.batchesFailed++;

      // Reject all requests in the batch
      const translationError = error instanceof TranslationErrorImpl 
        ? error 
        : new TranslationErrorImpl(
            'Batch translation failed',
            TranslationErrorCode.BATCH_ERROR,
            { originalError: error }
          );

      for (const request of batch.requests) {
        request.reject(translationError);
      }
    }
  }

  /**
   * Requeue batch requests (e.g., due to rate limiting)
   */
  private requeueBatchRequests(batch: ProcessingBatch, reason: string): void {
    // Add requests back to the front of the queue (maintain priority)
    for (let i = batch.requests.length - 1; i >= 0; i--) {
      this.requestQueue.unshift(batch.requests[i]);
    }

    // Remove batch from processing
    this.processingBatches.delete(batch.id);

    console.log(`Requeued batch ${batch.id}: ${reason}`);
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique batch ID
   */
  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof TranslationErrorImpl) {
      return error.retryable;
    }
    return false;
  }

  /**
   * Update running average
   */
  private updateAverage(currentAverage: number, newValue: number, count: number): number {
    return ((currentAverage * (count - 1)) + newValue) / count;
  }

  /**
   * Calculate cache hit rate
   */
  private async calculateCacheHitRate(): Promise<number> {
    try {
      const cacheStats = await translationCacheService.getStats();
      const totalRequests = cacheStats.hits + cacheStats.misses;
      return totalRequests > 0 ? (cacheStats.hits / totalRequests) * 100 : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Start periodic cleanup of completed batches
   */
  private startPeriodicCleanup(): void {
    setInterval(() => {
      this.cleanupCompletedBatches();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Clean up old completed/failed batches
   */
  private cleanupCompletedBatches(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    for (const [batchId, batch] of this.processingBatches.entries()) {
      if (
        (batch.status === BatchRequestStatus.COMPLETED || 
         batch.status === BatchRequestStatus.FAILED) &&
        (now - batch.startTime > maxAge)
      ) {
        this.processingBatches.delete(batchId);
      }
    }
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.config) {
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
    this.pauseProcessing();
    await this.clearQueue();
    this.processingBatches.clear();
  }

  // --------------------------------------------------------------------------
  // Static Utilities
  // --------------------------------------------------------------------------

  /**
   * Create a batch request with default priority
   */
  static createRequest(
    text: string,
    fromLanguage: string | undefined,
    toLanguage: string,
    priority: BatchRequestPriority = BatchRequestPriority.NORMAL
  ): Omit<BatchTranslationRequest, 'id' | 'timestamp' | 'resolve' | 'reject'> {
    return {
      text,
      fromLanguage,
      toLanguage,
      priority,
      timeout: 30000
    };
  }

  /**
   * Get priority from string
   */
  static getPriority(priority: string): BatchRequestPriority {
    switch (priority.toLowerCase()) {
      case 'urgent': return BatchRequestPriority.URGENT;
      case 'high': return BatchRequestPriority.HIGH;
      case 'normal': return BatchRequestPriority.NORMAL;
      case 'low': return BatchRequestPriority.LOW;
      default: return BatchRequestPriority.NORMAL;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

// Export a singleton instance for use throughout the application
export const batchQueueService = new BatchQueueService(); 