/**
 * Word Lookup Popup Component for LinguaTube
 * Displays an interactive popup with word translation, definition, and vocabulary controls
 * Uses shadow DOM for complete isolation from YouTube's styles
 */

import { DictionaryApiService } from '../translation/DictionaryApiService';
import { TranslationApiService } from '../translation/TranslationApiService';
import { TTSService } from '../translation/TTSService';
import { StorageService } from '../storage';

// ========================================
// Types and Interfaces
// ========================================

export interface WordLookupConfig {
  readonly maxWidth: number; // pixels
  readonly maxHeight: number; // pixels
  readonly borderRadius: number; // pixels
  readonly backgroundColor: string;
  readonly textColor: string;
  readonly accentColor: string;
  readonly shadowColor: string;
  readonly animationDuration: number; // ms
  readonly fontSize: number; // pixels
  readonly padding: number; // pixels
  readonly zIndex: number;
  readonly autoHideDelay: number; // ms, 0 = no auto-hide
  readonly enableAnimations: boolean;
  readonly showPhonetics: boolean;
  readonly showExamples: boolean;
  readonly enableTTS: boolean;
  readonly enableVocabulary: boolean;
}

export interface PopupContent {
  readonly word: string;
  readonly translation: string;
  readonly phonetic?: string;
  readonly definitions: Definition[];
  readonly examples: Example[];
  readonly partOfSpeech?: string;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
}

export interface Definition {
  readonly text: string;
  readonly partOfSpeech?: string;
  readonly level?: 'beginner' | 'intermediate' | 'advanced';
}

export interface Example {
  readonly text: string;
  readonly translation?: string;
  readonly source?: string;
}

export interface PopupPosition {
  readonly x: number;
  readonly y: number;
  readonly placement: 'top' | 'bottom' | 'left' | 'right';
  readonly offset: number;
}

export interface PopupEvents {
  onShow: () => void;
  onHide: () => void;
  onWordSaved: (word: string) => void;
  onTTSPlayed: (word: string) => void;
  onError: (error: Error) => void;
}

// ========================================
// CSS Styles
// ========================================

const POPUP_STYLES = `
  :host {
    /* CSS Custom Properties */
    --popup-max-width: 400px;
    --popup-max-height: 600px;
    --popup-border-radius: 12px;
    --popup-bg-color: #ffffff;
    --popup-text-color: #2d3748;
    --popup-accent-color: #4299e1;
    --popup-shadow-color: rgba(0, 0, 0, 0.15);
    --popup-animation-duration: 250ms;
    --popup-font-size: 14px;
    --popup-padding: 20px;
    --popup-z-index: 2147483647;
    
    /* Container positioning */
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--popup-z-index);
    pointer-events: none;
    font-size: 0;
  }

  .popup-container {
    position: absolute;
    max-width: var(--popup-max-width);
    max-height: var(--popup-max-height);
    background: var(--popup-bg-color);
    border-radius: var(--popup-border-radius);
    box-shadow: 0 10px 25px var(--popup-shadow-color), 0 4px 12px rgba(0, 0, 0, 0.1);
    padding: var(--popup-padding);
    pointer-events: auto;
    font-size: var(--popup-font-size);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: var(--popup-text-color);
    line-height: 1.5;
    overflow: hidden;
    transform: scale(0.8) translateY(10px);
    opacity: 0;
    transition: all var(--popup-animation-duration) cubic-bezier(0.4, 0, 0.2, 1);
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  .popup-container.visible {
    transform: scale(1) translateY(0);
    opacity: 1;
  }

  /* Position-based styling */
  .popup-container.position-top {
    transform-origin: bottom center;
  }

  .popup-container.position-bottom {
    transform-origin: top center;
  }

  .popup-container.position-left {
    transform-origin: right center;
  }

  .popup-container.position-right {
    transform-origin: left center;
  }

  /* Mobile positioning adjustments */
  .popup-container.position-mobile {
    max-width: calc(100vw - 32px);
    margin: 16px;
  }

  .popup-container.position-mobile.position-top {
    transform: translateY(-8px);
  }

  .popup-container.position-mobile.position-bottom {
    transform: translateY(8px);
  }

  /* Positioning arrows/indicators */
  .popup-container.position-top::before {
    content: '';
    position: absolute;
    bottom: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 8px solid var(--popup-bg-color);
  }

  .popup-container.position-bottom::before {
    content: '';
    position: absolute;
    top: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-bottom: 8px solid var(--popup-bg-color);
  }

  .popup-container.position-left::before {
    content: '';
    position: absolute;
    right: -8px;
    top: 50%;
    transform: translateY(-50%);
    width: 0;
    height: 0;
    border-top: 8px solid transparent;
    border-bottom: 8px solid transparent;
    border-left: 8px solid var(--popup-bg-color);
  }

  .popup-container.position-right::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 50%;
    transform: translateY(-50%);
    width: 0;
    height: 0;
    border-top: 8px solid transparent;
    border-bottom: 8px solid transparent;
    border-right: 8px solid var(--popup-bg-color);
  }

  .popup-container.loading {
    min-height: 120px;
  }

  .popup-container.error {
    border-left: 4px solid #e53e3e;
  }

  .popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  }

  .word-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--popup-text-color);
    margin: 0;
    flex: 1;
  }

  .phonetic {
    font-size: 14px;
    color: #718096;
    margin-left: 8px;
    font-style: italic;
  }

  .close-button {
    background: none;
    border: none;
    font-size: 20px;
    color: #a0aec0;
    cursor: pointer;
    padding: 4px;
    margin: -4px;
    border-radius: 4px;
    transition: all 0.2s ease;
  }

  .close-button:hover {
    color: #718096;
    background: rgba(0, 0, 0, 0.05);
  }

  .translation-section {
    margin-bottom: 16px;
  }

  .translation-text {
    font-size: 16px;
    font-weight: 500;
    color: var(--popup-accent-color);
    margin: 0 0 8px 0;
  }

  .part-of-speech {
    font-size: 12px;
    color: #718096;
    background: rgba(113, 128, 150, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
  }

  .definitions-section {
    margin-bottom: 16px;
  }

  .section-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--popup-text-color);
    margin: 0 0 8px 0;
  }

  .definition-item {
    margin-bottom: 8px;
    padding-left: 16px;
    position: relative;
  }

  .definition-item:before {
    content: '•';
    position: absolute;
    left: 0;
    color: var(--popup-accent-color);
    font-weight: bold;
  }

  .definition-text {
    font-size: 14px;
    color: var(--popup-text-color);
    line-height: 1.4;
  }

  .examples-section {
    margin-bottom: 16px;
  }

  .example-item {
    margin-bottom: 8px;
    padding: 8px;
    background: rgba(66, 153, 225, 0.05);
    border-radius: 6px;
    border-left: 3px solid var(--popup-accent-color);
  }

  .example-text {
    font-size: 13px;
    color: var(--popup-text-color);
    margin: 0 0 4px 0;
    font-style: italic;
  }

  .example-translation {
    font-size: 12px;
    color: #718096;
    margin: 0;
  }

  .actions-section {
    display: flex;
    gap: 8px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
  }

  .action-button {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid var(--popup-accent-color);
    border-radius: 6px;
    background: transparent;
    color: var(--popup-accent-color);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .action-button:hover {
    background: var(--popup-accent-color);
    color: white;
  }

  .action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-button.primary {
    background: var(--popup-accent-color);
    color: white;
  }

  .action-button.primary:hover {
    background: #3182ce;
  }

  .loading-spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: #718096;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid rgba(66, 153, 225, 0.2);
    border-top: 3px solid var(--popup-accent-color);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-right: 12px;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .error-message {
    display: flex;
    align-items: center;
    padding: 16px;
    background: rgba(229, 62, 62, 0.1);
    border-radius: 6px;
    color: #c53030;
    font-size: 14px;
  }

  .error-icon {
    margin-right: 8px;
    font-size: 18px;
  }

  .retry-button {
    background: #c53030;
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    margin-left: auto;
    transition: background 0.2s ease;
  }

  .retry-button:hover {
    background: #9c2626;
  }

  /* Responsive adjustments */
  @media (max-width: 768px) {
    .popup-container {
      max-width: calc(100vw - 24px);
      margin: 12px;
      padding: calc(var(--popup-padding) * 0.75);
      font-size: calc(var(--popup-font-size) * 0.95);
    }
    
    .word-title {
      font-size: 16px;
    }
    
    .translation-text {
      font-size: 15px;
    }
    
    .actions-section {
      flex-direction: column;
      gap: 8px;
    }
    
    .action-button {
      padding: 12px 16px;
      font-size: 14px;
    }
    
    .example-item {
      padding: 6px;
      margin-bottom: 6px;
    }
    
    .definitions-section {
      margin-bottom: 12px;
    }
    
    .examples-section {
      margin-bottom: 12px;
    }
  }

  @media (max-width: 480px) {
    .popup-container {
      max-width: calc(100vw - 16px);
      margin: 8px;
      padding: calc(var(--popup-padding) * 0.6);
      font-size: calc(var(--popup-font-size) * 0.9);
      border-radius: 8px;
    }
    
    .popup-header {
      margin-bottom: 12px;
      padding-bottom: 8px;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    
    .close-button {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 8px;
      font-size: 18px;
    }
    
    .word-title {
      font-size: 15px;
      margin-right: 32px;
    }
    
    .phonetic {
      font-size: 13px;
      margin-left: 0;
    }
    
    .translation-text {
      font-size: 14px;
    }
    
    .definition-text {
      font-size: 13px;
    }
    
    .example-text {
      font-size: 12px;
    }
    
    .example-translation {
      font-size: 11px;
    }
    
    .section-title {
      font-size: 13px;
      margin-bottom: 6px;
    }
    
    .actions-section {
      padding-top: 12px;
      margin-top: 12px;
    }
    
    .action-button {
      padding: 10px 14px;
      font-size: 13px;
    }
    
    .loading-spinner {
      padding: 30px;
    }
  }

  @media (max-width: 360px) {
    .popup-container {
      max-width: calc(100vw - 12px);
      margin: 6px;
      padding: calc(var(--popup-padding) * 0.5);
      font-size: calc(var(--popup-font-size) * 0.85);
    }
    
    .word-title {
      font-size: 14px;
    }
    
    .translation-text {
      font-size: 13px;
    }
    
    .definition-text {
      font-size: 12px;
    }
    
    .example-text {
      font-size: 11px;
    }
    
    .section-title {
      font-size: 12px;
    }
    
    .action-button {
      padding: 8px 12px;
      font-size: 12px;
    }
  }

  /* Landscape orientation on mobile */
  @media (max-height: 500px) and (orientation: landscape) {
    .popup-container {
      max-height: calc(100vh - 32px);
      margin: 16px;
      overflow-y: auto;
    }
    
    .examples-section {
      display: none; /* Hide examples in landscape to save space */
    }
    
    .loading-spinner {
      padding: 20px;
    }
  }

  /* Large screens */
  @media (min-width: 1200px) {
    .popup-container {
      max-width: calc(var(--popup-max-width) * 1.1);
      font-size: calc(var(--popup-font-size) * 1.05);
    }
    
    .word-title {
      font-size: 20px;
    }
    
    .translation-text {
      font-size: 17px;
    }
    
    .definition-text {
      font-size: 15px;
    }
    
    .example-text {
      font-size: 14px;
    }
  }

  /* Very large screens */
  @media (min-width: 1600px) {
    .popup-container {
      max-width: calc(var(--popup-max-width) * 1.2);
      font-size: calc(var(--popup-font-size) * 1.1);
    }
    
    .word-title {
      font-size: 22px;
    }
    
    .translation-text {
      font-size: 18px;
    }
  }

  /* Touch device optimizations */
  @media (hover: none) and (pointer: coarse) {
    .action-button {
      padding: 12px 16px;
      font-size: 14px;
      min-height: 44px; /* iOS recommended touch target size */
    }
    
    .close-button {
      padding: 12px;
      font-size: 18px;
      min-width: 44px;
      min-height: 44px;
    }
  }

  /* High contrast mode */
  @media (prefers-contrast: high) {
    .popup-container {
      border: 2px solid #000;
      background: #fff;
    }
    
    .close-button:hover {
      background: #000;
      color: #fff;
    }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .popup-container {
      transition: none;
    }
    
    .spinner {
      animation: none;
    }
  }
`;

// ========================================
// Main Word Lookup Popup Component
// ========================================

export class WordLookupPopup {
  private container: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private popupContainer: HTMLElement | null = null;
  
  private config: WordLookupConfig;
  private isVisible: boolean = false;
  private isLoading: boolean = false;
  private currentWord: string = '';
  private autoHideTimeout: ReturnType<typeof setTimeout> | null = null;
  
  private dictionaryService: DictionaryApiService;
  private translationService: TranslationApiService;
  private ttsService: TTSService;
  private storageService: StorageService;
  
  private events: { [K in keyof PopupEvents]?: PopupEvents[K] } = {};
  
  constructor(
    dictionaryService: DictionaryApiService,
    translationService: TranslationApiService,
    ttsService: TTSService,
    storageService: StorageService,
    config?: Partial<WordLookupConfig>
  ) {
    this.dictionaryService = dictionaryService;
    this.translationService = translationService;
    this.ttsService = ttsService;
    this.storageService = storageService;
    
    this.config = {
      maxWidth: 400,
      maxHeight: 600,
      borderRadius: 12,
      backgroundColor: '#ffffff',
      textColor: '#2d3748',
      accentColor: '#4299e1',
      shadowColor: 'rgba(0, 0, 0, 0.15)',
      animationDuration: 250,
      fontSize: 14,
      padding: 20,
      zIndex: 2147483647,
      autoHideDelay: 0,
      enableAnimations: true,
      showPhonetics: true,
      showExamples: true,
      enableTTS: true,
      enableVocabulary: true,
      ...config
    };
    
    this.initialize();
  }

  // ========================================
  // Initialization and Setup
  // ========================================

  private initialize(): void {
    this.createContainer();
    this.createShadowDOM();
    this.setupEventListeners();
  }

  private createContainer(): void {
    this.container = document.createElement('div');
    this.container.id = 'linguatube-word-lookup-popup';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      z-index: ${this.config.zIndex};
      pointer-events: none;
    `;
    
    // Append to body
    document.body.appendChild(this.container);
  }

  private createShadowDOM(): void {
    if (!this.container) return;

    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });
    
    // Create and inject styles
    const styleSheet = document.createElement('style');
    styleSheet.textContent = POPUP_STYLES;
    this.shadowRoot.appendChild(styleSheet);
    
    // Create popup container
    this.popupContainer = document.createElement('div');
    this.popupContainer.className = 'popup-container';
    this.shadowRoot.appendChild(this.popupContainer);
    
    // Apply configuration
    this.applyConfiguration();
  }

  private applyConfiguration(): void {
    if (!this.shadowRoot || !this.container) return;

    const host = this.shadowRoot.host as HTMLElement;
    host.style.setProperty('--popup-max-width', `${this.config.maxWidth}px`);
    host.style.setProperty('--popup-max-height', `${this.config.maxHeight}px`);
    host.style.setProperty('--popup-border-radius', `${this.config.borderRadius}px`);
    host.style.setProperty('--popup-bg-color', this.config.backgroundColor);
    host.style.setProperty('--popup-text-color', this.config.textColor);
    host.style.setProperty('--popup-accent-color', this.config.accentColor);
    host.style.setProperty('--popup-shadow-color', this.config.shadowColor);
    host.style.setProperty('--popup-animation-duration', `${this.config.animationDuration}ms`);
    host.style.setProperty('--popup-font-size', `${this.config.fontSize}px`);
    host.style.setProperty('--popup-padding', `${this.config.padding}px`);
    host.style.setProperty('--popup-z-index', this.config.zIndex.toString());
  }

  private setupEventListeners(): void {
    // Close on escape key
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });

    // Close on click outside
    document.addEventListener('click', (event) => {
      if (this.isVisible && !this.container?.contains(event.target as Node)) {
        this.hide();
      }
    });
  }

  // ========================================
  // Public API
  // ========================================

  public async show(word: string, position: { x: number; y: number }): Promise<void> {
    if (this.isVisible) {
      this.hide();
    }

    this.currentWord = word;
    this.isVisible = true;
    this.isLoading = true;
    
    // Position popup
    this.positionPopup(position);
    
    // Show loading state
    this.showLoadingState();
    
    // Make visible
    if (this.popupContainer) {
      this.popupContainer.classList.add('visible');
    }
    
    // Trigger event
    this.events.onShow?.();
    
    // Load content
    try {
      const content = await this.loadWordContent(word);
      this.updateContent(content);
    } catch (error) {
      this.showErrorState(error as Error);
      this.events.onError?.(error as Error);
    } finally {
      this.isLoading = false;
    }
    
    // Set up auto-hide
    this.setupAutoHide();
  }

  public hide(): void {
    if (!this.isVisible) return;

    this.isVisible = false;
    
    if (this.popupContainer) {
      this.popupContainer.classList.remove('visible');
    }
    
    // Clear auto-hide timeout
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }
    
    // Trigger event
    this.events.onHide?.();
  }

  public updateContent(content: PopupContent): void {
    if (!this.popupContainer) return;

    this.popupContainer.classList.remove('loading', 'error');
    this.popupContainer.innerHTML = this.renderContent(content);
    this.attachEventHandlers();
  }

  public destroy(): void {
    this.hide();
    
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    
    this.container = null;
    this.shadowRoot = null;
    this.popupContainer = null;
  }

  // ========================================
  // Event Handlers
  // ========================================

  public on(event: keyof PopupEvents, callback: (...args: any[]) => void): void {
    this.events[event] = callback;
  }

  public off(event: keyof PopupEvents): void {
    delete this.events[event];
  }

  // ========================================
  // Content Loading and Rendering
  // ========================================

  private async loadWordContent(word: string): Promise<PopupContent> {
    // Get word definition and translation
    const [definition, translation] = await Promise.all([
      this.dictionaryService.getDefinition(word),
      this.translationService.translateText({
        text: word,
        fromLanguage: 'en',
        toLanguage: 'es'
      })
    ]);

    return {
      word,
      translation,
      phonetic: definition.phonetics?.[0]?.text || '',
      definitions: definition.meanings.map((meaning: any) => ({
        text: meaning.definitions[0]?.definition || '',
        partOfSpeech: meaning.partOfSpeech,
        level: 'intermediate' as const
      })),
      examples: definition.meanings.flatMap((meaning: any) => 
        meaning.definitions.slice(0, 2).map((def: any) => ({
          text: def.example || '',
          translation: '',
          source: 'dictionary'
        }))
      ).filter((ex: any) => ex.text),
      partOfSpeech: definition.meanings[0]?.partOfSpeech || '',
      sourceLanguage: 'en',
      targetLanguage: 'es'
    };
  }

  private renderContent(content: PopupContent): string {
    return `
      <div class="popup-header">
        <div>
          <h3 class="word-title">${this.escapeHtml(content.word)}</h3>
          ${content.phonetic && this.config.showPhonetics ? 
            `<span class="phonetic">${this.escapeHtml(content.phonetic)}</span>` : ''}
        </div>
        <button class="close-button" type="button" aria-label="Close">×</button>
      </div>
      
      <div class="translation-section">
        <p class="translation-text">${this.escapeHtml(content.translation)}</p>
        ${content.partOfSpeech ? 
          `<span class="part-of-speech">${this.escapeHtml(content.partOfSpeech)}</span>` : ''}
      </div>
      
      ${content.definitions.length > 0 ? `
        <div class="definitions-section">
          <h4 class="section-title">Definitions</h4>
          ${content.definitions.map(def => `
            <div class="definition-item">
              <p class="definition-text">${this.escapeHtml(def.text)}</p>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      ${content.examples.length > 0 && this.config.showExamples ? `
        <div class="examples-section">
          <h4 class="section-title">Examples</h4>
          ${content.examples.slice(0, 3).map(ex => `
            <div class="example-item">
              <p class="example-text">${this.escapeHtml(ex.text)}</p>
              ${ex.translation ? 
                `<p class="example-translation">${this.escapeHtml(ex.translation)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      <div class="actions-section">
        ${this.config.enableTTS ? `
          <button class="action-button" type="button" data-action="tts">
            🔊 Listen
          </button>
        ` : ''}
        ${this.config.enableVocabulary ? `
          <button class="action-button primary" type="button" data-action="save">
            💾 Save Word
          </button>
        ` : ''}
      </div>
    `;
  }

  private showLoadingState(): void {
    if (!this.popupContainer) return;

    this.popupContainer.classList.add('loading');
    this.popupContainer.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <span>Loading word information...</span>
      </div>
    `;
  }

  private showErrorState(error: Error): void {
    if (!this.popupContainer) return;

    this.popupContainer.classList.add('error');
    this.popupContainer.innerHTML = `
      <div class="error-message">
        <span class="error-icon">⚠️</span>
        <span>Failed to load word information: ${this.escapeHtml(error.message)}</span>
        <button class="retry-button" type="button" data-action="retry">Retry</button>
      </div>
    `;
    
    this.attachEventHandlers();
  }

  private attachEventHandlers(): void {
    if (!this.popupContainer) return;

    // Close button
    const closeButton = this.popupContainer.querySelector('.close-button');
    closeButton?.addEventListener('click', () => this.hide());

    // Action buttons
    const actionButtons = this.popupContainer.querySelectorAll('[data-action]');
    actionButtons.forEach(button => {
      button.addEventListener('click', (event) => {
        const action = (event.target as HTMLElement).getAttribute('data-action');
        this.handleAction(action);
      });
    });
  }

  private async handleAction(action: string | null): Promise<void> {
    if (!action) return;

    switch (action) {
      case 'tts':
        await this.playTTS();
        break;
      case 'save':
        await this.saveWord();
        break;
      case 'retry':
        await this.retryLoad();
        break;
    }
  }

  private async playTTS(): Promise<void> {
    if (!this.currentWord) return;

    try {
      await this.ttsService.speak(this.currentWord);
      this.events.onTTSPlayed?.(this.currentWord);
    } catch (error) {
      console.error('[WordLookupPopup] TTS failed:', error);
      this.events.onError?.(error as Error);
    }
  }

  private async saveWord(): Promise<void> {
    if (!this.currentWord) return;

    try {
      await this.storageService.saveWord({
        word: this.currentWord,
        translation: '', // This would be populated from current content
        context: '',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        videoId: '',
        videoTitle: '',
        timestamp: Date.now(),
        reviewCount: 0
      });
      
      this.events.onWordSaved?.(this.currentWord);
    } catch (error) {
      console.error('[WordLookupPopup] Save word failed:', error);
      this.events.onError?.(error as Error);
    }
  }

  private async retryLoad(): Promise<void> {
    if (!this.currentWord) return;

    this.isLoading = true;
    this.showLoadingState();
    
    try {
      const content = await this.loadWordContent(this.currentWord);
      this.updateContent(content);
    } catch (error) {
      this.showErrorState(error as Error);
      this.events.onError?.(error as Error);
    } finally {
      this.isLoading = false;
    }
  }

  // ========================================
  // Advanced Positioning Logic
  // ========================================

  private positionPopup(position: { x: number; y: number }): void {
    if (!this.popupContainer) return;

    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    const popupRect = {
      width: this.config.maxWidth,
      height: this.config.maxHeight
    };

    // Get YouTube-specific UI elements to avoid
    const youtubeElements = this.getYouTubeUIElements();
    
    // Calculate best position with smart placement
    const placement = this.calculateSmartPlacement(position, viewport, popupRect, youtubeElements);
    
    // Apply positioning with smooth transition
    this.popupContainer.style.left = `${placement.x}px`;
    this.popupContainer.style.top = `${placement.y}px`;
    
    // Add positioning classes for CSS styling
    this.updatePositionClasses(placement, position);
  }

  private getYouTubeUIElements(): Array<{ rect: DOMRect; priority: number; name: string }> {
    const elements: Array<{ rect: DOMRect; priority: number; name: string }> = [];
    
    // High priority elements (critical to avoid)
    const playerControls = document.querySelector('.ytp-chrome-bottom');
    if (playerControls) {
      elements.push({
        rect: playerControls.getBoundingClientRect(),
        priority: 10,
        name: 'player-controls'
      });
    }
    
    const topBar = document.querySelector('#masthead');
    if (topBar) {
      elements.push({
        rect: topBar.getBoundingClientRect(),
        priority: 9,
        name: 'top-bar'
      });
    }
    
    // Medium priority elements
    const sidebar = document.querySelector('#secondary');
    if (sidebar) {
      elements.push({
        rect: sidebar.getBoundingClientRect(),
        priority: 7,
        name: 'sidebar'
      });
    }
    
    const chat = document.querySelector('#chat');
    if (chat) {
      elements.push({
        rect: chat.getBoundingClientRect(),
        priority: 6,
        name: 'chat'
      });
    }
    
    // Lower priority elements
    const description = document.querySelector('#description');
    if (description) {
      elements.push({
        rect: description.getBoundingClientRect(),
        priority: 4,
        name: 'description'
      });
    }
    
    const comments = document.querySelector('#comments');
    if (comments) {
      elements.push({
        rect: comments.getBoundingClientRect(),
        priority: 3,
        name: 'comments'
      });
    }
    
    return elements;
  }

  private calculateSmartPlacement(
    position: { x: number; y: number },
    viewport: { width: number; height: number },
    popupRect: { width: number; height: number },
    youtubeElements: Array<{ rect: DOMRect; priority: number; name: string }>
  ): { x: number; y: number; placement: string } {
    const offset = 12;
    const arrowOffset = 8;
    
    // Define possible positions in priority order
    const placements = [
      { name: 'bottom-center', x: position.x - (popupRect.width / 2), y: position.y + arrowOffset },
      { name: 'top-center', x: position.x - (popupRect.width / 2), y: position.y - popupRect.height - arrowOffset },
      { name: 'right-center', x: position.x + arrowOffset, y: position.y - (popupRect.height / 2) },
      { name: 'left-center', x: position.x - popupRect.width - arrowOffset, y: position.y - (popupRect.height / 2) },
      { name: 'bottom-left', x: position.x - offset, y: position.y + arrowOffset },
      { name: 'bottom-right', x: position.x - popupRect.width + offset, y: position.y + arrowOffset },
      { name: 'top-left', x: position.x - offset, y: position.y - popupRect.height - arrowOffset },
      { name: 'top-right', x: position.x - popupRect.width + offset, y: position.y - popupRect.height - arrowOffset }
    ];
    
    // Find the best position
    let bestPlacement = placements[0];
    let bestScore = -Infinity;
    
    for (const placement of placements) {
      const score = this.scorePlacement(placement, viewport, popupRect, youtubeElements, offset);
      if (score > bestScore) {
        bestScore = score;
        bestPlacement = placement;
      }
    }
    
    // Apply final viewport adjustments
    const finalPosition = this.adjustForViewport(bestPlacement, popupRect, viewport, offset);
    
    return {
      x: finalPosition.x,
      y: finalPosition.y,
      placement: bestPlacement.name
    };
  }

  private scorePlacement(
    placement: { name: string; x: number; y: number },
    viewport: { width: number; height: number },
    popupRect: { width: number; height: number },
    youtubeElements: Array<{ rect: DOMRect; priority: number; name: string }>,
    offset: number
  ): number {
    let score = 0;
    
    const popupBounds = {
      left: placement.x,
      right: placement.x + popupRect.width,
      top: placement.y,
      bottom: placement.y + popupRect.height
    };
    
    // Penalty for going outside viewport
    if (popupBounds.left < offset) score -= 100;
    if (popupBounds.right > viewport.width - offset) score -= 100;
    if (popupBounds.top < offset) score -= 100;
    if (popupBounds.bottom > viewport.height - offset) score -= 100;
    
    // Bonus for staying well within viewport
    const marginLeft = popupBounds.left - offset;
    const marginRight = viewport.width - popupBounds.right - offset;
    const marginTop = popupBounds.top - offset;
    const marginBottom = viewport.height - popupBounds.bottom - offset;
    
    score += Math.min(marginLeft, marginRight) * 0.1;
    score += Math.min(marginTop, marginBottom) * 0.1;
    
    // Penalty for overlapping with YouTube elements
    for (const element of youtubeElements) {
      const overlap = this.calculateOverlap(popupBounds, element.rect);
      if (overlap > 0) {
        score -= overlap * element.priority;
      }
    }
    
    // Bonus for preferred positions (bottom-center is most natural)
    const positionBonus = {
      'bottom-center': 20,
      'top-center': 15,
      'right-center': 10,
      'left-center': 10,
      'bottom-left': 5,
      'bottom-right': 5,
      'top-left': 3,
      'top-right': 3
    };
    
    score += positionBonus[placement.name as keyof typeof positionBonus] || 0;
    
    return score;
  }

  private calculateOverlap(
    rect1: { left: number; right: number; top: number; bottom: number },
    rect2: DOMRect
  ): number {
    const left = Math.max(rect1.left, rect2.left);
    const right = Math.min(rect1.right, rect2.right);
    const top = Math.max(rect1.top, rect2.top);
    const bottom = Math.min(rect1.bottom, rect2.bottom);
    
    if (left < right && top < bottom) {
      return (right - left) * (bottom - top);
    }
    
    return 0;
  }

  private adjustForViewport(
    placement: { name: string; x: number; y: number },
    popupRect: { width: number; height: number },
    viewport: { width: number; height: number },
    offset: number
  ): { x: number; y: number } {
    let { x, y } = placement;
    
    // Adjust horizontal position
    if (x < offset) {
      x = offset;
    } else if (x + popupRect.width > viewport.width - offset) {
      x = viewport.width - popupRect.width - offset;
    }
    
    // Adjust vertical position
    if (y < offset) {
      y = offset;
    } else if (y + popupRect.height > viewport.height - offset) {
      y = viewport.height - popupRect.height - offset;
    }
    
    return { x, y };
  }

  private updatePositionClasses(
    placement: { x: number; y: number; placement: string },
    originalPosition: { x: number; y: number }
  ): void {
    if (!this.popupContainer) return;
    
    // Remove existing position classes
    const positionClasses = ['position-top', 'position-bottom', 'position-left', 'position-right'];
    this.popupContainer.classList.remove(...positionClasses);
    
    // Add new position class based on placement
    if (placement.placement.includes('top')) {
      this.popupContainer.classList.add('position-top');
    } else if (placement.placement.includes('bottom')) {
      this.popupContainer.classList.add('position-bottom');
    }
    
    if (placement.placement.includes('left')) {
      this.popupContainer.classList.add('position-left');
    } else if (placement.placement.includes('right')) {
      this.popupContainer.classList.add('position-right');
    }
    
    // Add responsive positioning class
    if (window.innerWidth <= 768) {
      this.popupContainer.classList.add('position-mobile');
    } else {
      this.popupContainer.classList.remove('position-mobile');
    }
  }

  // ========================================
  // Utility Methods
  // ========================================

  private setupAutoHide(): void {
    if (this.config.autoHideDelay > 0) {
      this.autoHideTimeout = setTimeout(() => {
        this.hide();
      }, this.config.autoHideDelay);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
} 