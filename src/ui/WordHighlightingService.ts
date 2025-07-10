/**
 * Word Highlighting Service for LinguaTube
 * Provides efficient vocabulary word highlighting for subtitles and webpage content
 */

import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { VocabularyObserver, VocabularyEventType } from '../vocabulary/VocabularyObserver';
import { VocabularyItem } from '../storage/types';

// ========================================
// Types and Interfaces
// ========================================

export interface HighlightConfig {
  readonly className: string;
  readonly color: string;
  readonly backgroundColor: string;
  readonly borderColor?: string;
  readonly borderWidth?: string;
  readonly borderRadius?: string;
  readonly padding?: string;
  readonly fontSize?: string;
  readonly fontWeight?: string;
  readonly textShadow?: string;
  readonly boxShadow?: string;
  readonly transition?: string;
  readonly hoverColor?: string;
  readonly hoverBackgroundColor?: string;
  readonly caseSensitive: boolean;
  readonly showTooltip: boolean;
  readonly tooltipDelay: number;
  readonly animationDuration: number;
}

export interface HighlightContext {
  readonly element: HTMLElement;
  readonly originalText: string;
  highlightedWords: Set<string>;
  readonly config: HighlightConfig;
  observer?: MutationObserver;
}

export interface HighlightStats {
  readonly totalWords: number;
  readonly highlightedWords: number;
  readonly elementsProcessed: number;
  readonly processingTime: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface WordMatch {
  readonly word: string;
  readonly vocabularyItem: VocabularyItem;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly originalText: string;
}

// ========================================
// Default Configurations
// ========================================

export const DEFAULT_HIGHLIGHT_CONFIG: HighlightConfig = {
  className: 'lingua-vocabulary-highlight',
  color: '#000000',
  backgroundColor: 'rgba(255, 235, 59, 0.8)',
  borderColor: '#ffc107',
  borderWidth: '1px',
  borderRadius: '2px',
  padding: '1px 2px',
  fontSize: 'inherit',
  fontWeight: '600',
  textShadow: 'none',
  boxShadow: '0 0 4px rgba(255, 193, 7, 0.5)',
  transition: 'all 0.2s ease',
  hoverColor: '#000000',
  hoverBackgroundColor: 'rgba(255, 193, 7, 0.9)',
  caseSensitive: false,
  showTooltip: true,
  tooltipDelay: 500,
  animationDuration: 200,
};

export const SUBTITLE_HIGHLIGHT_CONFIG: HighlightConfig = {
  ...DEFAULT_HIGHLIGHT_CONFIG,
  className: 'lingua-subtitle-vocabulary-highlight',
  backgroundColor: 'rgba(255, 235, 59, 0.9)',
  boxShadow: '0 0 6px rgba(255, 193, 7, 0.7)',
  fontWeight: '700',
};

export const WEBPAGE_HIGHLIGHT_CONFIG: HighlightConfig = {
  ...DEFAULT_HIGHLIGHT_CONFIG,
  className: 'lingua-webpage-vocabulary-highlight',
  backgroundColor: 'rgba(255, 235, 59, 0.6)',
  boxShadow: '0 1px 3px rgba(255, 193, 7, 0.4)',
  fontWeight: '500',
};

// ========================================
// Word Highlighting Service
// ========================================

export class WordHighlightingService {
  private static instance: WordHighlightingService | null = null;
  
  private vocabularyManager: VocabularyManager;
  private vocabularyObserver: VocabularyObserver;
  
  private vocabularyCache = new Map<string, VocabularyItem>();
  private wordCache = new Map<string, boolean>();
  private lastCacheUpdate = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  private highlightContexts = new Map<string, HighlightContext>();
  private styleSheet: CSSStyleSheet | null = null;
  
  private stats: HighlightStats = {
    totalWords: 0,
    highlightedWords: 0,
    elementsProcessed: 0,
    processingTime: 0,
    cacheHits: 0,
    cacheMisses: 0,
  };

  private constructor() {
    this.vocabularyManager = VocabularyManager.getInstance();
    this.vocabularyObserver = VocabularyObserver.getInstance();
    this.setupEventListeners();
    this.createStyleSheet();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): WordHighlightingService {
    if (!WordHighlightingService.instance) {
      WordHighlightingService.instance = new WordHighlightingService();
    }
    return WordHighlightingService.instance;
  }

  // ========================================
  // Public API
  // ========================================

  /**
   * Highlight vocabulary words in an element
   */
  public async highlightElement(
    element: HTMLElement,
    config: Partial<HighlightConfig> = {}
  ): Promise<HighlightStats> {
    const startTime = performance.now();
    const finalConfig = { ...DEFAULT_HIGHLIGHT_CONFIG, ...config };
    const contextId = this.generateContextId(element);

    try {
      // Store context
      const context: HighlightContext = {
        element,
        originalText: element.innerHTML,
        highlightedWords: new Set(),
        config: finalConfig,
      };
      this.highlightContexts.set(contextId, context);

      // Get vocabulary words
      const vocabulary = await this.getVocabularyCached();
      if (vocabulary.length === 0) {
        return this.updateStats(startTime, 0, 0, 1);
      }

      // Process text content
      const result = await this.processElementContent(element, vocabulary, finalConfig);
      
      // Update context
      context.highlightedWords = new Set(result.highlightedWords);

      // Setup mutation observer for dynamic content
      if (finalConfig.showTooltip) {
        this.setupMutationObserver(element, contextId);
      }

      return this.updateStats(startTime, result.totalWords, result.highlightedWords.length, 1);

    } catch (error) {
      console.error('[WordHighlightingService] Error highlighting element:', error);
      return this.updateStats(startTime, 0, 0, 1);
    }
  }

  /**
   * Remove highlighting from an element
   */
  public removeHighlighting(element: HTMLElement): void {
    const contextId = this.generateContextId(element);
    const context = this.highlightContexts.get(contextId);
    
    if (context) {
      // Restore original content
      element.innerHTML = context.originalText;
      
      // Clean up observer
      if (context.observer) {
        context.observer.disconnect();
      }
      
      // Remove context
      this.highlightContexts.delete(contextId);
    } else {
      // Fallback: remove highlight elements
      const highlights = element.querySelectorAll('[class*="lingua-"][class*="highlight"]');
      highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(highlight.textContent || ''), highlight);
          parent.normalize();
        }
      });
    }
  }

  /**
   * Refresh highlighting for all tracked elements
   */
  public async refreshAllHighlighting(): Promise<void> {
    const contexts = Array.from(this.highlightContexts.entries());
    
    for (const [contextId, context] of contexts) {
      try {
        // Restore original content
        context.element.innerHTML = context.originalText;
        
        // Re-highlight with current vocabulary
        await this.highlightElement(context.element, context.config);
      } catch (error) {
        console.error('[WordHighlightingService] Error refreshing highlighting:', error);
        this.highlightContexts.delete(contextId);
      }
    }
  }

  /**
   * Highlight vocabulary words in text string
   */
  public async highlightText(
    text: string,
    config: Partial<HighlightConfig> = {}
  ): Promise<string> {
    const finalConfig = { ...DEFAULT_HIGHLIGHT_CONFIG, ...config };
    const vocabulary = await this.getVocabularyCached();
    
    if (vocabulary.length === 0) return text;

    return this.processTextContent(text, vocabulary, finalConfig);
  }

  /**
   * Check if a word is in vocabulary
   */
  public async isVocabularyWord(word: string): Promise<boolean> {
    const cleanWord = this.cleanWord(word);
    
    if (this.wordCache.has(cleanWord)) {
      this.stats.cacheHits++;
      return this.wordCache.get(cleanWord)!;
    }

    this.stats.cacheMisses++;
    const vocabulary = await this.getVocabularyCached();
    const isVocabulary = vocabulary.some(item => 
      this.cleanWord(item.word) === cleanWord
    );
    
    this.wordCache.set(cleanWord, isVocabulary);
    return isVocabulary;
  }

  /**
   * Get highlighting statistics
   */
  public getStats(): HighlightStats {
    return { ...this.stats };
  }

  /**
   * Clear all caches and reset statistics
   */
  public clearCaches(): void {
    this.vocabularyCache.clear();
    this.wordCache.clear();
    this.lastCacheUpdate = 0;
    this.stats = {
      totalWords: 0,
      highlightedWords: 0,
      elementsProcessed: 0,
      processingTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Destroy service and clean up resources
   */
  public destroy(): void {
    // Remove all highlighting
    for (const [contextId, context] of this.highlightContexts.entries()) {
      this.removeHighlighting(context.element);
    }
    
    // Clear caches
    this.clearCaches();
    
    // Remove event listeners
    this.vocabularyObserver.off(VocabularyEventType.WORD_ADDED);
    this.vocabularyObserver.off(VocabularyEventType.WORD_REMOVED);
    this.vocabularyObserver.off(VocabularyEventType.VOCABULARY_CLEARED);
    this.vocabularyObserver.off(VocabularyEventType.VOCABULARY_IMPORTED);
    
    // Remove stylesheet
    if (this.styleSheet && document.adoptedStyleSheets.includes(this.styleSheet)) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
        sheet => sheet !== this.styleSheet
      );
    }
    
    WordHighlightingService.instance = null;
  }

  // ========================================
  // Private Methods
  // ========================================

  private setupEventListeners(): void {
    this.vocabularyObserver.on(VocabularyEventType.WORD_ADDED, () => {
      this.invalidateCache();
      this.refreshAllHighlighting();
    });

    this.vocabularyObserver.on(VocabularyEventType.WORD_REMOVED, () => {
      this.invalidateCache();
      this.refreshAllHighlighting();
    });

    this.vocabularyObserver.on(VocabularyEventType.VOCABULARY_CLEARED, () => {
      this.invalidateCache();
      this.refreshAllHighlighting();
    });

    this.vocabularyObserver.on(VocabularyEventType.VOCABULARY_IMPORTED, () => {
      this.invalidateCache();
      this.refreshAllHighlighting();
    });
  }

  private createStyleSheet(): void {
    try {
      this.styleSheet = new CSSStyleSheet();
      this.styleSheet.replaceSync(`
        .lingua-vocabulary-highlight {
          position: relative;
          cursor: pointer;
          display: inline;
        }
        
        .lingua-vocabulary-highlight:hover {
          transform: scale(1.02);
        }
        
        .lingua-vocabulary-highlight[data-tooltip]:hover::after {
          content: attr(data-tooltip);
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.9);
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          white-space: nowrap;
          z-index: 10000;
          pointer-events: none;
        }
        
        @media (prefers-reduced-motion: reduce) {
          .lingua-vocabulary-highlight {
            transition: none;
            transform: none;
          }
          
          .lingua-vocabulary-highlight:hover {
            transform: none;
          }
        }
      `);
      
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.styleSheet];
    } catch (error) {
      console.warn('[WordHighlightingService] Could not create stylesheet:', error);
    }
  }

  private async processElementContent(
    element: HTMLElement,
    vocabulary: VocabularyItem[],
    config: HighlightConfig
  ): Promise<{ totalWords: number; highlightedWords: string[] }> {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null
    );

    const textNodes: Text[] = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node as Text);
    }

    let totalWords = 0;
    const highlightedWords: string[] = [];

    for (const textNode of textNodes) {
      const result = this.processTextNode(textNode, vocabulary, config);
      totalWords += result.totalWords;
      highlightedWords.push(...result.highlightedWords);
    }

    return { totalWords, highlightedWords };
  }

  private processTextNode(
    textNode: Text,
    vocabulary: VocabularyItem[],
    config: HighlightConfig
  ): { totalWords: number; highlightedWords: string[] } {
    const text = textNode.textContent || '';
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const highlightedWords: string[] = [];

    if (words.length === 0) {
      return { totalWords: 0, highlightedWords };
    }

    const highlightedText = this.processTextContent(text, vocabulary, config);
    
    if (highlightedText !== text) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = highlightedText;
      
      const parent = textNode.parentNode;
      if (parent) {
        while (tempDiv.firstChild) {
          parent.insertBefore(tempDiv.firstChild, textNode);
        }
        parent.removeChild(textNode);
        
        // Count highlighted words
        const highlights = tempDiv.querySelectorAll(`.${config.className}`);
        highlights.forEach(highlight => {
          const word = this.cleanWord(highlight.textContent || '');
          if (word) highlightedWords.push(word);
        });
      }
    }

    return { totalWords: words.length, highlightedWords };
  }

  private processTextContent(
    text: string,
    vocabulary: VocabularyItem[],
    config: HighlightConfig
  ): string {
    if (!text || vocabulary.length === 0) return text;

    // Create word map for efficient lookup
    const wordMap = new Map<string, VocabularyItem>();
    vocabulary.forEach(item => {
      const key = config.caseSensitive ? item.word : item.word.toLowerCase();
      wordMap.set(key, item);
    });

    // Sort words by length (longest first) to avoid partial matches
    const sortedWords = Array.from(wordMap.keys()).sort((a, b) => b.length - a.length);
    
    if (sortedWords.length === 0) return text;

    // Create regex pattern
    const pattern = sortedWords.map(word => this.escapeRegExp(word)).join('|');
    const flags = config.caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(`\\b(${pattern})\\b`, flags);

    return text.replace(regex, (match) => {
      const lookupKey = config.caseSensitive ? match : match.toLowerCase();
      const vocabularyItem = wordMap.get(lookupKey);
      
      if (!vocabularyItem) return match;

      const style = this.buildInlineStyle(config);
      const tooltip = config.showTooltip ? ` data-tooltip="${vocabularyItem.translation}"` : '';
      
      return `<span class="${config.className}" style="${style}"${tooltip}>${match}</span>`;
    });
  }

  private buildInlineStyle(config: HighlightConfig): string {
    const styles = [
      `color: ${config.color}`,
      `background-color: ${config.backgroundColor}`,
      `padding: ${config.padding}`,
      `border-radius: ${config.borderRadius}`,
      `font-weight: ${config.fontWeight}`,
      `transition: ${config.transition}`,
    ];

    if (config.borderColor && config.borderWidth) {
      styles.push(`border: ${config.borderWidth} solid ${config.borderColor}`);
    }

    if (config.boxShadow) {
      styles.push(`box-shadow: ${config.boxShadow}`);
    }

    if (config.textShadow) {
      styles.push(`text-shadow: ${config.textShadow}`);
    }

    return styles.join('; ');
  }

  private setupMutationObserver(element: HTMLElement, contextId: string): void {
    const context = this.highlightContexts.get(contextId);
    if (!context) return;

    const observer = new MutationObserver((mutations) => {
      let shouldRefresh = false;
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          shouldRefresh = true;
          break;
        }
      }
      
      if (shouldRefresh) {
        setTimeout(() => {
          this.highlightElement(element, context.config);
        }, 100);
      }
    });

    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    context.observer = observer;
  }

  private async getVocabularyCached(): Promise<VocabularyItem[]> {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.CACHE_TTL) {
      const result = await this.vocabularyManager.getVocabulary();
      if (result.success && result.data) {
        this.vocabularyCache.clear();
        result.data.forEach(item => {
          this.vocabularyCache.set(item.id, item);
        });
        this.lastCacheUpdate = now;
      }
    }
    return Array.from(this.vocabularyCache.values());
  }

  private invalidateCache(): void {
    this.vocabularyCache.clear();
    this.wordCache.clear();
    this.lastCacheUpdate = 0;
  }

  private generateContextId(element: HTMLElement): string {
    return `highlight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private cleanWord(word: string): string {
    return word.replace(/[^\w]/g, '').toLowerCase();
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private updateStats(
    startTime: number,
    totalWords: number,
    highlightedWords: number,
    elementsProcessed: number
  ): HighlightStats {
    const processingTime = performance.now() - startTime;
    
    this.stats = {
      totalWords: this.stats.totalWords + totalWords,
      highlightedWords: this.stats.highlightedWords + highlightedWords,
      elementsProcessed: this.stats.elementsProcessed + elementsProcessed,
      processingTime: this.stats.processingTime + processingTime,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
    };

    return { ...this.stats };
  }
}

// ========================================
// Convenience Functions
// ========================================

/**
 * Highlight vocabulary words in an element (convenience function)
 */
export async function highlightVocabularyInElement(
  element: HTMLElement,
  config?: Partial<HighlightConfig>
): Promise<HighlightStats> {
  const service = WordHighlightingService.getInstance();
  return service.highlightElement(element, config);
}

/**
 * Remove vocabulary highlighting from an element (convenience function)
 */
export function removeVocabularyHighlighting(element: HTMLElement): void {
  const service = WordHighlightingService.getInstance();
  service.removeHighlighting(element);
}

/**
 * Highlight vocabulary words in text (convenience function)
 */
export async function highlightVocabularyInText(
  text: string,
  config?: Partial<HighlightConfig>
): Promise<string> {
  const service = WordHighlightingService.getInstance();
  return service.highlightText(text, config);
} 