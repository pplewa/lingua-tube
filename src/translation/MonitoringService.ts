// Comprehensive usage tracking and monitoring service for Microsoft Translator API
// Provides metrics collection, performance monitoring, error tracking, and analytics

import { TranslationErrorCode, ServiceMetrics } from './types'
import { configService } from './ConfigService'
import { translationCacheService } from './TranslationCacheService'
import { rateLimitService } from './RateLimitService'


// ============================================================================
// Monitoring Types
// ============================================================================

export interface RequestMetrics {
  id: string
  timestamp: number
  operation: string
  service: string
  method: string
  status: 'success' | 'error' | 'timeout' | 'cancelled'
  responseTime: number
  characterCount: number
  fromLanguage?: string
  toLanguage?: string
  errorCode?: TranslationErrorCode
  errorMessage?: string
  cacheHit: boolean
  retryCount: number
  batchSize?: number
  userId?: string
}

export interface PerformanceMetrics {
  averageResponseTime: number
  medianResponseTime: number
  p95ResponseTime: number
  p99ResponseTime: number
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  requestsPerSecond: number
  charactersPerSecond: number
  errorRate: number
  timeoutRate: number
  lastUpdated: number
}

export interface ServiceHealthMetrics {
  service: string
  status: 'healthy' | 'degraded' | 'unhealthy' | 'critical'
  uptime: number
  availability: number // percentage
  lastError?: {
    timestamp: number
    message: string
    code: TranslationErrorCode
  }
  metrics: {
    requestCount: number
    errorCount: number
    averageResponseTime: number
    lastRequestTime: number
  }
}

export interface CacheMetrics {
  totalRequests: number
  hits: number
  misses: number
  hitRate: number
  totalEntries: number
  totalSize: number
  averageEntrySize: number
  compressionRatio: number
  evictions: number
  lastCleanup: number
}

export interface UsageAnalytics {
  period: 'hour' | 'day' | 'week' | 'month'
  startTime: number
  endTime: number
  metrics: {
    totalRequests: number
    totalCharacters: number
    uniqueLanguagePairs: number
    mostTranslatedLanguages: Array<{
      language: string
      count: number
      percentage: number
    }>
    peakUsageHour: {
      hour: number
      requestCount: number
    }
    averageRequestsPerHour: number
    averageCharactersPerRequest: number
  }
  performance: PerformanceMetrics
  errors: {
    totalErrors: number
    errorsByType: Record<string, number>
    mostCommonError: {
      code: TranslationErrorCode
      count: number
      percentage: number
    }
  }
}

export interface AlertRule {
  id: string
  name: string
  metric: string
  condition: 'greater_than' | 'less_than' | 'equals'
  threshold: number
  timeWindow: number // seconds
  enabled: boolean
  lastTriggered?: number
  notificationMethods: ('console' | 'storage' | 'callback')[]
}

export interface AlertEvent {
  id: string
  ruleId: string
  ruleName: string
  timestamp: number
  metric: string
  currentValue: number
  threshold: number
  message: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

// ============================================================================
// Monitoring Service
// ============================================================================

export class MonitoringService {
  private requestHistory: RequestMetrics[] = []
  private performanceMetrics: PerformanceMetrics | null = null
  private serviceHealthMetrics: Map<string, ServiceHealthMetrics> = new Map()
  private usageAnalytics: Map<string, UsageAnalytics> = new Map()
  private alertRules: Map<string, AlertRule> = new Map()
  private alertHistory: AlertEvent[] = []
  private metricsUpdateTimer: number | null = null
  private analyticsUpdateTimer: number | null = null
  private isInitialized = false

  // Configuration constants
  private readonly MAX_REQUEST_HISTORY = 10000
  private readonly MAX_ALERT_HISTORY = 1000
  private readonly METRICS_UPDATE_INTERVAL = 30000 // 30 seconds
  private readonly ANALYTICS_UPDATE_INTERVAL = 300000 // 5 minutes
  private readonly PERFORMANCE_CALCULATION_WINDOW = 3600000 // 1 hour


  // Storage keys
  private readonly STORAGE_KEYS = {
    REQUEST_METRICS: 'translation_request_metrics',
    PERFORMANCE_METRICS: 'translation_performance_metrics',
    SERVICE_HEALTH: 'translation_service_health',
    USAGE_ANALYTICS: 'translation_usage_analytics',
    ALERT_RULES: 'translation_alert_rules',
    ALERT_HISTORY: 'translation_alert_history',
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the monitoring service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      await this.loadStoredData()
      this.initializeServiceHealth()
      this.setupDefaultAlertRules()
      this.startPeriodicUpdates()
      this.isInitialized = true

      console.log('Monitoring service initialized successfully')
    } catch (error) {
      console.error('Failed to initialize monitoring service:', error)
      throw error
    }
  }

  /**
   * Load stored data from Chrome storage
   */
  private async loadStoredData(): Promise<void> {
    try {
      const result = await chrome.storage.local.get([
        this.STORAGE_KEYS.REQUEST_METRICS,
        this.STORAGE_KEYS.PERFORMANCE_METRICS,
        this.STORAGE_KEYS.SERVICE_HEALTH,
        this.STORAGE_KEYS.USAGE_ANALYTICS,
        this.STORAGE_KEYS.ALERT_RULES,
        this.STORAGE_KEYS.ALERT_HISTORY,
      ])

      // Load request history
      if (result[this.STORAGE_KEYS.REQUEST_METRICS]) {
        this.requestHistory = result[this.STORAGE_KEYS.REQUEST_METRICS]
        // Clean old entries
        this.cleanOldRequestHistory()
      }

      // Load performance metrics
      if (result[this.STORAGE_KEYS.PERFORMANCE_METRICS]) {
        this.performanceMetrics = result[this.STORAGE_KEYS.PERFORMANCE_METRICS]
      }

      // Load service health
      if (result[this.STORAGE_KEYS.SERVICE_HEALTH]) {
        this.serviceHealthMetrics = new Map(
          Object.entries(result[this.STORAGE_KEYS.SERVICE_HEALTH]),
        )
      }

      // Load usage analytics
      if (result[this.STORAGE_KEYS.USAGE_ANALYTICS]) {
        this.usageAnalytics = new Map(Object.entries(result[this.STORAGE_KEYS.USAGE_ANALYTICS]))
      }

      // Load alert rules
      if (result[this.STORAGE_KEYS.ALERT_RULES]) {
        this.alertRules = new Map(Object.entries(result[this.STORAGE_KEYS.ALERT_RULES]))
      }

      // Load alert history
      if (result[this.STORAGE_KEYS.ALERT_HISTORY]) {
        this.alertHistory = result[this.STORAGE_KEYS.ALERT_HISTORY]
        // Clean old alerts
        this.cleanOldAlertHistory()
      }
    } catch (error) {
      console.warn('Failed to load stored monitoring data:', error)
      // Continue with empty state
    }
  }

  /**
   * Initialize service health monitoring
   */
  private initializeServiceHealth(): void {
    const services = ['translation', 'rateLimit', 'cache', 'batch', 'errorHandling']

    for (const service of services) {
      if (!this.serviceHealthMetrics.has(service)) {
        this.serviceHealthMetrics.set(service, {
          service,
          status: 'healthy',
          uptime: Date.now(),
          availability: 100,
          metrics: {
            requestCount: 0,
            errorCount: 0,
            averageResponseTime: 0,
            lastRequestTime: 0,
          },
        })
      }
    }
  }

  /**
   * Setup default alert rules
   */
  private setupDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_error_rate',
        name: 'High Error Rate',
        metric: 'errorRate',
        condition: 'greater_than',
        threshold: 0.1, // 10%
        timeWindow: 300, // 5 minutes
        enabled: true,
        notificationMethods: ['console', 'storage'],
      },
      {
        id: 'slow_response_time',
        name: 'Slow Response Time',
        metric: 'averageResponseTime',
        condition: 'greater_than',
        threshold: 5000, // 5 seconds
        timeWindow: 600, // 10 minutes
        enabled: true,
        notificationMethods: ['console', 'storage'],
      },
      {
        id: 'quota_threshold',
        name: 'Quota Usage Threshold',
        metric: 'quotaUsage',
        condition: 'greater_than',
        threshold: 0.8, // 80%
        timeWindow: 3600, // 1 hour
        enabled: true,
        notificationMethods: ['console', 'storage'],
      },
      {
        id: 'cache_miss_rate',
        name: 'High Cache Miss Rate',
        metric: 'cacheMissRate',
        condition: 'greater_than',
        threshold: 0.7, // 70%
        timeWindow: 1800, // 30 minutes
        enabled: true,
        notificationMethods: ['console'],
      },
    ]

    for (const rule of defaultRules) {
      if (!this.alertRules.has(rule.id)) {
        this.alertRules.set(rule.id, rule)
      }
    }
  }

  /**
   * Start periodic updates
   */
  private startPeriodicUpdates(): void {
    // Update performance metrics
    this.metricsUpdateTimer = setInterval(() => {
      this.updatePerformanceMetrics()
      this.updateServiceHealth()
      this.checkAlertRules()
    }, this.METRICS_UPDATE_INTERVAL) as any

    // Update analytics
    this.analyticsUpdateTimer = setInterval(() => {
      this.updateUsageAnalytics()
      this.saveDataToStorage()
    }, this.ANALYTICS_UPDATE_INTERVAL) as any

    // Initial update
    this.updatePerformanceMetrics()
    this.updateServiceHealth()
  }

  // --------------------------------------------------------------------------
  // Request Tracking
  // --------------------------------------------------------------------------

  /**
   * Record a translation request
   */
  async recordRequest(metrics: Omit<RequestMetrics, 'id' | 'timestamp'>): Promise<string> {
    await this.ensureInitialized()

    const requestId = this.generateRequestId()
    const requestMetrics: RequestMetrics = {
      id: requestId,
      timestamp: Date.now(),
      ...metrics,
    }

    // Add to history
    this.requestHistory.unshift(requestMetrics)

    // Limit history size
    if (this.requestHistory.length > this.MAX_REQUEST_HISTORY) {
      this.requestHistory = this.requestHistory.slice(0, this.MAX_REQUEST_HISTORY)
    }

    // Update service health
    this.updateServiceHealthFromRequest(requestMetrics)

    // Trigger immediate metrics update for important events
    if (requestMetrics.status === 'error' || requestMetrics.responseTime > 10000) {
      this.updatePerformanceMetrics()
      await this.checkAlertRules()
    }

    return requestId
  }

  /**
   * Record a cache operation
   */
  async recordCacheOperation(
    operation: 'hit' | 'miss' | 'set' | 'eviction',
    key: string,
    size?: number,
  ): Promise<void> {
    await this.ensureInitialized()

    const metrics: Omit<RequestMetrics, 'id' | 'timestamp'> = {
      operation: `cache_${operation}`,
      service: 'cache',
      method: operation.toUpperCase(),
      status: 'success',
      responseTime: 1, // Cache operations are typically very fast
      characterCount: size || 0,
      cacheHit: operation === 'hit',
      retryCount: 0,
    }

    await this.recordRequest(metrics)
  }

  /**
   * Update service health from request
   */
  private updateServiceHealthFromRequest(request: RequestMetrics): void {
    const serviceHealth = this.serviceHealthMetrics.get(request.service)
    if (!serviceHealth) return

    serviceHealth.metrics.requestCount++
    serviceHealth.metrics.lastRequestTime = request.timestamp

    if (request.status === 'error') {
      serviceHealth.metrics.errorCount++
      serviceHealth.lastError = {
        timestamp: request.timestamp,
        message: request.errorMessage || 'Unknown error',
        code: request.errorCode || TranslationErrorCode.UNKNOWN_ERROR,
      }
    }

    // Update response time (running average)
    const totalRequests = serviceHealth.metrics.requestCount
    const currentAvg = serviceHealth.metrics.averageResponseTime
    serviceHealth.metrics.averageResponseTime =
      (currentAvg * (totalRequests - 1) + request.responseTime) / totalRequests
  }

  // --------------------------------------------------------------------------
  // Performance Metrics
  // --------------------------------------------------------------------------

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(): void {
    const now = Date.now()
    const windowStart = now - this.PERFORMANCE_CALCULATION_WINDOW

    // Filter requests within the calculation window
    const recentRequests = this.requestHistory.filter(
      (r) => r.timestamp >= windowStart && r.operation.startsWith('translate'),
    )

    if (recentRequests.length === 0) {
      return
    }

    // Calculate response time statistics
    const responseTimes = recentRequests.map((r) => r.responseTime).sort((a, b) => a - b)
    const successfulRequests = recentRequests.filter((r) => r.status === 'success')
    const failedRequests = recentRequests.filter((r) => r.status === 'error')
    const timeoutRequests = recentRequests.filter((r) => r.status === 'timeout')

    const totalCharacters = recentRequests.reduce((sum, r) => sum + r.characterCount, 0)
    const windowDurationSeconds = this.PERFORMANCE_CALCULATION_WINDOW / 1000

    this.performanceMetrics = {
      averageResponseTime: responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length || 0,
      medianResponseTime: this.calculatePercentile(responseTimes, 0.5),
      p95ResponseTime: this.calculatePercentile(responseTimes, 0.95),
      p99ResponseTime: this.calculatePercentile(responseTimes, 0.99),
      totalRequests: recentRequests.length,
      successfulRequests: successfulRequests.length,
      failedRequests: failedRequests.length,
      requestsPerSecond: recentRequests.length / windowDurationSeconds,
      charactersPerSecond: totalCharacters / windowDurationSeconds,
      errorRate: failedRequests.length / recentRequests.length,
      timeoutRate: timeoutRequests.length / recentRequests.length,
      lastUpdated: now,
    }
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0

    const index = Math.ceil(sortedArray.length * percentile) - 1
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))]
  }

  // --------------------------------------------------------------------------
  // Service Health
  // --------------------------------------------------------------------------

  /**
   * Update service health metrics
   */
  private updateServiceHealth(): void {
    const now = Date.now()
    const fiveMinutesAgo = now - 5 * 60 * 1000

    for (const [serviceName, health] of this.serviceHealthMetrics.entries()) {
      const recentRequests = this.requestHistory.filter(
        (r) => r.service === serviceName && r.timestamp >= fiveMinutesAgo,
      )

      if (recentRequests.length === 0) continue

      const errorRequests = recentRequests.filter((r) => r.status === 'error')
      const errorRate = errorRequests.length / recentRequests.length

      // Determine health status
      if (errorRate > 0.5) {
        health.status = 'critical'
      } else if (errorRate > 0.2) {
        health.status = 'unhealthy'
      } else if (errorRate > 0.1) {
        health.status = 'degraded'
      } else {
        health.status = 'healthy'
      }

      // Calculate availability (percentage of time service was responsive)
      const uptimePeriod = now - health.uptime
      const totalDowntime = errorRequests.reduce((sum, r) => sum + r.responseTime, 0)
      health.availability = Math.max(0, 100 - (totalDowntime / uptimePeriod) * 100)
    }
  }

  // --------------------------------------------------------------------------
  // Usage Analytics
  // --------------------------------------------------------------------------

  /**
   * Update usage analytics
   */
  private updateUsageAnalytics(): void {
    const periods: Array<'hour' | 'day' | 'week' | 'month'> = ['hour', 'day', 'week', 'month']

    for (const period of periods) {
      const analytics = this.calculateUsageAnalytics(period)
      this.usageAnalytics.set(period, analytics)
    }
  }

  /**
   * Calculate usage analytics for a specific period
   */
  private calculateUsageAnalytics(period: 'hour' | 'day' | 'week' | 'month'): UsageAnalytics {
    const now = Date.now()
    let startTime: number

    switch (period) {
      case 'hour':
        startTime = now - 60 * 60 * 1000
        break
      case 'day':
        startTime = now - 24 * 60 * 60 * 1000
        break
      case 'week':
        startTime = now - 7 * 24 * 60 * 60 * 1000
        break
      case 'month':
        startTime = now - 30 * 24 * 60 * 60 * 1000
        break
    }

    const periodRequests = this.requestHistory.filter(
      (r) => r.timestamp >= startTime && r.operation.startsWith('translate'),
    )

    // Calculate language statistics
    const languagePairs = new Map<string, number>()
    const languageUsage = new Map<string, number>()

    for (const request of periodRequests) {
      if (request.fromLanguage && request.toLanguage) {
        const pair = `${request.fromLanguage}->${request.toLanguage}`
        languagePairs.set(pair, (languagePairs.get(pair) || 0) + 1)
        languageUsage.set(request.toLanguage, (languageUsage.get(request.toLanguage) || 0) + 1)
      }
    }

    // Calculate hourly distribution
    const hourlyRequests = new Map<number, number>()
    for (const request of periodRequests) {
      const hour = new Date(request.timestamp).getHours()
      hourlyRequests.set(hour, (hourlyRequests.get(hour) || 0) + 1)
    }

    const peakHour = Array.from(hourlyRequests.entries()).sort((a, b) => b[1] - a[1])[0] || [0, 0]

    // Calculate error statistics
    const errorRequests = periodRequests.filter((r) => r.status === 'error')
    const errorsByType = new Map<TranslationErrorCode, number>()

    for (const request of errorRequests) {
      if (request.errorCode) {
        errorsByType.set(request.errorCode, (errorsByType.get(request.errorCode) || 0) + 1)
      }
    }

    const mostCommonErrorEntry = Array.from(errorsByType.entries()).sort((a, b) => b[1] - a[1])[0]

    const totalCharacters = periodRequests.reduce((sum, r) => sum + r.characterCount, 0)
    const periodDurationHours = (now - startTime) / (60 * 60 * 1000)

    return {
      period,
      startTime,
      endTime: now,
      metrics: {
        totalRequests: periodRequests.length,
        totalCharacters,
        uniqueLanguagePairs: languagePairs.size,
        mostTranslatedLanguages: Array.from(languageUsage.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([language, count]) => ({
            language,
            count,
            percentage: (count / periodRequests.length) * 100,
          })),
        peakUsageHour: {
          hour: peakHour[0],
          requestCount: peakHour[1],
        },
        averageRequestsPerHour: periodRequests.length / periodDurationHours,
        averageCharactersPerRequest: totalCharacters / Math.max(1, periodRequests.length),
      },
      performance: this.performanceMetrics || this.getEmptyPerformanceMetrics(),
      errors: {
        totalErrors: errorRequests.length,
        errorsByType: Object.fromEntries(errorsByType.entries()),
        mostCommonError: mostCommonErrorEntry
          ? {
              code: mostCommonErrorEntry[0],
              count: mostCommonErrorEntry[1],
              percentage: (mostCommonErrorEntry[1] / errorRequests.length) * 100,
            }
          : {
              code: TranslationErrorCode.UNKNOWN_ERROR,
              count: 0,
              percentage: 0,
            },
      },
    }
  }

  // --------------------------------------------------------------------------
  // Alerting
  // --------------------------------------------------------------------------

  /**
   * Check alert rules and trigger alerts
   */
  private async checkAlertRules(): Promise<void> {
    if (!this.performanceMetrics) return

    const now = Date.now()

    for (const [ruleId, rule] of this.alertRules.entries()) {
      if (!rule.enabled) continue

      // Check if enough time has passed since last trigger
      if (rule.lastTriggered && now - rule.lastTriggered < rule.timeWindow * 1000) {
        continue
      }

      let currentValue: number
      let shouldTrigger = false

      // Get current metric value
      switch (rule.metric) {
        case 'errorRate':
          currentValue = this.performanceMetrics.errorRate
          break
        case 'averageResponseTime':
          currentValue = this.performanceMetrics.averageResponseTime
          break
        case 'quotaUsage':
          currentValue = await this.getQuotaUsage()
          break
        case 'cacheMissRate':
          currentValue = await this.getCacheMissRate()
          break
        default:
          continue
      }

      // Check condition
      switch (rule.condition) {
        case 'greater_than':
          shouldTrigger = currentValue > rule.threshold
          break
        case 'less_than':
          shouldTrigger = currentValue < rule.threshold
          break
        case 'equals':
          shouldTrigger = Math.abs(currentValue - rule.threshold) < 0.001
          break
      }

      if (shouldTrigger) {
        await this.triggerAlert(rule, currentValue)
      }
    }
  }

  /**
   * Trigger an alert
   */
  private async triggerAlert(rule: AlertRule, currentValue: number): Promise<void> {
    const alertEvent: AlertEvent = {
      id: this.generateAlertId(),
      ruleId: rule.id,
      ruleName: rule.name,
      timestamp: Date.now(),
      metric: rule.metric,
      currentValue,
      threshold: rule.threshold,
      message: `${rule.name}: ${rule.metric} (${currentValue.toFixed(3)}) ${rule.condition.replace('_', ' ')} ${rule.threshold}`,
      severity: this.determineSeverity(rule.metric, currentValue, rule.threshold),
    }

    // Add to history
    this.alertHistory.unshift(alertEvent)
    if (this.alertHistory.length > this.MAX_ALERT_HISTORY) {
      this.alertHistory = this.alertHistory.slice(0, this.MAX_ALERT_HISTORY)
    }

    // Update rule
    rule.lastTriggered = alertEvent.timestamp

    // Send notifications
    for (const method of rule.notificationMethods) {
      await this.sendNotification(method, alertEvent)
    }
  }

  /**
   * Determine alert severity
   */
  private determineSeverity(
    metric: string,
    value: number,
    threshold: number,
  ): AlertEvent['severity'] {
    const ratio = value / threshold

    switch (metric) {
      case 'errorRate':
        if (ratio > 3) return 'critical'
        if (ratio > 2) return 'high'
        if (ratio > 1.5) return 'medium'
        return 'low'

      case 'averageResponseTime':
        if (ratio > 4) return 'critical'
        if (ratio > 2.5) return 'high'
        if (ratio > 1.5) return 'medium'
        return 'low'

      default:
        if (ratio > 2) return 'high'
        if (ratio > 1.5) return 'medium'
        return 'low'
    }
  }

  /**
   * Send notification
   */
  private async sendNotification(method: string, alert: AlertEvent): Promise<void> {
    switch (method) {
      case 'console':
        console.warn(`[ALERT ${alert.severity.toUpperCase()}] ${alert.message}`)
        break

      case 'storage':
        // Save alert to storage for dashboard display
        await this.saveDataToStorage()
        break

      case 'callback':
        // Could integrate with external monitoring systems
        // this.notificationCallback?.(alert);
        break
    }
  }

  // --------------------------------------------------------------------------
  // Cache Metrics
  // --------------------------------------------------------------------------

  /**
   * Get cache metrics
   */
  async getCacheMetrics(): Promise<CacheMetrics> {
    try {
      const cacheStats = await translationCacheService.getStats()

      const totalRequests = cacheStats.hits + cacheStats.misses
      const averageEntrySize =
        cacheStats.totalEntries > 0 ? cacheStats.totalSize / cacheStats.totalEntries : 0

      return {
        totalRequests,
        hits: cacheStats.hits || 0,
        misses: cacheStats.misses || 0,
        hitRate: cacheStats.hitRate || 0,
        totalEntries: cacheStats.totalEntries || 0,
        totalSize: cacheStats.totalSize || 0,
        averageEntrySize,
        compressionRatio: cacheStats.compressionSavings || 0,
        evictions: cacheStats.evictions || 0,
        lastCleanup: 0, // Not available in cache stats, would need separate call
      }
    } catch (error) {
      console.error('Failed to get cache metrics:', error)
      return {
        totalRequests: 0,
        hits: 0,
        misses: 0,
        hitRate: 0,
        totalEntries: 0,
        totalSize: 0,
        averageEntrySize: 0,
        compressionRatio: 0,
        evictions: 0,
        lastCleanup: 0,
      }
    }
  }

  // --------------------------------------------------------------------------
  // Data Access Methods
  // --------------------------------------------------------------------------

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics | null {
    return this.performanceMetrics
  }

  /**
   * Get service health status
   */
  getServiceHealth(): Map<string, ServiceHealthMetrics> {
    return new Map(this.serviceHealthMetrics)
  }

  /**
   * Get usage analytics
   */
  getUsageAnalytics(
    period?: 'hour' | 'day' | 'week' | 'month',
  ): UsageAnalytics | Map<string, UsageAnalytics> {
    if (period) {
      return this.usageAnalytics.get(period) || this.getEmptyUsageAnalytics(period)
    }
    return new Map(this.usageAnalytics)
  }

  /**
   * Get request history
   */
  getRequestHistory(limit?: number, service?: string): RequestMetrics[] {
    let history = this.requestHistory

    if (service) {
      history = history.filter((r) => r.service === service)
    }

    return history.slice(0, limit || 100)
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit?: number): AlertEvent[] {
    return this.alertHistory.slice(0, limit || 50)
  }

  /**
   * Get dashboard summary
   */
  async getDashboardSummary(): Promise<{
    performance: PerformanceMetrics | null
    serviceHealth: Record<string, ServiceHealthMetrics>
    cacheMetrics: CacheMetrics
    recentAlerts: AlertEvent[]
    dailyAnalytics: UsageAnalytics
  }> {
    await this.ensureInitialized()

    return {
      performance: this.performanceMetrics,
      serviceHealth: Object.fromEntries(this.serviceHealthMetrics.entries()),
      cacheMetrics: await this.getCacheMetrics(),
      recentAlerts: this.alertHistory.slice(0, 10),
      dailyAnalytics: this.usageAnalytics.get('day') || this.getEmptyUsageAnalytics('day'),
    }
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Get quota usage percentage
   */
  private async getQuotaUsage(): Promise<number> {
    try {
      const stats = await rateLimitService.getUsageStats()
      return stats.monthly.percentage / 100
    } catch (error) {
      return 0
    }
  }

  /**
   * Get cache miss rate
   */
  private async getCacheMissRate(): Promise<number> {
    try {
      const cacheMetrics = await this.getCacheMetrics()
      return cacheMetrics.totalRequests > 0 ? cacheMetrics.misses / cacheMetrics.totalRequests : 0
    } catch (error) {
      return 0
    }
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Generate unique alert ID
   */
  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Clean old request history
   */
  private cleanOldRequestHistory(): void {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000 // 7 days
    this.requestHistory = this.requestHistory.filter((r) => r.timestamp >= cutoff)
  }

  /**
   * Clean old alert history
   */
  private cleanOldAlertHistory(): void {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000 // 30 days
    this.alertHistory = this.alertHistory.filter((a) => a.timestamp >= cutoff)
  }

  /**
   * Get empty performance metrics
   */
  private getEmptyPerformanceMetrics(): PerformanceMetrics {
    return {
      averageResponseTime: 0,
      medianResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      requestsPerSecond: 0,
      charactersPerSecond: 0,
      errorRate: 0,
      timeoutRate: 0,
      lastUpdated: Date.now(),
    }
  }

  /**
   * Get empty usage analytics
   */
  private getEmptyUsageAnalytics(period: 'hour' | 'day' | 'week' | 'month'): UsageAnalytics {
    const now = Date.now()
    return {
      period,
      startTime: now,
      endTime: now,
      metrics: {
        totalRequests: 0,
        totalCharacters: 0,
        uniqueLanguagePairs: 0,
        mostTranslatedLanguages: [],
        peakUsageHour: { hour: 0, requestCount: 0 },
        averageRequestsPerHour: 0,
        averageCharactersPerRequest: 0,
      },
      performance: this.getEmptyPerformanceMetrics(),
      errors: {
        totalErrors: 0,
        errorsByType: {},
        mostCommonError: {
          code: TranslationErrorCode.UNKNOWN_ERROR,
          count: 0,
          percentage: 0,
        },
      },
    }
  }

  /**
   * Save data to Chrome storage
   */
  private async saveDataToStorage(): Promise<void> {
    try {
      const data = {
        [this.STORAGE_KEYS.REQUEST_METRICS]: this.requestHistory.slice(0, 1000), // Limit storage size
        [this.STORAGE_KEYS.PERFORMANCE_METRICS]: this.performanceMetrics,
        [this.STORAGE_KEYS.SERVICE_HEALTH]: Object.fromEntries(this.serviceHealthMetrics.entries()),
        [this.STORAGE_KEYS.USAGE_ANALYTICS]: Object.fromEntries(this.usageAnalytics.entries()),
        [this.STORAGE_KEYS.ALERT_RULES]: Object.fromEntries(this.alertRules.entries()),
        [this.STORAGE_KEYS.ALERT_HISTORY]: this.alertHistory.slice(0, 100), // Limit storage size
      }

      await chrome.storage.local.set(data)
    } catch (error) {
      console.error('Failed to save monitoring data to storage:', error)
    }
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize()
    }
  }

  /**
   * Clear all monitoring data
   */
  async clearAllData(): Promise<void> {
    this.requestHistory = []
    this.performanceMetrics = null
    this.serviceHealthMetrics.clear()
    this.usageAnalytics.clear()
    this.alertHistory = []

    // Keep alert rules but reset their state
    for (const rule of this.alertRules.values()) {
      delete rule.lastTriggered
    }

    await this.saveDataToStorage()
    this.initializeServiceHealth()
  }

  /**
   * Shutdown the monitoring service
   */
  async shutdown(): Promise<void> {
    if (this.metricsUpdateTimer) {
      clearInterval(this.metricsUpdateTimer)
      this.metricsUpdateTimer = null
    }

    if (this.analyticsUpdateTimer) {
      clearInterval(this.analyticsUpdateTimer)
      this.analyticsUpdateTimer = null
    }

    // Save final state
    await this.saveDataToStorage()
    this.isInitialized = false
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

// Export a singleton instance for use throughout the application
export const monitoringService = new MonitoringService()
