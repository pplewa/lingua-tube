// ========================================
// Error Notification Service for User-Friendly Error Reporting
// ========================================

import {
  ErrorType,
  ErrorSeverity,
  ComponentType,
  UserNotification,
  LogEntry,
  ErrorContext,
} from './types'

/**
 * Enhanced notification types for different UI contexts
 */
export enum NotificationType {
  TOAST = 'toast', // Brief message overlay
  BANNER = 'banner', // Top/bottom bar notification
  POPUP = 'popup', // Modal-style notification
  INLINE = 'inline', // Embedded in component
  BADGE = 'badge', // Small status indicator
}

/**
 * Notification positioning and display options
 */
export interface NotificationConfig {
  readonly type: NotificationType
  readonly position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  readonly duration: number // ms, 0 = persistent
  readonly dismissible: boolean
  readonly autoHide: boolean
  readonly showProgress: boolean
  readonly allowMultiple: boolean
  readonly stackable: boolean
  readonly maxStack: number
  readonly animationDuration: number
  readonly theme: 'light' | 'dark' | 'auto'
}

/**
 * User-friendly error messages and guidance
 */
export interface ErrorMessage {
  readonly title: string
  readonly message: string
  readonly guidance: string
  readonly actionLabel?: string
  readonly action?: () => Promise<void>
  readonly learnMoreUrl?: string
  readonly reportable: boolean
}

/**
 * Notification action for user interaction
 */
export interface NotificationAction {
  readonly label: string
  readonly type: 'primary' | 'secondary' | 'danger'
  readonly action: () => Promise<void>
  readonly loading?: boolean
  readonly disabled?: boolean
}

/**
 * Enhanced notification interface
 */
export interface EnhancedNotification extends Omit<UserNotification, 'type' | 'actions'> {
  readonly id: string
  readonly type: NotificationType
  readonly component: ComponentType
  readonly errorType?: ErrorType
  readonly config: NotificationConfig
  readonly retryable: boolean
  readonly retryCount: number
  readonly maxRetries: number
  readonly timestamp: number
  readonly context?: Record<string, any>
  readonly actions?: NotificationAction[]
}

/**
 * Notification queue entry
 */
interface QueuedNotification {
  readonly notification: EnhancedNotification
  readonly element?: HTMLElement
  timeout?: ReturnType<typeof setTimeout>
  readonly createdAt: number
  readonly lastUpdated: number
}

/**
 * Service for managing user-friendly error notifications
 */
export class ErrorNotificationService {
  private static instance: ErrorNotificationService | null = null
  private notifications: Map<string, QueuedNotification> = new Map()
  private container: HTMLElement | null = null
  private shadowRoot: ShadowRoot | null = null
  private config: NotificationConfig
  private isInitialized: boolean = false
  private mutationObserver: MutationObserver | null = null

  // Error message mappings for different error types and components
  private errorMessages: Map<string, ErrorMessage> = new Map()

  // Default configuration
  private defaultConfig: NotificationConfig = {
    type: NotificationType.TOAST,
    position: 'top-right',
    duration: 5000,
    dismissible: true,
    autoHide: true,
    showProgress: true,
    allowMultiple: true,
    stackable: true,
    maxStack: 5,
    animationDuration: 300,
    theme: 'auto',
  }

  private constructor(config?: Partial<NotificationConfig>) {
    this.config = { ...this.defaultConfig, ...config }
    this.initializeErrorMessages()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<NotificationConfig>): ErrorNotificationService {
    if (!ErrorNotificationService.instance) {
      ErrorNotificationService.instance = new ErrorNotificationService(config)
    }
    return ErrorNotificationService.instance
  }

  /**
   * Initialize the notification system
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    await this.createNotificationContainer()
    this.setupEventListeners()
    this.isInitialized = true
  }

  /**
   * Create notification container with Shadow DOM isolation
   */
  private async createNotificationContainer(): Promise<void> {
    // Remove existing container if it exists
    if (this.container) {
      this.container.remove()
    }

    // Create main container
    this.container = document.createElement('lingua-tube-notifications')
    this.container.setAttribute('data-component', 'error-notifications')

    // Create shadow DOM for style isolation
    this.shadowRoot = this.container.attachShadow({ mode: 'closed' })

    // Add CSS styles
    const styles = this.createNotificationStyles()
    this.shadowRoot.appendChild(styles)

    // Create notification area
    const notificationArea = document.createElement('div')
    notificationArea.className = 'notification-area'
    notificationArea.setAttribute('data-position', this.config.position)
    this.shadowRoot.appendChild(notificationArea)

    // Append to document body
    document.body.appendChild(this.container)

    // Watch for document changes to ensure container remains attached
    this.observeDocumentChanges()
  }

  /**
   * Create CSS styles for notifications
   */
  private createNotificationStyles(): HTMLStyleElement {
    const style = document.createElement('style')
    style.textContent = `
      :host {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .notification-area {
        position: absolute;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        max-width: 400px;
        pointer-events: none;
      }

      .notification-area[data-position="top-right"] {
        top: 0;
        right: 0;
      }

      .notification-area[data-position="top-left"] {
        top: 0;
        left: 0;
      }

      .notification-area[data-position="bottom-right"] {
        bottom: 0;
        right: 0;
        flex-direction: column-reverse;
      }

      .notification-area[data-position="bottom-left"] {
        bottom: 0;
        left: 0;
        flex-direction: column-reverse;
      }

      .notification-area[data-position="center"] {
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        max-width: 500px;
      }

      .notification {
        pointer-events: auto;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 4px 8px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(0, 0, 0, 0.1);
        padding: 16px;
        position: relative;
        overflow: hidden;
        transform: translateX(100%);
        opacity: 0;
        transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
        will-change: transform, opacity;
      }

      .notification-area[data-position*="left"] .notification {
        transform: translateX(-100%);
      }

      .notification-area[data-position="center"] .notification {
        transform: scale(0.8);
      }

      .notification.visible {
        transform: translateX(0) scale(1);
        opacity: 1;
      }

      .notification.severity-low {
        border-left: 4px solid #48bb78;
      }

      .notification.severity-medium {
        border-left: 4px solid #ed8936;
      }

      .notification.severity-high {
        border-left: 4px solid #f56565;
      }

      .notification.severity-critical {
        border-left: 4px solid #e53e3e;
        background: #fed7d7;
      }

      .notification-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 8px;
      }

      .notification-icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        margin-top: 2px;
      }

      .notification-icon.severity-low {
        color: #48bb78;
      }

      .notification-icon.severity-medium {
        color: #ed8936;
      }

      .notification-icon.severity-high {
        color: #f56565;
      }

      .notification-icon.severity-critical {
        color: #e53e3e;
      }

      .notification-content {
        flex-grow: 1;
        min-width: 0;
      }

      .notification-title {
        font-weight: 600;
        font-size: 14px;
        color: #2d3748;
        margin: 0 0 4px 0;
        line-height: 1.4;
      }

      .notification-message {
        font-size: 13px;
        color: #4a5568;
        margin: 0 0 8px 0;
        line-height: 1.5;
      }

      .notification-guidance {
        font-size: 12px;
        color: #718096;
        margin: 0;
        line-height: 1.4;
      }

      .notification-actions {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
      }

      .notification-button {
        padding: 6px 12px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 200ms ease;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .notification-button:hover {
        transform: translateY(-1px);
      }

      .notification-button.primary {
        background: #4299e1;
        color: white;
      }

      .notification-button.primary:hover {
        background: #3182ce;
      }

      .notification-button.secondary {
        background: #e2e8f0;
        color: #4a5568;
      }

      .notification-button.secondary:hover {
        background: #cbd5e0;
      }

      .notification-button.danger {
        background: #f56565;
        color: white;
      }

      .notification-button.danger:hover {
        background: #e53e3e;
      }

      .notification-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .notification-close {
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        color: #a0aec0;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: all 200ms ease;
      }

      .notification-close:hover {
        color: #4a5568;
        background: #f7fafc;
      }

      .notification-progress {
        position: absolute;
        bottom: 0;
        left: 0;
        height: 2px;
        background: linear-gradient(90deg, #4299e1, #3182ce);
        transition: width 100ms linear;
      }

      .notification.type-banner {
        border-radius: 0;
        width: 100%;
        max-width: none;
        margin: 0;
      }

      .notification.type-popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        max-width: 500px;
        z-index: 1000;
      }

      .notification.type-badge {
        padding: 8px 12px;
        font-size: 11px;
        border-radius: 20px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      @media (max-width: 480px) {
        .notification-area {
          left: 8px;
          right: 8px;
          padding: 8px;
          max-width: none;
        }

        .notification {
          padding: 12px;
        }

        .notification-title {
          font-size: 13px;
        }

        .notification-message {
          font-size: 12px;
        }
      }

      /* Dark theme support */
      @media (prefers-color-scheme: dark) {
        .notification {
          background: #2d3748;
          border-color: #4a5568;
          color: #e2e8f0;
        }

        .notification-title {
          color: #f7fafc;
        }

        .notification-message {
          color: #cbd5e0;
        }

        .notification-guidance {
          color: #a0aec0;
        }

        .notification.severity-critical {
          background: #742a2a;
        }
      }
    `
    return style
  }

  /**
   * Initialize error message mappings
   */
  private initializeErrorMessages(): void {
    // Network-related errors
    this.errorMessages.set(`${ErrorType.NETWORK}-${ComponentType.TRANSLATION_SERVICE}`, {
      title: 'Translation Unavailable',
      message: 'Unable to connect to translation service. Check your internet connection.',
      guidance: 'The extension will work offline with limited functionality.',
      actionLabel: 'Retry',
      reportable: true,
    })

    this.errorMessages.set(`${ErrorType.NETWORK}-${ComponentType.SUBTITLE_MANAGER}`, {
      title: 'Subtitle Loading Failed',
      message: 'Could not load subtitles for this video.',
      guidance: 'Try refreshing the page or check if subtitles are available for this video.',
      actionLabel: 'Refresh',
      reportable: true,
    })

    // API-related errors
    this.errorMessages.set(`${ErrorType.API}-${ComponentType.TRANSLATION_SERVICE}`, {
      title: 'Translation Service Error',
      message: 'The translation service is temporarily unavailable.',
      guidance: 'Previously translated words will still be available. Try again in a few minutes.',
      actionLabel: 'Try Again',
      reportable: true,
    })

    this.errorMessages.set(`${ErrorType.API}-${ComponentType.DICTIONARY_SERVICE}`, {
      title: 'Dictionary Lookup Failed',
      message: 'Unable to fetch word definitions at the moment.',
      guidance: 'Basic translation will still work. Dictionary features will be restored shortly.',
      actionLabel: 'Retry',
      reportable: false,
    })

    // Storage-related errors
    this.errorMessages.set(`${ErrorType.STORAGE}-${ComponentType.STORAGE_SERVICE}`, {
      title: 'Vocabulary Save Failed',
      message: 'Could not save this word to your vocabulary list.',
      guidance: 'Check if you have enough storage space available.',
      actionLabel: 'Try Again',
      reportable: true,
    })

    // Permission-related errors
    this.errorMessages.set(`${ErrorType.PERMISSION}-${ComponentType.TTS_SERVICE}`, {
      title: 'Audio Permission Required',
      message: 'Text-to-speech requires audio permissions.',
      guidance: 'Grant audio permissions in your browser settings to use pronunciation features.',
      actionLabel: 'Grant Permission',
      reportable: false,
    })

    // UI-related errors
    this.errorMessages.set(`${ErrorType.UI}-${ComponentType.WORD_LOOKUP}`, {
      title: 'Word Lookup Error',
      message: 'Unable to display word information popup.',
      guidance: 'Try clicking the word again or refresh the page.',
      actionLabel: 'Refresh Page',
      reportable: true,
    })

    // Performance-related errors
    this.errorMessages.set(`${ErrorType.PERFORMANCE}-${ComponentType.YOUTUBE_INTEGRATION}`, {
      title: 'Performance Issue Detected',
      message: 'LinguaTube is running slowly on this page.',
      guidance: 'Consider closing other tabs or disabling other extensions temporarily.',
      actionLabel: 'Optimize',
      reportable: true,
    })

    // Generic fallback messages
    this.errorMessages.set('fallback-low', {
      title: 'Minor Issue',
      message: 'A small issue occurred but everything should continue working normally.',
      guidance: 'No action needed - the extension will handle this automatically.',
      actionLabel: undefined,
      reportable: false,
    })

    this.errorMessages.set('fallback-medium', {
      title: 'Feature Temporarily Unavailable',
      message: 'Some features may not work properly right now.',
      guidance: 'Most functionality will continue working. Try refreshing if issues persist.',
      actionLabel: 'Refresh',
      reportable: true,
    })

    this.errorMessages.set('fallback-high', {
      title: 'Service Disruption',
      message: 'LinguaTube is experiencing technical difficulties.',
      guidance:
        "Some features are temporarily disabled. We're working to restore full functionality.",
      actionLabel: 'Report Issue',
      reportable: true,
    })

    this.errorMessages.set('fallback-critical', {
      title: 'Extension Error',
      message: 'LinguaTube encountered a serious error and may not work properly.',
      guidance: 'Please refresh the page or restart your browser. Consider reporting this issue.',
      actionLabel: 'Report Problem',
      reportable: true,
    })
  }

  /**
   * Show notification from log entry
   */
  public async showFromLogEntry(logEntry: LogEntry): Promise<string | null> {
    if (!logEntry.errorContext || !this.shouldShowNotification(logEntry)) {
      return null
    }

    const errorMessage = this.getErrorMessage(
      logEntry.errorContext.errorType,
      logEntry.context.component,
      logEntry.errorContext.severity,
    )
    const actions = this.createActions(logEntry.errorContext, errorMessage)

    const notification: EnhancedNotification = {
      id: this.generateNotificationId(),
      type: this.getNotificationTypeForSeverity(logEntry.errorContext.severity),
      severity: logEntry.errorContext.severity,
      title: errorMessage.title,
      message: errorMessage.message,
      component: logEntry.context.component,
      errorType: logEntry.errorContext.errorType,
      actions,
      duration: this.getDurationForSeverity(logEntry.errorContext.severity),
      dismissible: true,
      config: this.getConfigForSeverity(logEntry.errorContext.severity),
      retryable: logEntry.errorContext.recoverable,
      retryCount: 0,
      maxRetries: 3,
      timestamp: Date.now(),
      context: {
        guidance: errorMessage.guidance,
        logId: logEntry.id,
        reportable: errorMessage.reportable,
      },
    }

    return this.show(notification)
  }

  /**
   * Show custom notification
   */
  public async show(notification: EnhancedNotification): Promise<string> {
    await this.ensureInitialized()

    // Check if we should deduplicate
    const existingId = this.findDuplicateNotification(notification)
    if (existingId) {
      return existingId
    }

    // Create notification element
    const element = this.createNotificationElement(notification)

    // Add to container
    const notificationArea = this.shadowRoot?.querySelector('.notification-area')
    if (!notificationArea) {
      throw new Error('Notification area not found')
    }

    // Handle stacking limits
    this.enforceStackingLimits()

    // Add to area
    notificationArea.appendChild(element)

    // Create queued notification
    const queuedNotification: QueuedNotification = {
      notification,
      element,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
    }

    // Store in map
    this.notifications.set(notification.id, queuedNotification)

    // Setup auto-hide timer
    if (notification.config.autoHide && notification.duration && notification.duration > 0) {
      queuedNotification.timeout = setTimeout(() => {
        this.hide(notification.id)
      }, notification.duration)
    }

    // Trigger show animation
    requestAnimationFrame(() => {
      element.classList.add('visible')
    })

    return notification.id
  }

  /**
   * Hide notification by ID
   */
  public async hide(notificationId: string): Promise<boolean> {
    const queuedNotification = this.notifications.get(notificationId)
    if (!queuedNotification) {
      return false
    }

    const { element, timeout } = queuedNotification

    // Clear timeout
    if (timeout) {
      clearTimeout(timeout)
    }

    // Animate out
    if (element) {
      element.classList.remove('visible')

      // Remove after animation
      setTimeout(() => {
        element.remove()
      }, this.config.animationDuration)
    }

    // Remove from map
    this.notifications.delete(notificationId)

    return true
  }

  /**
   * Hide all notifications
   */
  public async hideAll(): Promise<void> {
    const notificationIds = Array.from(this.notifications.keys())
    await Promise.all(notificationIds.map((id) => this.hide(id)))
  }

  /**
   * Update notification config
   */
  public updateConfig(newConfig: Partial<NotificationConfig>): void {
    this.config = { ...this.config, ...newConfig }

    // Update position if changed
    const notificationArea = this.shadowRoot?.querySelector('.notification-area')
    if (notificationArea) {
      notificationArea.setAttribute('data-position', this.config.position)
    }
  }

  /**
   * Get all active notifications
   */
  public getActiveNotifications(): EnhancedNotification[] {
    return Array.from(this.notifications.values()).map((q) => q.notification)
  }

  /**
   * Cleanup and destroy service
   */
  public destroy(): void {
    this.hideAll()

    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
    }

    if (this.container) {
      this.container.remove()
    }

    this.notifications.clear()
    this.isInitialized = false
    ErrorNotificationService.instance = null
  }

  // Private helper methods

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize()
    }
  }

  private shouldShowNotification(logEntry: LogEntry): boolean {
    // Only show notifications for errors and warnings
    if (!['error', 'critical', 'warn'].includes(logEntry.level)) {
      return false
    }

    // Don't show notifications for internal logging errors
    if (logEntry.context.component === ComponentType.ERROR_HANDLER) {
      return false
    }

    return true
  }

  private getErrorMessage(
    errorType: ErrorType,
    component: ComponentType,
    severity: ErrorSeverity,
  ): ErrorMessage {
    const key = `${errorType}-${component}`
    const message = this.errorMessages.get(key)

    if (message) {
      return message
    }

    // Fallback to severity-based message
    const fallbackKey = `fallback-${severity.toLowerCase()}`
    return (
      this.errorMessages.get(fallbackKey) || {
        title: 'Something went wrong',
        message: 'An unexpected error occurred.',
        guidance: 'Please try again or contact support if the problem persists.',
        reportable: true,
      }
    )
  }

  private getNotificationTypeForSeverity(severity: ErrorSeverity): NotificationType {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return NotificationType.POPUP
      case ErrorSeverity.HIGH:
        return NotificationType.BANNER
      case ErrorSeverity.MEDIUM:
      case ErrorSeverity.LOW:
      default:
        return NotificationType.TOAST
    }
  }

  private getDurationForSeverity(severity: ErrorSeverity): number {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return 0 // Persistent
      case ErrorSeverity.HIGH:
        return 10000 // 10 seconds
      case ErrorSeverity.MEDIUM:
        return 7000 // 7 seconds
      case ErrorSeverity.LOW:
      default:
        return 5000 // 5 seconds
    }
  }

  private getConfigForSeverity(severity: ErrorSeverity): NotificationConfig {
    const baseConfig = { ...this.config }

    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return {
          ...baseConfig,
          type: NotificationType.POPUP,
          position: 'center',
          duration: 0,
          dismissible: true,
          autoHide: false,
        }
      case ErrorSeverity.HIGH:
        return {
          ...baseConfig,
          type: NotificationType.BANNER,
          position: 'top-right',
          duration: 10000,
        }
      default:
        return baseConfig
    }
  }

  private createActions(
    errorContext: ErrorContext,
    errorMessage: ErrorMessage,
  ): NotificationAction[] {
    const actions: NotificationAction[] = []

    // Add retry action if recoverable
    if (errorContext.recoverable && errorMessage.actionLabel) {
      actions.push({
        label: errorMessage.actionLabel,
        type: 'primary',
        action: async () => {
          // Retry logic would be implemented here
          // For now, just hide the notification
          await this.hide(errorContext.userMessage || '')
        },
      })
    }

    // Add dismiss action
    actions.push({
      label: 'Dismiss',
      type: 'secondary',
      action: async () => {
        await this.hide(errorContext.userMessage || '')
      },
    })

    // Add report action if reportable
    if (errorMessage.reportable) {
      actions.push({
        label: 'Report',
        type: 'secondary',
        action: async () => {
          // Report logic would be implemented here
          console.log('Reporting error:', errorContext)
        },
      })
    }

    return actions
  }

  private generateNotificationId(): string {
    return `notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  private findDuplicateNotification(notification: EnhancedNotification): string | null {
    for (const [id, queued] of this.notifications) {
      if (
        queued.notification.errorType === notification.errorType &&
        queued.notification.component === notification.component &&
        queued.notification.severity === notification.severity
      ) {
        return id
      }
    }
    return null
  }

  private createNotificationElement(notification: EnhancedNotification): HTMLElement {
    const element = document.createElement('div')
    element.className = `notification type-${notification.config.type} severity-${notification.severity.toLowerCase()}`
    element.setAttribute('data-id', notification.id)

    const icon = this.getIconForSeverity(notification.severity)

    element.innerHTML = `
      <div class="notification-header">
        <div class="notification-icon severity-${notification.severity.toLowerCase()}">
          ${icon}
        </div>
        <div class="notification-content">
          <h4 class="notification-title">${this.escapeHtml(notification.title)}</h4>
          <p class="notification-message">${this.escapeHtml(notification.message)}</p>
          ${notification.context?.guidance ? `<p class="notification-guidance">${this.escapeHtml(notification.context.guidance)}</p>` : ''}
        </div>
        ${notification.dismissible ? '<button class="notification-close" aria-label="Close">×</button>' : ''}
      </div>
      ${notification.actions && notification.actions.length > 0 ? this.createActionsHTML(notification.actions) : ''}
      ${notification.config.showProgress && notification.duration && notification.duration > 0 ? '<div class="notification-progress"></div>' : ''}
    `

    // Attach event listeners
    this.attachNotificationEvents(element, notification)

    return element
  }

  private createActionsHTML(actions: NotificationAction[]): string {
    const actionsHTML = actions
      .map(
        (action) => `
        <button class="notification-button ${action.type}" ${action.disabled ? 'disabled' : ''}>
          ${action.loading ? '⟳' : ''} ${this.escapeHtml(action.label)}
        </button>
      `,
      )
      .join('')

    return `<div class="notification-actions">${actionsHTML}</div>`
  }

  private attachNotificationEvents(element: HTMLElement, notification: EnhancedNotification): void {
    // Close button
    const closeButton = element.querySelector('.notification-close')
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.hide(notification.id)
      })
    }

    // Action buttons
    const actionButtons = element.querySelectorAll('.notification-button')
    actionButtons.forEach((button, index) => {
      const action = notification.actions?.[index]
      if (action) {
        button.addEventListener('click', async () => {
          try {
            await action.action()
          } catch (error) {
            console.error('Notification action failed:', error)
          }
        })
      }
    })

    // Progress bar animation
    if (notification.config.showProgress && notification.duration && notification.duration > 0) {
      const progressBar = element.querySelector('.notification-progress') as HTMLElement
      if (progressBar) {
        let startTime = Date.now()
        const duration = notification.duration // Capture to avoid undefined issues
        const updateProgress = () => {
          const elapsed = Date.now() - startTime
          const progress = Math.min((elapsed / duration) * 100, 100)
          progressBar.style.width = `${100 - progress}%`

          if (progress < 100) {
            requestAnimationFrame(updateProgress)
          }
        }
        requestAnimationFrame(updateProgress)
      }
    }
  }

  private getIconForSeverity(severity: ErrorSeverity): string {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
        return '⚠️'
      case ErrorSeverity.HIGH:
        return '❌'
      case ErrorSeverity.MEDIUM:
        return '⚠️'
      case ErrorSeverity.LOW:
      default:
        return 'ℹ️'
    }
  }

  private enforceStackingLimits(): void {
    if (this.notifications.size >= this.config.maxStack) {
      // Remove oldest notification
      const oldestId = Array.from(this.notifications.keys())[0]
      if (oldestId) {
        this.hide(oldestId)
      }
    }
  }

  private setupEventListeners(): void {
    // Listen for page navigation to re-attach container if needed
    window.addEventListener('beforeunload', () => {
      this.hideAll()
    })
  }

  private observeDocumentChanges(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          // Check if our container was removed
          if (!document.body.contains(this.container!)) {
            document.body.appendChild(this.container!)
          }
        }
      })
    })

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: false,
    })
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }
}
