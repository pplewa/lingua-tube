// ========================================
// Performance Monitor for Chrome Extension
// ========================================

import { LogLevel, ComponentType, LogContext, PerformanceData } from './types';
import { Logger } from './Logger';

/**
 * Performance thresholds for different operation types
 */
export interface PerformanceThresholds {
  readonly storage: {
    readonly read: number;    // ms
    readonly write: number;   // ms
  };
  readonly network: {
    readonly fetch: number;   // ms
    readonly retry: number;   // ms
  };
  readonly ui: {
    readonly render: number;  // ms
    readonly interaction: number; // ms
  };
  readonly youtube: {
    readonly playerQuery: number; // ms
    readonly subtitleParse: number; // ms
  };
  readonly translation: {
    readonly translate: number; // ms
    readonly cache: number;   // ms
  };
}

/**
 * Operation metadata for performance tracking
 */
export interface OperationMetadata {
  readonly operationType: string;
  readonly component: ComponentType;
  readonly inputSize?: number;
  readonly outputSize?: number;
  readonly cacheHit?: boolean;
  readonly retryCount?: number;
  readonly networkState?: 'online' | 'offline' | 'slow';
  readonly memoryBefore?: number;
  readonly memoryAfter?: number;
  readonly customData?: Record<string, any>;
}

/**
 * Performance measurement result
 */
export interface PerformanceMeasurement {
  readonly name: string;
  readonly duration: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly metadata: OperationMetadata;
  readonly isSlowOperation: boolean;
  readonly threshold: number;
  readonly memoryDelta?: number;
  readonly timestamp: string;
}

/**
 * Performance analytics data
 */
export interface PerformanceAnalytics {
  readonly totalOperations: number;
  readonly slowOperations: number;
  readonly averageDuration: number;
  readonly p95Duration: number;
  readonly p99Duration: number;
  readonly operationsByType: Record<string, {
    readonly count: number;
    readonly avgDuration: number;
    readonly slowCount: number;
  }>;
  readonly memoryStats: {
    readonly averageUsage: number;
    readonly peakUsage: number;
    readonly totalAllocated: number;
  };
  readonly timeRange: {
    readonly start: string;
    readonly end: string;
  };
}

/**
 * Default performance thresholds optimized for Chrome extensions
 */
export const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  storage: {
    read: 50,    // Chrome storage should be fast
    write: 100
  },
  network: {
    fetch: 2000,  // Network operations can be slower
    retry: 5000
  },
  ui: {
    render: 16,   // 60fps = 16.67ms per frame
    interaction: 100
  },
  youtube: {
    playerQuery: 200,
    subtitleParse: 500
  },
  translation: {
    translate: 1000,
    cache: 10
  }
};

/**
 * Enhanced Performance Monitor for Chrome Extension
 * Integrates with Logger for comprehensive performance tracking
 */
export class PerformanceMonitor {
  private static instance: PerformanceMonitor | null = null;
  private logger: Logger;
  private thresholds: PerformanceThresholds;
  private activeOperations: Map<string, {
    startTime: number;
    metadata: OperationMetadata;
    memoryBefore?: number;
  }> = new Map();
  private measurements: PerformanceMeasurement[] = [];
  private memoryObserver: PerformanceObserver | null = null;
  private isEnabled: boolean = true;
  private maxMeasurements: number = 1000;
  private flushInterval: number = 30000; // 30 seconds
  private flushTimer: number | null = null;

  private constructor(thresholds?: Partial<PerformanceThresholds>) {
    this.logger = Logger.getInstance();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.initialize();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(thresholds?: Partial<PerformanceThresholds>): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor(thresholds);
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Initialize performance monitoring
   */
  private initialize(): void {
    try {
      // Setup memory observer if available
      if (typeof PerformanceObserver !== 'undefined') {
        this.setupMemoryObserver();
      }

      // Setup periodic flush
      this.setupFlushTimer();

      // Log initialization
      this.logger.info('PerformanceMonitor initialized', {
        component: ComponentType.ERROR_HANDLER,
        action: 'performance_monitor_init',
        metadata: {
          thresholds: this.thresholds,
          maxMeasurements: this.maxMeasurements
        }
      });
    } catch (error) {
      this.logger.error('Failed to initialize PerformanceMonitor', {
        component: ComponentType.ERROR_HANDLER,
        action: 'performance_monitor_init_error'
      }, error as Error);
    }
  }

  /**
   * Setup memory observer for memory usage tracking
   */
  private setupMemoryObserver(): void {
    try {
      this.memoryObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (const entry of entries) {
          if (entry.entryType === 'measure') {
            this.logger.debug('Memory measurement detected', {
              component: ComponentType.ERROR_HANDLER,
              action: 'memory_measure',
              performance: {
                duration: entry.duration,
                timing: {
                  start: entry.startTime,
                  end: entry.startTime + entry.duration
                }
              }
            });
          }
        }
      });

      this.memoryObserver.observe({ entryTypes: ['measure', 'mark'] });
    } catch (error) {
      this.logger.warn('Memory observer setup failed', {
        component: ComponentType.ERROR_HANDLER,
        action: 'memory_observer_setup_error'
      });
    }
  }

  /**
   * Setup periodic flush timer
   */
  private setupFlushTimer(): void {
    this.flushTimer = window.setInterval(() => {
      this.flushMeasurements();
    }, this.flushInterval);
  }

  /**
   * Start measuring an operation
   */
  public startOperation(name: string, metadata: OperationMetadata): void {
    if (!this.isEnabled) return;

    try {
      const startTime = performance.now();
      const memoryBefore = this.getMemoryUsage();

      // Store operation details
      this.activeOperations.set(name, {
        startTime,
        metadata,
        memoryBefore
      });

      // Create performance mark
      if (typeof performance.mark === 'function') {
        performance.mark(`${name}-start`);
      }

      this.logger.debug(`Started operation: ${name}`, {
        component: metadata.component,
        action: 'performance_start',
        metadata: {
          operationType: metadata.operationType,
          inputSize: metadata.inputSize,
          memoryBefore
        }
      });
    } catch (error) {
      this.logger.error(`Failed to start operation: ${name}`, {
        component: metadata.component,
        action: 'performance_start_error'
      }, error as Error);
    }
  }

  /**
   * End measuring an operation
   */
  public endOperation(name: string, additionalMetadata?: Partial<OperationMetadata>): PerformanceMeasurement | null {
    if (!this.isEnabled) return null;

    try {
      const operation = this.activeOperations.get(name);
      if (!operation) {
        this.logger.warn(`Operation not found: ${name}`, {
          component: ComponentType.ERROR_HANDLER,
          action: 'performance_end_not_found'
        });
        return null;
      }

      const endTime = performance.now();
      const duration = endTime - operation.startTime;
      const memoryAfter = this.getMemoryUsage();
      const memoryDelta = operation.memoryBefore !== undefined && memoryAfter !== undefined
        ? memoryAfter - operation.memoryBefore
        : undefined;

      // Create performance mark and measure
      if (typeof performance.mark === 'function' && typeof performance.measure === 'function') {
        performance.mark(`${name}-end`);
        performance.measure(name, `${name}-start`, `${name}-end`);
      }

      // Combine metadata
      const finalMetadata: OperationMetadata = {
        ...operation.metadata,
        ...additionalMetadata,
        memoryBefore: operation.memoryBefore,
        memoryAfter
      };

      // Determine if operation is slow
      const threshold = this.getThreshold(finalMetadata.operationType, finalMetadata.component);
      const isSlowOperation = duration > threshold;

      // Create measurement record
      const measurement: PerformanceMeasurement = {
        name,
        duration,
        startTime: operation.startTime,
        endTime,
        metadata: finalMetadata,
        isSlowOperation,
        threshold,
        memoryDelta,
        timestamp: new Date().toISOString()
      };

      // Store measurement
      this.measurements.push(measurement);
      this.activeOperations.delete(name);

      // Log performance data
      const logLevel = isSlowOperation ? LogLevel.WARN : LogLevel.DEBUG;
      const performanceData: PerformanceData = {
        duration,
        memoryUsage: memoryAfter,
        timing: {
          start: operation.startTime,
          end: endTime
        },
        marks: [`${name}-start`, `${name}-end`],
        measures: [{ name, duration }]
      };

      this.logger.log(logLevel, `Operation completed: ${name}`, {
        component: finalMetadata.component,
        action: isSlowOperation ? 'performance_slow' : 'performance_complete',
        performance: performanceData,
        metadata: {
          operationType: finalMetadata.operationType,
          isSlowOperation,
          threshold,
          memoryDelta,
          ...finalMetadata.customData
        }
      });

      // Handle slow operations
      if (isSlowOperation) {
        this.handleSlowOperation(measurement);
      }

      // Enforce measurement limits
      this.enforceLimits();

      return measurement;
    } catch (error) {
      this.logger.error(`Failed to end operation: ${name}`, {
        component: ComponentType.ERROR_HANDLER,
        action: 'performance_end_error'
      }, error as Error);
      return null;
    }
  }

  /**
   * Measure an async operation with automatic timing
   */
  public async measureAsync<T>(
    name: string,
    operation: () => Promise<T>,
    metadata: OperationMetadata
  ): Promise<T> {
    this.startOperation(name, metadata);
    
    try {
      const result = await operation();
      
      // Add result metadata if possible
      const resultSize = this.estimateSize(result);
      this.endOperation(name, {
        outputSize: resultSize,
        customData: { success: true }
      });
      
      return result;
    } catch (error) {
      this.endOperation(name, {
        customData: { success: false, error: (error as Error).message }
      });
      throw error;
    }
  }

  /**
   * Measure a synchronous operation with automatic timing
   */
  public measureSync<T>(
    name: string,
    operation: () => T,
    metadata: OperationMetadata
  ): T {
    this.startOperation(name, metadata);
    
    try {
      const result = operation();
      
      // Add result metadata if possible
      const resultSize = this.estimateSize(result);
      this.endOperation(name, {
        outputSize: resultSize,
        customData: { success: true }
      });
      
      return result;
    } catch (error) {
      this.endOperation(name, {
        customData: { success: false, error: (error as Error).message }
      });
      throw error;
    }
  }

  /**
   * Get current memory usage (if available)
   */
  private getMemoryUsage(): number | undefined {
    try {
      // Try to get memory info from performance API
      if ('memory' in performance) {
        const memory = (performance as any).memory;
        return memory.usedJSHeapSize;
      }
      
      // Fallback: estimate based on active operations and measurements
      return this.activeOperations.size * 1024 + this.measurements.length * 512;
    } catch {
      return undefined;
    }
  }

  /**
   * Estimate size of data for performance tracking
   */
  private estimateSize(data: any): number {
    try {
      if (typeof data === 'string') {
        return data.length * 2; // UTF-16 encoding
      }
      if (data instanceof ArrayBuffer) {
        return data.byteLength;
      }
      if (Array.isArray(data)) {
        return data.length * 8; // Rough estimate
      }
      if (typeof data === 'object' && data !== null) {
        return JSON.stringify(data).length * 2;
      }
      return 8; // Primitive types
    } catch {
      return 0;
    }
  }

  /**
   * Get performance threshold for operation type and component
   */
  private getThreshold(operationType: string, component: ComponentType): number {
    // Map operation types to threshold categories
    if (operationType.includes('storage') || operationType.includes('cache')) {
      return operationType.includes('write') ? this.thresholds.storage.write : this.thresholds.storage.read;
    }
    
    if (operationType.includes('fetch') || operationType.includes('network') || operationType.includes('api')) {
      return operationType.includes('retry') ? this.thresholds.network.retry : this.thresholds.network.fetch;
    }
    
    if (operationType.includes('render') || operationType.includes('ui') || operationType.includes('dom')) {
      return operationType.includes('interaction') ? this.thresholds.ui.interaction : this.thresholds.ui.render;
    }
    
    if (operationType.includes('youtube') || operationType.includes('player')) {
      return operationType.includes('subtitle') ? this.thresholds.youtube.subtitleParse : this.thresholds.youtube.playerQuery;
    }
    
    if (operationType.includes('translation') || operationType.includes('translate')) {
      return operationType.includes('cache') ? this.thresholds.translation.cache : this.thresholds.translation.translate;
    }
    
    // Default threshold based on component
    switch (component) {
      case ComponentType.STORAGE_SERVICE:
        return this.thresholds.storage.read;
      case ComponentType.TRANSLATION_SERVICE:
        return this.thresholds.translation.translate;
      case ComponentType.YOUTUBE_INTEGRATION:
        return this.thresholds.youtube.playerQuery;
      default:
        return 100; // Default 100ms threshold
    }
  }

  /**
   * Handle slow operations with additional logging and analysis
   */
  private handleSlowOperation(measurement: PerformanceMeasurement): void {
    this.logger.warn(`Slow operation detected: ${measurement.name}`, {
      component: measurement.metadata.component,
      action: 'slow_operation_detected',
      performance: {
        duration: measurement.duration,
        timing: {
          start: measurement.startTime,
          end: measurement.endTime
        }
      },
      metadata: {
        operationType: measurement.metadata.operationType,
        threshold: measurement.threshold,
        exceedBy: measurement.duration - measurement.threshold,
        memoryDelta: measurement.memoryDelta,
        inputSize: measurement.metadata.inputSize,
        outputSize: measurement.metadata.outputSize,
        retryCount: measurement.metadata.retryCount,
        networkState: measurement.metadata.networkState
      }
    });

    // Additional analysis for critical slow operations
    if (measurement.duration > measurement.threshold * 3) {
      this.logger.error(`Critical slow operation: ${measurement.name}`, {
        component: measurement.metadata.component,
        action: 'critical_slow_operation',
        metadata: {
          duration: measurement.duration,
          threshold: measurement.threshold,
          severity: 'critical'
        }
      });
    }
  }

  /**
   * Enforce measurement storage limits
   */
  private enforceLimits(): void {
    if (this.measurements.length > this.maxMeasurements) {
      // Keep only the most recent measurements
      const excess = this.measurements.length - this.maxMeasurements;
      this.measurements.splice(0, excess);
      
      this.logger.debug('Performance measurement limit enforced', {
        component: ComponentType.ERROR_HANDLER,
        action: 'performance_limit_enforced',
        metadata: {
          removed: excess,
          remaining: this.measurements.length
        }
      });
    }
  }

  /**
   * Flush measurements to persistent storage
   */
  private async flushMeasurements(): Promise<void> {
    if (this.measurements.length === 0) return;

    try {
      // Prepare analytics data
      const analytics = this.generateAnalytics();
      
      // Log analytics summary
      this.logger.info('Performance analytics', {
        component: ComponentType.ERROR_HANDLER,
        action: 'performance_analytics',
        metadata: {
          totalOperations: analytics.totalOperations,
          slowOperations: analytics.slowOperations,
          averageDuration: analytics.averageDuration,
          p95Duration: analytics.p95Duration,
          memoryStats: analytics.memoryStats
        }
      });

      // Store in Chrome storage for persistence
      try {
        const storageKey = `performance_data_${Date.now()}`;
        await chrome.storage.local.set({
          [storageKey]: {
            analytics,
            measurements: this.measurements.slice(-100), // Keep last 100 measurements
            timestamp: new Date().toISOString()
          }
        });
      } catch (storageError) {
        this.logger.warn('Failed to store performance data', {
          component: ComponentType.ERROR_HANDLER,
          action: 'performance_storage_error'
        });
      }

      // Clear measurements after flush
      this.measurements = [];
    } catch (error) {
      this.logger.error('Failed to flush performance measurements', {
        component: ComponentType.ERROR_HANDLER,
        action: 'performance_flush_error'
      }, error as Error);
    }
  }

  /**
   * Generate performance analytics from current measurements
   */
  public generateAnalytics(): PerformanceAnalytics {
    if (this.measurements.length === 0) {
      return {
        totalOperations: 0,
        slowOperations: 0,
        averageDuration: 0,
        p95Duration: 0,
        p99Duration: 0,
        operationsByType: {},
        memoryStats: {
          averageUsage: 0,
          peakUsage: 0,
          totalAllocated: 0
        },
        timeRange: {
          start: new Date().toISOString(),
          end: new Date().toISOString()
        }
      };
    }

    const durations = this.measurements.map(m => m.duration).sort((a, b) => a - b);
    const slowOperations = this.measurements.filter(m => m.isSlowOperation).length;
    
    // Calculate percentiles
    const p95Index = Math.floor(durations.length * 0.95);
    const p99Index = Math.floor(durations.length * 0.99);
    
    // Group by operation type
    const operationsByType: Record<string, { count: number; avgDuration: number; slowCount: number }> = {};
    
    for (const measurement of this.measurements) {
      const type = measurement.metadata.operationType;
      if (!operationsByType[type]) {
        operationsByType[type] = { count: 0, avgDuration: 0, slowCount: 0 };
      }
      
      operationsByType[type].count++;
      operationsByType[type].avgDuration = 
        (operationsByType[type].avgDuration * (operationsByType[type].count - 1) + measurement.duration) / 
        operationsByType[type].count;
      
      if (measurement.isSlowOperation) {
        operationsByType[type].slowCount++;
      }
    }

    // Memory statistics
    const memoryUsages = this.measurements
      .map(m => m.metadata.memoryAfter)
      .filter((usage): usage is number => usage !== undefined);
    
    const memoryStats = {
      averageUsage: memoryUsages.length > 0 ? memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length : 0,
      peakUsage: memoryUsages.length > 0 ? Math.max(...memoryUsages) : 0,
      totalAllocated: this.measurements
        .map(m => m.memoryDelta)
        .filter((delta): delta is number => delta !== undefined && delta > 0)
        .reduce((total, delta) => total + delta, 0)
    };

    return {
      totalOperations: this.measurements.length,
      slowOperations,
      averageDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      p95Duration: durations[p95Index] || 0,
      p99Duration: durations[p99Index] || 0,
      operationsByType,
      memoryStats,
      timeRange: {
        start: this.measurements[0].timestamp,
        end: this.measurements[this.measurements.length - 1].timestamp
      }
    };
  }

  /**
   * Update performance thresholds
   */
  public updateThresholds(newThresholds: Partial<PerformanceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    
    this.logger.info('Performance thresholds updated', {
      component: ComponentType.ERROR_HANDLER,
      action: 'performance_thresholds_updated',
      metadata: { thresholds: this.thresholds }
    });
  }

  /**
   * Enable or disable performance monitoring
   */
  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    
    this.logger.info(`Performance monitoring ${enabled ? 'enabled' : 'disabled'}`, {
      component: ComponentType.ERROR_HANDLER,
      action: 'performance_monitoring_toggle',
      metadata: { enabled }
    });
  }

  /**
   * Get current performance statistics
   */
  public getStats(): {
    activeOperations: number;
    totalMeasurements: number;
    isEnabled: boolean;
    thresholds: PerformanceThresholds;
  } {
    return {
      activeOperations: this.activeOperations.size,
      totalMeasurements: this.measurements.length,
      isEnabled: this.isEnabled,
      thresholds: this.thresholds
    };
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    // Clear timers
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Disconnect memory observer
    if (this.memoryObserver) {
      this.memoryObserver.disconnect();
      this.memoryObserver = null;
    }

    // Final flush
    this.flushMeasurements();

    // Clear data
    this.activeOperations.clear();
    this.measurements = [];

    this.logger.info('PerformanceMonitor destroyed', {
      component: ComponentType.ERROR_HANDLER,
      action: 'performance_monitor_destroy'
    });

    PerformanceMonitor.instance = null;
  }
}

/**
 * Convenience decorator for automatic performance monitoring
 */
export function measurePerformance(
  operationType: string,
  component: ComponentType,
  metadata?: Partial<OperationMetadata>
) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const method = descriptor.value!;
    
    descriptor.value = (async function (this: any, ...args: any[]) {
      const monitor = PerformanceMonitor.getInstance();
      const operationName = `${target.constructor.name}.${propertyName}`;
      
      const operationMetadata: OperationMetadata = {
        operationType,
        component,
        inputSize: monitor['estimateSize'](args),
        ...metadata
      };
      
      if (method.constructor.name === 'AsyncFunction') {
        return monitor.measureAsync(operationName, () => method.apply(this, args), operationMetadata);
      } else {
        return monitor.measureSync(operationName, () => method.apply(this, args), operationMetadata);
      }
    }) as any;
    
    return descriptor;
  };
} 