/**
 * Dual Subtitle Manager
 * Coordinates the dual subtitle component with translation services, storage, and player interactions
 */

import { DualSubtitleComponent, DualSubtitleConfig, WordClickEvent } from './DualSubtitleComponent'
import { PlayerInteractionService } from '../youtube/PlayerInteractionService'
import { StorageService } from '../storage'
import { TranslationApiService } from '../translation/TranslationApiService'
import { translationCacheService } from '../translation/TranslationCacheService'
import { UserSettings } from '../storage/types'
import { WordLookupPopup } from './WordLookupPopup'
import { Logger } from '../logging/Logger'
import { ComponentType } from '../logging/types'

// ========================================
// Types and Interfaces
// ========================================

export interface SubtitleManagerConfig {
  readonly autoTranslate: boolean
  readonly translationDelay: number // ms to wait before translating
  readonly cacheTranslations: boolean
  readonly vocabularyIntegration: boolean
  readonly autoSaveWords: boolean
  readonly contextWindow: number // words around clicked word for context
}

export interface TranslationRequest {
  readonly text: string
  readonly sourceLanguage: string
  readonly targetLanguage: string
  readonly context?: string
  readonly priority: 'high' | 'normal' | 'low'
}

export interface VocabularyEntry {
  readonly word: string
  readonly translation: string
  readonly context: string
  readonly sourceLanguage: string
  readonly targetLanguage: string
  readonly videoId: string
  readonly timestamp: number
}

export type TranslationCallback = (translation: string, cueId: string) => void
export type VocabularyCallback = (entry: VocabularyEntry) => void

// ========================================
// Main Manager Class
// ========================================

export class DualSubtitleManager {
  private subtitleComponent: DualSubtitleComponent | null = null
  private playerService: PlayerInteractionService
  private storageService: StorageService
  private translationService: TranslationApiService
  private wordLookupPopup: WordLookupPopup | null = null

  private config: SubtitleManagerConfig
  private currentVideoId: string | null = null
  private sourceLanguage: string = 'en'
  private targetLanguage: string = 'es'

  private translationQueue: Map<string, TranslationRequest> = new Map()
  private pendingTranslations: Set<string> = new Set()
  private translationTimeouts: Map<string, number> = new Map()

  private vocabularyCallbacks: Set<VocabularyCallback> = new Set()
  private translationCallbacks: Set<TranslationCallback> = new Set()

  private isInitialized: boolean = false
  private readonly logger = Logger.getInstance()

  constructor(
    playerService: PlayerInteractionService,
    storageService: StorageService,
    translationService: TranslationApiService,
    wordLookupPopup?: WordLookupPopup,
  ) {
    this.playerService = playerService
    this.storageService = storageService
    this.translationService = translationService
    this.wordLookupPopup = wordLookupPopup || null

    this.config = {
      autoTranslate: true,
      translationDelay: 500,
      cacheTranslations: true,
      vocabularyIntegration: true,
      autoSaveWords: false,
      contextWindow: 3,
    }

    this.setupEventHandlers()
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  private async checkTranslationStatus(): Promise<void> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_TRANSLATION_STATUS',
      })

      if (response.success && response.status) {
        const status = response.status
        this.logger.info('Translation status', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            configured: status.configured,
            hasApiKey: status.hasApiKey,
            lastError: status.lastError
          }
        })

        if (!status.configured || !status.hasApiKey) {
          this.logger.warn('Translation service not properly configured', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: {
              hasApiKey: status.hasApiKey,
              configured: status.configured,
              lastError: status.lastError
            }
          })
        } else {
          this.logger.info('Translation service is ready', {
            component: ComponentType.SUBTITLE_MANAGER
          })
        }
      } else {
        this.logger.warn('Failed to get translation status from background service', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            responseSuccess: response?.success,
            hasStatus: !!response?.status
          }
        })
      }
    } catch (error) {
      this.logger.warn('Error checking translation status', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  public async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) {
        this.logger.warn('Already initialized', {
          component: ComponentType.SUBTITLE_MANAGER
        })
        return true
      }

      this.logger.info('Starting initialization', {
        component: ComponentType.SUBTITLE_MANAGER
      })

      // Check translation service status from background service (non-blocking)
      this.checkTranslationStatus().catch((error) => {
        this.logger.warn('Translation status check failed', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      })

      // Load user settings
      this.logger.info('Loading user settings', {
        component: ComponentType.SUBTITLE_MANAGER
      })
      await this.loadUserSettings()
      this.logger.info('User settings loaded', {
        component: ComponentType.SUBTITLE_MANAGER
      })

      // Initialize subtitle component
      this.logger.info('Creating subtitle component', {
        component: ComponentType.SUBTITLE_MANAGER
      })
      this.subtitleComponent = new DualSubtitleComponent(
        this.playerService,
        this.storageService,
        await this.createSubtitleConfig(),
      )
      this.logger.info('Subtitle component created', {
        component: ComponentType.SUBTITLE_MANAGER
      })

      this.logger.info('Initializing subtitle component', {
        component: ComponentType.SUBTITLE_MANAGER
      })
      const initSuccess = await this.subtitleComponent.initialize()
      if (!initSuccess) {
        this.logger.error('Failed to initialize subtitle component', {
          component: ComponentType.SUBTITLE_MANAGER
        })
        return false
      }
      this.logger.info('Subtitle component initialized', {
        component: ComponentType.SUBTITLE_MANAGER
      })

      // Set up subtitle component event handlers
      this.logger.info('Setting up event handlers', {
        component: ComponentType.SUBTITLE_MANAGER
      })
      this.setupSubtitleEventHandlers()
      this.logger.info('Event handlers set up', {
        component: ComponentType.SUBTITLE_MANAGER
      })

      // Get current video ID
      this.currentVideoId = this.extractVideoId(window.location.href)

      this.isInitialized = true
      this.logger.info('Initialized successfully', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          currentVideoId: this.currentVideoId
        }
      })
      return true
    } catch (error) {
      this.logger.error('Initialization failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        }
      })
      return false
    }
  }

  public async destroy(): Promise<void> {
    try {
      // Clear all timeouts
      this.translationTimeouts.forEach((timeoutId) => clearTimeout(timeoutId))
      this.translationTimeouts.clear()

      // Clear queues
      this.translationQueue.clear()
      this.pendingTranslations.clear()

      // Destroy subtitle component
      if (this.subtitleComponent) {
        this.subtitleComponent.destroy()
        this.subtitleComponent = null
      }

      // Clear callbacks
      this.vocabularyCallbacks.clear()
      this.translationCallbacks.clear()

      this.isInitialized = false
      this.logger.info('Destroyed successfully', {
        component: ComponentType.SUBTITLE_MANAGER
      })
    } catch (error) {
      this.logger.error('Destroy failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  private async loadUserSettings(): Promise<void> {
    try {
      const result = await this.storageService.getSettings()
      if (result.success && result.data) {
        const settings = result.data

        // Update languages
        this.sourceLanguage = settings.languages.sourceLanguage
        this.targetLanguage = settings.languages.nativeLanguage

        // Update WordLookupPopup with user's language preferences
        if (this.wordLookupPopup) {
          this.wordLookupPopup.setDefaultLanguages(this.sourceLanguage, this.targetLanguage)
        }

        this.logger.info('User settings loaded', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            sourceLanguage: this.sourceLanguage,
            targetLanguage: this.targetLanguage,
            cacheTranslations: settings.privacy.cacheTranslations,
            autoSaveWords: settings.vocabulary.autoSave
          }
        })

        // Update manager config
        this.config = {
          ...this.config,
          autoTranslate: true, // Could be from settings
          cacheTranslations: settings.privacy.cacheTranslations,
          vocabularyIntegration: true,
          autoSaveWords: settings.vocabulary.autoSave,
        }
      }
    } catch (error) {
      this.logger.warn('Failed to load user settings', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  private async createSubtitleConfig(): Promise<Partial<DualSubtitleConfig>> {
    try {
      const result = await this.storageService.getSettings()
      if (result.success && result.data) {
        const { subtitle, ui } = result.data

        return {
          showTargetLanguage: subtitle.showSource,
          showNativeLanguage: subtitle.showNative,
          fontSize: subtitle.fontSize,
          fontFamily: subtitle.fontFamily,
          backgroundColor: subtitle.backgroundColor,
          opacity: subtitle.opacity,
          animationEnabled: ui.animationsEnabled,
          clickableWords: true, // Always enable for vocabulary features
          autoHideNative: false,
        }
      }
    } catch (error) {
      this.logger.warn('Failed to create subtitle config from settings', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }

    return {}
  }

  // ========================================
  // Event Handlers
  // ========================================

  private setupEventHandlers(): void {
    // Listen for video changes
    if (typeof window !== 'undefined') {
      let lastUrl = window.location.href

      const checkForVideoChange = () => {
        const currentUrl = window.location.href
        if (currentUrl !== lastUrl) {
          lastUrl = currentUrl
          this.handleVideoChange(this.extractVideoId(currentUrl))
        }
      }

      // Use MutationObserver to detect navigation
      const observer = new MutationObserver(checkForVideoChange)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      })

      // Also check periodically as fallback
      setInterval(checkForVideoChange, 2000)
    }
  }

  private setupSubtitleEventHandlers(): void {
    if (!this.subtitleComponent) return

    // Handle word clicks for vocabulary and translation
    this.subtitleComponent.addWordClickListener(this.handleWordClick.bind(this))

    // Handle visibility changes
    this.subtitleComponent.addVisibilityListener((visible, cueCount) => {
      if (visible && this.config.autoTranslate) {
        this.logger.debug('Processing visible cues', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            cueCount,
            autoTranslate: this.config.autoTranslate
          }
        })
        this.processVisibleCues()
      }
    })
  }

  private handleVideoChange(videoId: string | null): void {
    if (this.currentVideoId !== videoId) {
      this.currentVideoId = videoId
      this.clearTranslationQueue()

      this.logger.info('Video changed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          previousVideoId: this.currentVideoId,
          newVideoId: videoId
        }
      })
    }
  }

  private async handleWordClick(event: WordClickEvent): Promise<void> {
    try {
      this.logger.debug('Handling word click', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word: event.word,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          cueId: event.cueId
        }
      })

      const { word, cueId, context, position } = event

      // Get translation for the word
      this.logger.debug('Getting word translation', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          context: context.substring(0, 100), // Limit context length for logging
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage
        }
      })
      const translation = await this.getWordTranslation(word, context)
      this.logger.debug('Word translation completed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          translation,
          translationLength: translation.length
        }
      })

      // Show translation tooltip with context
      this.showTranslationTooltip(word, translation, position)

      // Create vocabulary entry if auto-save is enabled
      if (this.config.autoSaveWords && this.currentVideoId) {
        const vocabularyEntry: VocabularyEntry = {
          word,
          translation,
          context,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          videoId: this.currentVideoId,
          timestamp: Date.now(),
        }

        await this.saveVocabularyItem(vocabularyEntry)

        // Notify vocabulary callbacks
        this.vocabularyCallbacks.forEach((callback) => {
          try {
            callback(vocabularyEntry)
          } catch (error) {
            this.logger.error('Vocabulary callback error', {
              component: ComponentType.SUBTITLE_MANAGER,
              metadata: {
                word,
                error: error instanceof Error ? error.message : String(error)
              }
            })
          }
        })
      }
    } catch (error) {
      this.logger.error('Word click handling failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word: event.word,
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  // ========================================
  // Translation Management
  // ========================================

  private async processVisibleCues(): Promise<void> {
    if (!this.subtitleComponent) return

    const visibleCues = this.subtitleComponent.getCurrentCues()

    for (const cue of visibleCues) {
      if (cue.targetText && !cue.nativeText) {
        await this.requestCueTranslation(cue.id, cue.targetText)
      }
    }
  }

  private async requestCueTranslation(cueId: string, text: string): Promise<void> {
    // Skip if already pending or in queue
    if (this.pendingTranslations.has(cueId) || this.translationQueue.has(cueId)) {
      return
    }

    // Check cache first if enabled
    if (this.config.cacheTranslations) {
      try {
        const cached = await translationCacheService.get(
          text,
          this.sourceLanguage,
          this.targetLanguage,
        )
        if (cached) {
          this.deliverTranslation(cueId, cached)
          return
        }
      } catch (error) {
        this.logger.warn('Cache lookup failed', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            cueId,
            text: text.substring(0, 50),
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    }

    // Queue translation request
    const request: TranslationRequest = {
      text,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      priority: 'normal',
    }

    this.translationQueue.set(cueId, request)

    // Set up delayed execution
    const timeoutId = setTimeout(() => {
      this.executeTranslation(cueId, request)
    }, this.config.translationDelay) as any

    this.translationTimeouts.set(cueId, timeoutId)
  }

  private async executeTranslation(cueId: string, request: TranslationRequest): Promise<void> {
    try {
      this.pendingTranslations.add(cueId)

      const translation = await this.translationService.translateText({
        text: request.text,
        fromLanguage: request.sourceLanguage,
        toLanguage: request.targetLanguage,
      })

      // Cache the translation
      if (this.config.cacheTranslations) {
        await translationCacheService.set(
          request.text,
          translation,
          request.sourceLanguage,
          request.targetLanguage,
        )
      }

      // Deliver translation
      this.deliverTranslation(cueId, translation)
    } catch (error) {
      this.logger.error('Translation failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          cueId,
          text: request.text.substring(0, 50),
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          error: error instanceof Error ? error.message : String(error)
        }
      })
    } finally {
      this.pendingTranslations.delete(cueId)
      this.translationQueue.delete(cueId)
    }
  }

  private deliverTranslation(cueId: string, translation: string): void {
    // Update subtitle component
    if (this.subtitleComponent) {
      this.subtitleComponent.setNativeTranslation(cueId, translation)
    }

    // Notify translation callbacks
    this.translationCallbacks.forEach((callback) => {
      try {
        callback(translation, cueId)
      } catch (error) {
        this.logger.error('Translation callback error', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            cueId,
            translation: translation.substring(0, 50),
            error: error instanceof Error ? error.message : String(error)
          }
        })
      }
    })
  }

  private async getWordTranslation(word: string, context: string): Promise<string> {
    try {
      this.logger.debug('Getting word translation', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          contextLength: context.length
        }
      })

      // Check cache first
      if (this.config.cacheTranslations) {
        const cached = await translationCacheService.get(
          word,
          this.sourceLanguage,
          this.targetLanguage,
        )
        if (cached) {
          this.logger.debug('Found cached translation', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: {
              word,
              cachedTranslation: cached,
              sourceLanguage: this.sourceLanguage,
              targetLanguage: this.targetLanguage
            }
          })
          return cached
        }
      }

      // Request translation with context
      const contextWords = this.extractContext(context, word)
      const textToTranslate = contextWords.length > 1 ? contextWords.join(' ') : word

      this.logger.debug('Preparing translation request', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          textToTranslate,
          contextWordsCount: contextWords.length,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage
        }
      })

      const translation = await this.translationService.translateText({
        text: textToTranslate,
        fromLanguage: this.sourceLanguage,
        toLanguage: this.targetLanguage,
      })

      this.logger.debug('Raw translation received', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          rawTranslation: translation,
          translationLength: translation.length
        }
      })

      // If we translated with context, extract just the word translation
      const wordTranslation =
        contextWords.length > 1
          ? this.extractWordFromTranslation(translation, word, contextWords)
          : translation

      this.logger.debug('Final word translation extracted', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          finalTranslation: wordTranslation,
          usedContextExtraction: contextWords.length > 1
        }
      })

      // Cache the word translation
      if (this.config.cacheTranslations) {
        await translationCacheService.set(
          word,
          wordTranslation,
          this.sourceLanguage,
          this.targetLanguage,
        )
      }

      return wordTranslation
    } catch (error) {
      this.logger.error('Word translation failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          sourceLanguage: this.sourceLanguage,
          targetLanguage: this.targetLanguage,
          error: error instanceof Error ? error.message : String(error)
        }
      })

      // Provide specific error feedback for authentication issues
      if (error && typeof error === 'object' && 'code' in error) {
        const translationError = error as { code: string; message: string }

        if (
          translationError.code === 'UNAUTHORIZED' ||
          translationError.code === 'SERVICE_NOT_CONFIGURED'
        ) {
          this.logger.warn('Translation service authentication failed', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: {
              word,
              errorCode: translationError.code,
              message: 'Please configure your Microsoft Translator API key'
            }
          })
          return `[Translation Error: API key needed]`
        } else if (translationError.code === 'MISSING_API_KEY') {
          this.logger.warn('Translation API key missing', {
            component: ComponentType.SUBTITLE_MANAGER,
            metadata: {
              word,
              errorCode: translationError.code,
              message: 'No API key configured'
            }
          })
          return `[No API key configured]`
        }
      }

      return word // Fallback to original word for other errors
    }
  }

  private extractContext(fullContext: string, targetWord: string): string[] {
    const words = fullContext.split(/\s+/)
    const targetIndex = words.findIndex(
      (w) =>
        w.toLowerCase().replace(/[^\w]/g, '') === targetWord.toLowerCase().replace(/[^\w]/g, ''),
    )

    if (targetIndex === -1) return [targetWord]

    const start = Math.max(0, targetIndex - this.config.contextWindow)
    const end = Math.min(words.length, targetIndex + this.config.contextWindow + 1)

    return words.slice(start, end)
  }

  private extractWordFromTranslation(
    translation: string,
    originalWord: string,
    contextWords: string[],
  ): string {
    // Simple heuristic: if translation is much longer than original word,
    // try to extract the corresponding part
    const translationWords = translation.split(/\s+/)
    const originalIndex = contextWords.findIndex(
      (w) =>
        w.toLowerCase().replace(/[^\w]/g, '') === originalWord.toLowerCase().replace(/[^\w]/g, ''),
    )

    if (originalIndex !== -1 && originalIndex < translationWords.length) {
      return translationWords[originalIndex] || translation
    }

    return translation
  }

  private clearTranslationQueue(): void {
    this.translationTimeouts.forEach((timeoutId) => clearTimeout(timeoutId))
    this.translationTimeouts.clear()
    this.translationQueue.clear()
    this.pendingTranslations.clear()
  }

  // ========================================
  // Vocabulary Management
  // ========================================

  private async saveVocabularyItem(entry: VocabularyEntry): Promise<void> {
    try {
      const vocabularyItem = {
        word: entry.word,
        translation: entry.translation,
        context: entry.context,
        sourceLanguage: entry.sourceLanguage,
        targetLanguage: entry.targetLanguage,
        videoId: entry.videoId,
        videoTitle: await this.getVideoTitle(),
        timestamp: entry.timestamp,
        reviewCount: 0,
        difficulty: 'medium' as const,
      }

      const result = await this.storageService.saveWord(vocabularyItem)

      if (result.success) {
        this.logger.info('Vocabulary item saved', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            word: entry.word,
            translation: entry.translation,
            videoId: entry.videoId,
            sourceLanguage: entry.sourceLanguage,
            targetLanguage: entry.targetLanguage
          }
        })
      } else {
        this.logger.error('Failed to save vocabulary item', {
          component: ComponentType.SUBTITLE_MANAGER,
          metadata: {
            word: entry.word,
            error: result.error || 'Unknown error'
          }
        })
      }
    } catch (error) {
      this.logger.error('Vocabulary save error', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word: entry.word,
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  private async getVideoTitle(): Promise<string> {
    try {
      const titleElement = document.querySelector(
        'h1.title yt-formatted-string, h1[class*="title"]',
      )
      return titleElement?.textContent?.trim() || 'Unknown Video'
    } catch (error) {
      return 'Unknown Video'
    }
  }

  private showTranslationTooltip(
    word: string,
    translation: string,
    position: { x: number; y: number },
  ): void {
    this.logger.debug('Showing translation tooltip', {
      component: ComponentType.SUBTITLE_MANAGER,
      metadata: {
        word,
        translation,
        position,
        hasWordLookupPopup: !!this.wordLookupPopup,
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage
      }
    })

    if (this.wordLookupPopup) {
      this.wordLookupPopup.show({
        word,
        position,
        sourceLanguage: this.sourceLanguage,
        targetLanguage: this.targetLanguage,
        context: '', // Could be enhanced to pass subtitle context
      })
    } else {
      // Fallback logging if popup is not available
      this.logger.info('Translation fallback display', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          word,
          translation,
          reason: 'No word lookup popup available'
        }
      })
    }
  }

  // ========================================
  // Utility Methods
  // ========================================

  private extractVideoId(url: string): string | null {
    const match = url.match(/[?&]v=([^&]+)/)
    return match ? match[1] : null
  }

  // ========================================
  // Public API
  // ========================================

  public isReady(): boolean {
    return this.isInitialized && this.subtitleComponent?.isReady() === true
  }

  public updateConfig(newConfig: Partial<SubtitleManagerConfig>): void {
    this.config = { ...this.config, ...newConfig }

    if (newConfig.autoTranslate !== undefined && this.subtitleComponent) {
      // Process visible cues if auto-translate was enabled
      if (newConfig.autoTranslate) {
        this.processVisibleCues()
      }
    }
  }

  public getConfig(): SubtitleManagerConfig {
    return { ...this.config }
  }

  public setLanguages(sourceLanguage: string, targetLanguage: string): void {
    this.sourceLanguage = sourceLanguage
    this.targetLanguage = targetLanguage

    // Update WordLookupPopup with new language settings
    if (this.wordLookupPopup) {
      this.wordLookupPopup.setDefaultLanguages(sourceLanguage, targetLanguage)
    }

    // Clear caches and queues since language changed
    this.clearTranslationQueue()
  }

  public getSubtitleComponent(): DualSubtitleComponent | null {
    return this.subtitleComponent
  }

  public addVocabularyCallback(callback: VocabularyCallback): void {
    this.vocabularyCallbacks.add(callback)
  }

  public removeVocabularyCallback(callback: VocabularyCallback): void {
    this.vocabularyCallbacks.delete(callback)
  }

  public addTranslationCallback(callback: TranslationCallback): void {
    this.translationCallbacks.add(callback)
  }

  public removeTranslationCallback(callback: TranslationCallback): void {
    this.translationCallbacks.delete(callback)
  }

  public async forceTranslateCue(cueId: string, text: string): Promise<void> {
    const request: TranslationRequest = {
      text,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
      priority: 'high',
    }

    await this.executeTranslation(cueId, request)
  }

  public highlightVocabularyWords(words: string[]): void {
    if (!this.subtitleComponent) return

    words.forEach((word) => {
      this.subtitleComponent!.highlightWord(word, true)
    })
  }
}
