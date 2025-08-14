/**
 * Word Lookup Popup Component for LinguaTube
 * Displays an interactive popup with word translation, definition, and vocabulary controls
 * Uses shadow DOM for complete isolation from YouTube's styles
 */

import { DictionaryApiService } from '../translation/DictionaryApiService';
import { TranslationApiService } from '../translation/TranslationApiService';
import { translationCacheService } from '../translation/TranslationCacheService';
import { TTSService } from '../translation/TTSService';
import { StorageService } from '../storage';
import { VocabularyManager } from '../vocabulary/VocabularyManager';
import { vocabularyObserver } from '../vocabulary/VocabularyObserver';
import { Logger } from '../logging';
import { ComponentType } from '../logging/types';

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
// Enhanced Error Handling System
// ========================================

export enum ErrorType {
  NETWORK = 'NETWORK',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  RATE_LIMIT = 'RATE_LIMIT',
  TIMEOUT = 'TIMEOUT',
  VALIDATION = 'VALIDATION',
  TRANSLATION_FAILED = 'TRANSLATION_FAILED',
  DICTIONARY_FAILED = 'DICTIONARY_FAILED',
  PARTIAL_FAILURE = 'PARTIAL_FAILURE',
  TTS_FAILED = 'TTS_FAILED',
  STORAGE_FAILED = 'STORAGE_FAILED',
  UNKNOWN = 'UNKNOWN',
}

export enum ErrorSeverity {
  LOW = 'LOW', // Minor issues, user can continue
  MEDIUM = 'MEDIUM', // Some functionality affected
  HIGH = 'HIGH', // Major functionality broken
  CRITICAL = 'CRITICAL', // Complete failure
}

export interface ErrorContext {
  readonly type: ErrorType;
  readonly severity: ErrorSeverity;
  readonly message: string;
  readonly userMessage: string;
  readonly guidance: string;
  readonly retryable: boolean;
  readonly autoRetry: boolean;
  readonly retryDelay: number; // ms
  readonly maxRetries: number;
  readonly fallbackAvailable: boolean;
  readonly originalError: Error;
  readonly timestamp: number;
  readonly context: {
    readonly word?: string;
    readonly service?: string;
    readonly operation?: string;
    readonly attempt?: number;
  };
}

export interface ErrorState {
  readonly hasError: boolean;
  readonly currentError: ErrorContext | null;
  readonly retryCount: number;
  readonly lastRetryTime: number;
  readonly isRetrying: boolean;
  readonly errorHistory: ErrorContext[];
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
    will-change: transform, opacity;
  }

  .popup-container.visible {
    transform: scale(1) translateY(0);
    opacity: 1;
  }

  /* Position-based entrance animations */
  .popup-container.position-top {
    transform-origin: bottom center;
    transform: scale(0.8) translateY(-20px);
  }

  .popup-container.position-top.visible {
    transform: scale(1) translateY(0);
  }

  .popup-container.position-bottom {
    transform-origin: top center;
    transform: scale(0.8) translateY(20px);
  }

  .popup-container.position-bottom.visible {
    transform: scale(1) translateY(0);
  }

  .popup-container.position-left {
    transform-origin: right center;
    transform: scale(0.8) translateX(-20px);
  }

  .popup-container.position-left.visible {
    transform: scale(1) translateX(0);
  }

  .popup-container.position-right {
    transform-origin: left center;
    transform: scale(0.8) translateX(20px);
  }

  .popup-container.position-right.visible {
    transform: scale(1) translateX(0);
  }

  /* Exit animations */
  .popup-container.hiding {
    transform: scale(0.9) translateY(-5px);
    opacity: 0;
    transition: all calc(var(--popup-animation-duration) * 0.8) cubic-bezier(0.4, 0, 1, 1);
  }

  .popup-container.position-top.hiding {
    transform: scale(0.9) translateY(-10px);
  }

  .popup-container.position-bottom.hiding {
    transform: scale(0.9) translateY(10px);
  }

  .popup-container.position-left.hiding {
    transform: scale(0.9) translateX(-10px);
  }

  .popup-container.position-right.hiding {
    transform: scale(0.9) translateX(10px);
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

  /* Positioning arrows with animations */
  .popup-container::before {
    content: '';
    position: absolute;
    opacity: 0;
    transition: opacity calc(var(--popup-animation-duration) * 0.6) ease;
    z-index: -1;
  }

  .popup-container.visible::before {
    opacity: 1;
    transition-delay: calc(var(--popup-animation-duration) * 0.4);
  }

  .popup-container.position-top::before {
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

  /* Loading state animations */
  .loading-spinner {
    display: inline-block;
    width: 24px;
    height: 24px;
    border: 3px solid rgba(0, 0, 0, 0.1);
    border-radius: 50%;
    border-top-color: var(--popup-accent-color);
    animation: spin 1s linear infinite;
    margin: 0 auto;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .loading-dots {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 4px;
    margin-top: 16px;
  }

  .loading-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--popup-accent-color);
    animation: pulse 1.5s ease-in-out infinite;
  }

  .loading-dot:nth-child(1) { animation-delay: 0s; }
  .loading-dot:nth-child(2) { animation-delay: 0.2s; }
  .loading-dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes pulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }

  /* Skeleton loading UI */
  .skeleton {
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: shimmer 2s infinite;
    border-radius: 4px;
  }

  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  .skeleton-text {
    height: 16px;
    margin: 8px 0;
  }

  .skeleton-text.large {
    height: 24px;
    width: 70%;
  }

  .skeleton-text.medium {
    height: 18px;
    width: 85%;
  }

  .skeleton-text.small {
    height: 14px;
    width: 60%;
  }

  .skeleton-button {
    height: 36px;
    width: 80px;
    border-radius: 6px;
  }

  /* Loading timeout warning */
  .loading-timeout {
    color: #f56565;
    font-size: 12px;
    margin-top: 8px;
    text-align: center;
  }

  /* Action loading states */
  .action-button.loading {
    position: relative;
    pointer-events: none;
  }

  .action-button.loading::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 16px;
    height: 16px;
    margin: -8px 0 0 -8px;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .action-button.loading .button-text {
    opacity: 0;
  }

  .action-button:focus {
    outline: 2px solid var(--popup-accent-color);
    outline-offset: 2px;
  }

  .action-button:focus:not(:focus-visible) {
    outline: none;
  }

  .action-button:focus-visible {
    outline: 2px solid var(--popup-accent-color);
    outline-offset: 2px;
  }

  /* Content reveal animations */
  .popup-content {
    opacity: 0;
    transform: translateY(8px);
    transition: all calc(var(--popup-animation-duration) * 0.6) ease;
    transition-delay: calc(var(--popup-animation-duration) * 0.2);
  }

  .popup-container.visible .popup-content {
    opacity: 1;
    transform: translateY(0);
  }

  .popup-header {
    opacity: 0;
    transform: translateY(-4px);
    transition: all calc(var(--popup-animation-duration) * 0.6) ease;
    transition-delay: calc(var(--popup-animation-duration) * 0.3);
  }

  .popup-container.visible .popup-header {
    opacity: 1;
    transform: translateY(0);
  }

  .translation-section,
  .definitions-section,
  .examples-section,
  .actions-section {
    opacity: 0;
    transform: translateY(6px);
    transition: all calc(var(--popup-animation-duration) * 0.6) ease;
  }

  .popup-container.visible .translation-section {
    opacity: 1;
    transform: translateY(0);
    transition-delay: calc(var(--popup-animation-duration) * 0.4);
  }

  .popup-container.visible .definitions-section {
    opacity: 1;
    transform: translateY(0);
    transition-delay: calc(var(--popup-animation-duration) * 0.5);
  }

  .popup-container.visible .examples-section {
    opacity: 1;
    transform: translateY(0);
    transition-delay: calc(var(--popup-animation-duration) * 0.6);
  }

  .popup-container.visible .actions-section {
    opacity: 1;
    transform: translateY(0);
    transition-delay: calc(var(--popup-animation-duration) * 0.7);
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

  .highlight {
    color: var(--popup-accent-color);
    font-weight: 600;
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
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  }

  .close-button::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.1);
    transform: translate(-50%, -50%);
    transition: all 0.3s ease;
  }

  .close-button:hover {
    color: #718096;
    background: rgba(0, 0, 0, 0.05);
    transform: scale(1.1);
  }

  .close-button:hover::before {
    width: 100%;
    height: 100%;
  }

  .close-button:active {
    transform: scale(0.95);
  }

  .close-button:focus {
    outline: 2px solid var(--popup-accent-color);
    outline-offset: 2px;
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

  .definitions-section ul,
  .examples-section ul {
    list-style: none;
    padding: 0;
    margin: 0;
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

  .context-section {
    margin-bottom: 16px;
    padding: 12px;
    background: rgba(113, 128, 150, 0.05);
    border-radius: 8px;
    border-left: 3px solid #718096;
  }

  .context-text {
    font-size: 14px;
    color: var(--popup-text-color);
    line-height: 1.5;
    margin: 0 0 8px 0;
    font-style: italic;
  }

  .context-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .context-button {
    background: transparent;
    border: 1px solid #718096;
    border-radius: 4px;
    color: #718096;
    font-size: 11px;
    padding: 4px 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .context-button:hover {
    background: #718096;
    color: white;
  }

  .context-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .context-button.loading {
    position: relative;
    pointer-events: none;
  }

  .context-button.loading::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border: 1px solid transparent;
    border-top: 1px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .context-button.loading .button-text {
    opacity: 0;
  }

  .context-label {
    font-size: 11px;
    color: #a0aec0;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 500;
  }

  .ai-enhancement {
    margin-top: 16px;
    padding: 12px;
    background: rgba(66, 153, 225, 0.03);
    border-radius: 8px;
    border-left: 3px solid var(--popup-accent-color);
  }

  .ai-enhancement-header {
    margin-bottom: 8px;
  }

  .ai-enhancement-label {
    font-size: 11px;
    color: var(--popup-accent-color);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
  }

  .ai-enhancement-content {
    max-height: 200px;
    overflow-y: auto;
  }

  .ai-enhancement-text {
    font-size: 13px;
    color: var(--popup-text-color);
    line-height: 1.4;
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    position: relative;
    overflow: hidden;
    will-change: transform, background-color;
    min-width: 120px;
  }

  .action-button::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 0;
    height: 0;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 50%;
    transform: translate(-50%, -50%);
    transition: width 0.3s ease, height 0.3s ease;
  }

  .action-button:hover {
    background: var(--popup-accent-color);
    color: white;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .action-button:hover::before {
    width: 100%;
    height: 100%;
  }

  .action-button:active {
    transform: translateY(0);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
  }

  .action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .action-button.primary {
    background: var(--popup-accent-color);
    color: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .action-button.primary::before {
    background: rgba(255, 255, 255, 0.15);
  }

  .action-button.primary:hover {
    background: #3182ce;
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
  }

  .action-button.primary:active {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .loading-spinner {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    color: #718096;
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
    
    .context-section {
      margin-bottom: 12px;
      padding: 10px;
    }
    
    .context-text {
      font-size: 13px;
      margin-bottom: 6px;
    }
    
    .context-controls {
      gap: 6px;
    }
    
    .context-button {
      font-size: 10px;
      padding: 3px 6px;
    }
    
    .context-label {
      font-size: 10px;
    }

    .ai-enhancement {
      margin-top: 12px;
      padding: 10px;
    }

    .ai-enhancement-label {
      font-size: 10px;
    }

    .ai-enhancement-text {
      font-size: 12px;
    }

    .ai-enhancement-content {
      max-height: 150px;
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
    
    .context-section {
      margin-bottom: 10px;
      padding: 8px;
    }
    
    .context-text {
      font-size: 12px;
      margin-bottom: 5px;
    }
    
    .context-controls {
      gap: 5px;
    }
    
    .context-button {
      font-size: 9px;
      padding: 2px 5px;
    }
    
    .context-label {
      font-size: 9px;
    }

    .ai-enhancement {
      margin-top: 10px;
      padding: 8px;
    }

    .ai-enhancement-label {
      font-size: 9px;
    }

    .ai-enhancement-text {
      font-size: 11px;
    }

    .ai-enhancement-content {
      max-height: 120px;
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
    
    .context-section {
      margin-bottom: 8px;
      padding: 6px;
    }
    
    .context-text {
      font-size: 11px;
      margin-bottom: 4px;
    }
    
    .context-controls {
      gap: 4px;
    }
    
    .context-button {
      font-size: 8px;
      padding: 2px 4px;
    }
    
    .context-label {
      font-size: 8px;
    }

    .ai-enhancement {
      margin-top: 8px;
      padding: 6px;
    }

    .ai-enhancement-label {
      font-size: 8px;
    }

    .ai-enhancement-text {
      font-size: 10px;
    }

    .ai-enhancement-content {
      max-height: 100px;
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
    
    .loading-spinner {
      animation: none;
    }
    
    .loading-dot {
      animation: none;
    }
  }

  /* ========================================
   * Enhanced Error States
   * ======================================== */

  .popup-container.error {
    border-left: 4px solid #e53e3e;
  }

  .error-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 24px 20px;
    text-align: center;
  }

  .error-icon {
    font-size: 32px;
    margin-bottom: 12px;
    display: block;
  }

  .error-icon.network { color: #f56565; }
  .error-icon.service { color: #ed8936; }
  .error-icon.timeout { color: #ecc94b; }
  .error-icon.validation { color: #9f7aea; }
  .error-icon.partial { color: #4299e1; }
  .error-icon.critical { color: #e53e3e; }

  .error-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--popup-text-color);
    margin-bottom: 8px;
  }

  .error-message {
    font-size: 14px;
    color: #718096;
    margin-bottom: 12px;
    line-height: 1.5;
  }

  .error-guidance {
    font-size: 13px;
    color: #a0aec0;
    margin-bottom: 20px;
    line-height: 1.4;
    max-width: 280px;
  }

  .error-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .error-retry-button {
    background: var(--popup-accent-color);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .error-retry-button:hover {
    background: #3182ce;
    transform: translateY(-1px);
  }

  .error-retry-button:disabled {
    background: #cbd5e0;
    cursor: not-allowed;
    transform: none;
  }

  .error-retry-button.retrying {
    background: #cbd5e0;
    cursor: not-allowed;
  }

  .error-secondary-button {
    background: transparent;
    color: var(--popup-accent-color);
    border: 1px solid var(--popup-accent-color);
    border-radius: 6px;
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .error-secondary-button:hover {
    background: var(--popup-accent-color);
    color: white;
  }

  .error-dismiss-button {
    background: transparent;
    color: #718096;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .error-dismiss-button:hover {
    background: #f7fafc;
    border-color: #cbd5e0;
  }

  .retry-countdown {
    font-size: 12px;
    color: #a0aec0;
    margin-top: 8px;
  }

  .error-details {
    margin-top: 16px;
    padding: 12px;
    background: #f7fafc;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
  }

  .error-details-toggle {
    background: none;
    border: none;
    color: #4299e1;
    font-size: 12px;
    cursor: pointer;
    text-decoration: underline;
  }

  .error-details-content {
    margin-top: 8px;
    font-size: 11px;
    color: #718096;
    font-family: monospace;
    white-space: pre-wrap;
    max-height: 100px;
    overflow-y: auto;
  }

  .partial-error-banner {
    background: #fef5e7;
    border: 1px solid #f6ad55;
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 16px;
    font-size: 13px;
    color: #c05621;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .offline-indicator {
    background: #fed7d7;
    border: 1px solid #fc8181;
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 16px;
    font-size: 13px;
    color: #c53030;
    display: flex;
    align-items: center;
    gap: 8px;
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
  private currentContext: string = '';
  private currentContextTranslation: string = '';
  private translation: string = '';
  private currentSourceLanguage: string = 'en'; // Default fallback
  private currentTargetLanguage: string = 'es'; // Default fallback
  private isWordSaved: boolean = false;
  private isPerformingAction: boolean = false;
  private autoHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private loadingTimeout: ReturnType<typeof setTimeout> | null = null;
  private actionLoadingStates: Map<string, boolean> = new Map();
  private clickOutsideHandler: ((event: Event) => void) | null = null;
  private touchOutsideHandler: ((event: Event) => void) | null = null;

  // Cleanup tracking
  private keyboardHandler: ((event: KeyboardEvent) => void) | null = null;
  private animationTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();
  private pendingOperations: Set<Promise<any>> = new Set();
  private isDestroyed: boolean = false;
  private beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null;
  private pagehideHandler: ((event: PageTransitionEvent) => void) | null = null;

  private dictionaryService: DictionaryApiService;
  private translationService: TranslationApiService;
  private ttsService: TTSService;
  private storageService: StorageService;
  private vocabularyService: VocabularyManager;
  private readonly logger = Logger.getInstance();

  private events: { [K in keyof PopupEvents]?: PopupEvents[K] } = {};

  // Enhanced error state management
  private errorState: ErrorState = {
    hasError: false,
    currentError: null,
    retryCount: 0,
    lastRetryTime: 0,
    isRetrying: false,
    errorHistory: [],
  };

  constructor(
    dictionaryService: DictionaryApiService,
    translationService: TranslationApiService,
    ttsService: TTSService,
    storageService: StorageService,
    vocabularyService: VocabularyManager,
    config?: Partial<WordLookupConfig>,
  ) {
    this.dictionaryService = dictionaryService;
    this.translationService = translationService;
    this.ttsService = ttsService;
    this.storageService = storageService;
    this.vocabularyService = vocabularyService;

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
      ...config,
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
      width: 100%;
      height: 100%;
      z-index: ${this.config.zIndex};
      pointer-events: none;
    `;

    // Add ARIA attributes for accessibility
    this.container.setAttribute('aria-live', 'polite');
    this.container.setAttribute('aria-atomic', 'true');

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
    this.popupContainer.setAttribute('role', 'dialog');
    this.popupContainer.setAttribute('aria-modal', 'true');
    this.popupContainer.setAttribute('aria-labelledby', 'popup-title');
    this.popupContainer.setAttribute('tabindex', '-1');
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
    // Create and track keyboard handler
    this.keyboardHandler = (event: KeyboardEvent) => {
      if (!this.isVisible || this.isDestroyed) return;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          this.hide();
          break;
        case 'Tab':
          this.handleTabNavigation(event);
          break;
        case 'Enter':
        case ' ':
          this.handleEnterSpace(event);
          break;
      }
    };

    // Attach keyboard listener
    document.addEventListener('keydown', this.keyboardHandler);

    // Set up page unload handlers for automatic cleanup
    this.beforeUnloadHandler = () => {
      this.destroySync();
    };

    this.pagehideHandler = () => {
      this.destroySync();
    };

    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    window.addEventListener('pagehide', this.pagehideHandler);

    // Set up click-outside handlers (will be attached/detached dynamically)
    this.clickOutsideHandler = (event) => this.handleClickOutside(event);
    this.touchOutsideHandler = (event) => this.handleTouchOutside(event);
  }

  // ========================================
  // Public API
  // ========================================

  public async show(
    wordOrData:
      | string
      | {
          word: string;
          position: { x: number; y: number };
          sourceLanguage?: string;
          targetLanguage?: string;
          context?: string;
        },
    position?: { x: number; y: number },
  ): Promise<void> {
    try {
      this.clearErrorState();

      // Parse input parameters
      let word: string;
      let pos: { x: number; y: number };
      let sourceLanguage: string | undefined;
      let targetLanguage: string | undefined;
      let context: string | undefined;

      if (typeof wordOrData === 'string') {
        word = wordOrData;
        pos = position || { x: 0, y: 0 };
        sourceLanguage = this.currentSourceLanguage;
        targetLanguage = this.currentTargetLanguage;
        context = '';
      } else {
        word = wordOrData.word;
        pos = wordOrData.position;
        sourceLanguage = wordOrData.sourceLanguage || this.currentSourceLanguage;
        targetLanguage = wordOrData.targetLanguage || this.currentTargetLanguage;
        context = wordOrData.context || '';
      }

      // Enhanced word validation with language-specific handling
      if (!word || word.trim().length === 0) {
        throw new Error('Empty word provided');
      }

      // Simple word preprocessing - just trim whitespace
      const processedWord = word.trim();

      this.logger?.debug('Showing word lookup', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: processedWord,
          originalWord: word,
          sourceLanguage,
          targetLanguage,
          position: pos,
        },
      });

      // Set languages if provided
      if (sourceLanguage && targetLanguage) {
        this.currentSourceLanguage = sourceLanguage;
        this.currentTargetLanguage = targetLanguage;
      }

      // Store current word
      this.currentWord = processedWord;
      this.currentContext = context;
      this.currentContextTranslation = '';

      // Show popup immediately with loading state
      this.showLoadingState();
      this.positionPopup(pos);
      this.makeVisible();

      // Load content asynchronously
      const content = await this.loadWordContent(processedWord);

      // Check if word is already saved
      await this.checkWordSaved(processedWord);

      this.updateContent(content);

      // Set up auto-hide if configured
      this.setupAutoHide();

      // Set initial focus for accessibility
      this.setInitialFocus();

      // Emit show event
      this.emit('show', { word: processedWord, position: pos, sourceLanguage, targetLanguage });
    } catch (error) {
      this.logger?.error('Failed to show popup', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: typeof wordOrData === 'string' ? wordOrData : wordOrData.word,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      // Show language-specific error message
      const errorContext = this.classifyError(error as Error, {
        service: 'popup',
        operation: 'show',
        word: typeof wordOrData === 'string' ? wordOrData : wordOrData.word,
      });

      this.showEnhancedErrorState(errorContext);
      this.emit('error', error);
    }
  }

  /**
   * Preprocess word based on source language characteristics
   */

  /**
   * Make the popup visible with animation
   */
  private makeVisible(): void {
    if (!this.popupContainer) return;

    this.isVisible = true;
    this.popupContainer.classList.add('visible');

    // Attach click-outside listeners with small delay to prevent immediate closure
    this.createTimeout(() => {
      this.attachClickOutsideListeners();
    }, 50);

    // Trigger event
    this.events.onShow?.();
  }

  /**
   * Show loading state
   */
  private showLoadingState(): void {
    if (this.isVisible) {
      this.hide();
    }

    this.isLoading = true;

    // Clear any existing loading timeout
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
    }

    // Show skeleton loading for better UX
    this.showSkeletonLoading();

    // Set loading timeout (15 seconds)
    this.loadingTimeout = setTimeout(() => {
      this.showLoadingTimeout();
    }, 15000);
  }

  public hide(): void {
    if (!this.isVisible) return;

    this.isVisible = false;

    if (this.popupContainer) {
      this.popupContainer.classList.remove('visible');
      this.popupContainer.classList.add('hiding');
    }

    // Clear auto-hide timeout
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }

    // Clear loading timeout
    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
      this.loadingTimeout = null;
    }

    // Clear action loading states
    this.actionLoadingStates.clear();

    // Clear error state when hiding
    this.clearErrorState();

    // Detach click-outside listeners
    this.detachClickOutsideListeners();

    this.createTimeout(() => {
      this.popupContainer?.classList.remove('hiding');
    }, this.config.animationDuration * 0.8);

    // Restore focus
    this.restoreFocus();

    // Trigger event
    this.events.onHide?.();
  }

  public updateContent(content: PopupContent): void {
    if (!this.popupContainer) return;

    // Clear error state on successful content update
    this.clearErrorState();

    this.popupContainer.classList.remove('loading', 'error');
    this.popupContainer.innerHTML = this.renderContent(content);
    this.attachEventHandlers();
  }

  public async destroy(): Promise<void> {
    // If already destroyed, return early
    if (this.isDestroyed) return;

    // Hide the popup first (but don't wait for animation)
    if (this.isVisible) {
      this.isVisible = false;
      if (this.popupContainer) {
        this.popupContainer.classList.remove('visible');
        this.popupContainer.classList.add('hiding');
      }
    }

    // Wait for pending operations to complete (with timeout)
    try {
      await this.waitForPendingOperations(2000); // 2 second timeout
    } catch (error) {
      this.logger?.warn('Some operations did not complete during cleanup', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }

    // Perform complete cleanup
    this.performCompleteCleanup();

    this.logger?.info('Component destroyed and cleaned up', {
      component: ComponentType.WORD_LOOKUP,
    });
  }

  /**
   * Synchronous destroy for cases where async is not possible
   * @deprecated Use destroy() instead for proper cleanup
   */
  public destroySync(): void {
    if (this.isDestroyed) return;

    this.logger?.warn('Using synchronous destroy - some operations may not complete properly', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        reason: 'Sync destroy used instead of async destroy',
      },
    });
    this.performCompleteCleanup();
  }

  /**
   * Called when the component is removed from the DOM
   * Provides automatic cleanup for browser navigation/page unload scenarios
   */
  public disconnectedCallback(): void {
    this.logger?.info('Component disconnected from DOM, performing cleanup', {
      component: ComponentType.WORD_LOOKUP,
    });
    this.destroySync();
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
    // Show partial content with translation (only if not destroyed)
    if (!this.isDestroyed) {
      this.showPartialContent(word);
    }

    this.logger?.debug('Loading content for word', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        word,
        sourceLanguage: this.currentSourceLanguage,
        targetLanguage: this.currentTargetLanguage,
      },
    });

    // Progressive loading: show translation first, then definition (if applicable)
    let definition: any = { meanings: [], phonetics: [] };

    try {
      const cached = await translationCacheService.get(
        word,
        this.currentSourceLanguage,
        this.currentTargetLanguage,
      );
      if (cached) {
        this.logger?.debug('Found cached translation', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word,
            cachedTranslation: cached,
            sourceLanguage: this.currentSourceLanguage,
            targetLanguage: this.currentTargetLanguage,
          },
        });
        this.translation = cached;
      } else {
        // Load translation first (usually faster) - tracked operation
        this.logger?.debug('Getting translation', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word,
            sourceLanguage: this.currentSourceLanguage,
            targetLanguage: this.currentTargetLanguage,
          },
        });
        const translationPromise = this.translationService.translateText({
          text: word,
          fromLanguage: this.currentSourceLanguage,
          toLanguage: this.currentTargetLanguage,
        });
        this.translation = await this.trackOperation(translationPromise);
      }

      await translationCacheService.set(
        word,
        this.translation,
        this.currentSourceLanguage,
        this.currentTargetLanguage,
      );

      this.logger?.debug('Translation received', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { word, translation: this.translation.substring(0, 50) },
      });

      // Context translation (same logic as word translation)
      if (this.currentContext && this.currentContext.trim().length > 0) {
        try {
          const cachedContext = await translationCacheService.get(
            this.currentContext,
            this.currentSourceLanguage,
            this.currentTargetLanguage,
          );
          if (cachedContext) {
            this.logger?.debug('Found cached context translation', {
              component: ComponentType.WORD_LOOKUP,
              metadata: {
                sourceLanguage: this.currentSourceLanguage,
                targetLanguage: this.currentTargetLanguage,
                contextLength: this.currentContext.length,
              },
            });
            this.currentContextTranslation = cachedContext;
          } else {
            this.logger?.debug('Getting context translation', {
              component: ComponentType.WORD_LOOKUP,
              metadata: {
                sourceLanguage: this.currentSourceLanguage,
                targetLanguage: this.currentTargetLanguage,
                contextLength: this.currentContext.length,
              },
            });
            const ctxPromise = this.translationService.translateText({
              text: this.currentContext,
              fromLanguage: this.currentSourceLanguage,
              toLanguage: this.currentTargetLanguage,
            });
            this.currentContextTranslation = await this.trackOperation(ctxPromise);
          }

          await translationCacheService.set(
            this.currentContext,
            this.currentContextTranslation,
            this.currentSourceLanguage,
            this.currentTargetLanguage,
          );

          this.logger?.debug('Context translation received', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              contextPreview: this.currentContext.substring(0, 30),
              translationPreview: this.currentContextTranslation.substring(0, 50),
            },
          });
        } catch (ctxErr) {
          this.logger?.warn('Context translation failed', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              error: ctxErr instanceof Error ? ctxErr.message : String(ctxErr),
            },
          });
          this.currentContextTranslation = '';
        }
      }

      // Only try to get definition if the source language is English
      // (since DictionaryApiService only supports English)
      if (this.currentSourceLanguage === 'en') {
        try {
          this.logger?.debug('Getting definition for English word', {
            component: ComponentType.WORD_LOOKUP,
            metadata: { word, sourceLanguage: this.currentSourceLanguage },
          });
          const definitionPromise = this.dictionaryService.getDefinition(word);
          definition = await this.trackOperation(definitionPromise);
          this.logger?.debug('Definition received', {
            component: ComponentType.WORD_LOOKUP,
            metadata: { word, definitionCount: definition?.meanings?.length || 0 },
          });
        } catch (definitionError) {
          this.logger?.debug('Definition lookup failed (expected for non-English words)', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              word,
              sourceLanguage: this.currentSourceLanguage,
              error:
                definitionError instanceof Error
                  ? definitionError.message
                  : String(definitionError),
            },
          });
          // For non-English words, this is expected - don't treat as an error
          // Just continue with translation-only content
        }
      } else {
        this.logger?.debug('Skipping definition lookup for non-English word', {
          component: ComponentType.WORD_LOOKUP,
          metadata: { word, sourceLanguage: this.currentSourceLanguage },
        });
      }
    } catch (error) {
      this.logger?.error('Translation failed', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      // If translation fails, try definition only (for English words)
      if (
        !this.translation &&
        !this.isDestroyed &&
        (this.currentSourceLanguage === 'en' || this.currentSourceLanguage === 'auto')
      ) {
        try {
          this.logger?.debug('Trying definition-only fallback', {
            component: ComponentType.WORD_LOOKUP,
            metadata: { word, sourceLanguage: this.currentSourceLanguage },
          });
          const definitionPromise = this.dictionaryService.getDefinition(word);
          definition = await this.trackOperation(definitionPromise);
          this.logger?.debug('Definition fallback successful', {
            component: ComponentType.WORD_LOOKUP,
            metadata: { word, definitionCount: definition?.meanings?.length || 0 },
          });
        } catch (fallbackError) {
          this.logger?.error('Both translation and dictionary services failed', {
            component: ComponentType.WORD_LOOKUP,
            metadata: {
              word,
              translationError: error instanceof Error ? error.message : String(error),
              dictionaryError:
                fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            },
          });
          // Both services failed - throw with better context
          throw new Error(
            `Both translation and dictionary services failed. Translation: ${(error as Error).message}, Dictionary: ${(fallbackError as Error).message}`,
          );
        }
      } else {
        // Translation failed and we can't get definitions for non-English words
        throw error;
      }
    }

    const content = {
      word,
      translation: this.translation,
      phonetic: definition.phonetics?.[0]?.text || '',
      definitions: definition.meanings
        ? definition.meanings.map((meaning: any) => ({
            text: meaning.definitions[0]?.definition || '',
            partOfSpeech: meaning.partOfSpeech,
            level: 'intermediate' as const,
          }))
        : [],
      examples: definition.meanings
        ? definition.meanings
            .flatMap((meaning: any) =>
              meaning.definitions.slice(0, 2).map((def: any) => ({
                text: def.example || '',
                translation: '',
                source: 'dictionary',
              })),
            )
            .filter((ex: any) => ex.text)
        : [],
      partOfSpeech: definition.meanings?.[0]?.partOfSpeech || '',
      sourceLanguage: this.currentSourceLanguage,
      targetLanguage: this.currentTargetLanguage,
    };

    this.logger?.debug('Final content prepared', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        word: content.word,
        hasTranslation: !!content.translation,
        definitionCount: content.definitions.length,
        exampleCount: content.examples.length,
        hasPhonetic: !!content.phonetic,
      },
    });
    return content;
  }

  private showPartialContent(word: string): void {
    if (!this.popupContainer || !this.isLoading) return;

    this.popupContainer.classList.remove('loading');
    this.popupContainer.innerHTML = `
      <div class="popup-content">
        <div class="popup-header">
          <div>
            <h3 class="word-title">${this.escapeHtml(word)}</h3>
          </div>
          <button class="close-button" type="button" aria-label="Close">×</button>
        </div>
        
        <div class="translation-section">
          <p class="translation-text"></p>
        </div>
        
        ${
          this.currentContext && this.currentContext.trim().length > 0
            ? `
        <div class="context-section" role="region" aria-labelledby="context-title">
          <div class="context-controls">
            <span class="context-label" id="context-title">Context</span>
            ${
              this.config.enableTTS
                ? `
              <button class="context-button" type="button" data-action="context-tts" aria-label="Listen to context">
                <span class="button-text">🔊</span>
              </button>
            `
                : ''
            }
            <button class="context-button" type="button" data-action="ai-enhance" aria-label="AI enhance">
              <span class="button-text">✨</span>
            </button>
          </div>
          <p class="context-text">${this.escapeHtml(this.currentContext)}</p>
        </div>
        `
            : ''
        }
        
        <div class="definitions-section">
          <div class="skeleton skeleton-text medium"></div>
          <div class="skeleton skeleton-text small"></div>
        </div>
        
        <div class="actions-section" style="display: flex; gap: 8px;">
        ${
          this.config.enableTTS
            ? `
          <button class="action-button" type="button" data-action="tts" aria-label="Listen to pronunciation of ${this.escapeHtml(word)}">
            <span class="button-text">🔊 Listen</span>
          </button>
        `
            : ''
        }
          ${
            this.config.enableVocabulary
              ? `
            <button class="action-button primary" type="button" data-action="save" aria-label="Save ${this.escapeHtml(word)} to vocabulary" disabled>
              <span class="button-text">${this.isWordSaved ? '🗑️ Remove Word' : '💾 Save Word'}</span>
            </button>
          `
              : ''
          }
        </div>
      </div>
    `;

    this.attachEventHandlers();
  }

  private renderContent(content: PopupContent): string {
    return `
      <div class="popup-content">
        <div class="popup-header">
          <div>
            <h3 class="word-title" id="popup-title">${this.escapeHtml(content.word)}</h3>
            ${
              content.phonetic && this.config.showPhonetics
                ? `<span class="phonetic" aria-label="Pronunciation: ${this.escapeHtml(content.phonetic)}">/${this.escapeHtml(content.phonetic)}/</span>`
                : ''
            }
          </div>
          <button class="close-button" type="button" aria-label="Close word lookup popup">×</button>
        </div>
        
        <div class="translation-section">
          <p class="translation-text">${this.escapeHtml(content.translation)}</p>
          ${
            content.partOfSpeech
              ? `<span class="part-of-speech">${this.escapeHtml(content.partOfSpeech)}</span>`
              : ''
          }
        </div>
        
        ${
          this.currentContext && this.currentContext.trim().length > 0
            ? `
          <div class="context-section" role="region" aria-labelledby="context-title">
            <div class="context-controls">
              <span class="context-label" id="context-title">Context</span>
              ${
                this.config.enableTTS
                  ? `
                <button class="context-button" type="button" data-action="context-tts" aria-label="Listen to context">
                  <span class="button-text">🔊</span>
                </button>
              `
                  : ''
              }
              <button class="context-button" type="button" data-action="ai-enhance" aria-label="AI enhance">
                <span class="button-text">✨</span>
              </button>
            </div>
            <p class="context-text">${this.escapeHtml(this.currentContext).replace(this.escapeHtml(content.word), `<span class="highlight">${this.escapeHtml(content.word)}</span>`)}</p>
            ${
              this.currentContextTranslation && this.currentContextTranslation.trim().length > 0
                ? `<p class="context-translation">${this.escapeHtml(this.currentContextTranslation)}</p>`
                : ''
            }
          </div>
        `
            : ''
        }
        
        ${
          content.definitions.length > 0
            ? `
          <div class="definitions-section" role="region" aria-labelledby="definitions-title">
            <h4 class="section-title" id="definitions-title">Definitions</h4>
            <ul role="list" aria-label="Word definitions">
              ${content.definitions
                .map(
                  (def, index) => `
                <li class="definition-item" role="listitem">
                  <p class="definition-text">${this.escapeHtml(def.text)}</p>
                  ${def.partOfSpeech ? `<span class="part-of-speech" aria-label="Part of speech">${this.escapeHtml(def.partOfSpeech)}</span>` : ''}
                </li>
              `,
                )
                .join('')}
            </ul>
          </div>
        `
            : ''
        }
        
        ${
          content.examples.length > 0 && this.config.showExamples
            ? `
          <div class="examples-section" role="region" aria-labelledby="examples-title">
            <h4 class="section-title" id="examples-title">Examples</h4>
            <ul role="list" aria-label="Usage examples">
              ${content.examples
                .slice(0, 3)
                .map(
                  (ex, index) => `
                <li class="example-item" role="listitem">
                  <p class="example-text">${this.escapeHtml(ex.text)}</p>
                  ${
                    ex.translation
                      ? `<p class="example-translation" aria-label="Translation">${this.escapeHtml(ex.translation)}</p>`
                      : ''
                  }
                </li>
              `,
                )
                .join('')}
            </ul>
          </div>
        `
            : ''
        }
        
        <div class="actions-section" role="group" aria-label="Word actions">
          ${
            this.config.enableTTS
              ? `
            <button class="action-button" type="button" data-action="tts" aria-label="Listen to pronunciation of ${this.escapeHtml(content.word)}">
              <span class="button-text">🔊 Listen</span>
            </button>
          `
              : ''
          }
          ${
            this.config.enableVocabulary
              ? `
            <button class="action-button primary" type="button" data-action="save" aria-label="Save ${this.escapeHtml(content.word)} to vocabulary">
              <span class="button-text">${this.isWordSaved ? '🗑️ Remove Word' : '💾 Save Word'}</span>
            </button>
          `
              : ''
          }
        </div>
      </div>
    `;
  }

  private showLoadingTimeout(): void {
    if (!this.popupContainer || !this.isLoading) return;

    // Add timeout warning to existing loading state
    const loadingContainer = this.popupContainer.querySelector('div[style*="padding: 20px"]');
    if (loadingContainer) {
      const timeoutWarning = document.createElement('div');
      timeoutWarning.className = 'loading-timeout';
      timeoutWarning.textContent = 'This is taking longer than expected...';
      loadingContainer.appendChild(timeoutWarning);
    }
  }

  private showSkeletonLoading(): void {
    if (!this.popupContainer) return;

    this.popupContainer.classList.add('loading');
    this.popupContainer.innerHTML = `
      <div class="popup-content">
        <div class="popup-header">
          <div class="skeleton skeleton-text large"></div>
        </div>
        <div class="translation-section">
          <div class="skeleton skeleton-text medium"></div>
          <div class="skeleton skeleton-text small"></div>
        </div>
        <div class="definitions-section">
          <div class="skeleton skeleton-text medium"></div>
          <div class="skeleton skeleton-text small"></div>
          <div class="skeleton skeleton-text medium"></div>
        </div>
        <div class="actions-section" style="display: flex; gap: 8px;">
          <div class="skeleton skeleton-button"></div>
          <div class="skeleton skeleton-button"></div>
        </div>
      </div>
    `;
  }

  private setActionLoading(action: string, isLoading: boolean): void {
    this.actionLoadingStates.set(action, isLoading);

    if (!this.popupContainer) return;

    const button = this.popupContainer.querySelector(
      `[data-action="${action}"]`,
    ) as HTMLButtonElement;
    if (!button) return;

    if (isLoading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
      // Update button text after action completes
      if (action === 'save') {
        this.updateSaveButtonText();
      }
    }
  }

  private setContextTTSLoading(isLoading: boolean): void {
    if (!this.popupContainer) return;

    const button = this.popupContainer.querySelector(
      '[data-action="context-tts"]',
    ) as HTMLButtonElement;
    if (!button) return;

    if (isLoading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }

  private setAIEnhanceLoading(isLoading: boolean): void {
    if (!this.popupContainer) return;

    const button = this.popupContainer.querySelector(
      '[data-action="ai-enhance"]',
    ) as HTMLButtonElement;
    if (!button) return;

    if (isLoading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }

  private displayAIEnhancement(analysis: string): void {
    if (!this.popupContainer) return;

    const contextSection = this.popupContainer.querySelector('.context-section');
    if (!contextSection) return;

    // Remove existing AI enhancement display
    const existingEnhancement = contextSection.querySelector('.ai-enhancement');
    if (existingEnhancement) {
      existingEnhancement.remove();
    }

    // Create AI enhancement display
    const enhancementDiv = document.createElement('div');
    enhancementDiv.className = 'ai-enhancement';
    enhancementDiv.innerHTML = `
      <div class="ai-enhancement-header">
        <span class="ai-enhancement-label">✨ AI Analysis</span>
      </div>
      <div class="ai-enhancement-content">
        <pre class="ai-enhancement-text">${this.escapeHtml(analysis)}</pre>
      </div>
    `;

    contextSection.appendChild(enhancementDiv);
  }

  private updateSaveButtonText(): void {
    if (!this.popupContainer) return;

    const button = this.popupContainer.querySelector('[data-action="save"]') as HTMLButtonElement;
    if (!button) return;

    const buttonText = button.querySelector('.button-text');
    if (!buttonText) return;

    if (this.isWordSaved) {
      buttonText.textContent = '🗑️ Remove Word';
      button.setAttribute('aria-label', `Remove ${this.currentWord} from vocabulary`);
    } else {
      buttonText.textContent = '💾 Save Word';
      button.setAttribute('aria-label', `Save ${this.currentWord} to vocabulary`);
    }
  }

  private showActionSuccess(action: string, message: string): void {
    if (!this.popupContainer) return;

    const button = this.popupContainer.querySelector(
      `[data-action="${action}"]`,
    ) as HTMLButtonElement;
    if (!button) return;

    const originalText = button.innerHTML;
    button.innerHTML = `<span class="button-text">✓ ${message}</span>`;
    button.style.background = '#48bb78';
    button.style.borderColor = '#48bb78';
    button.style.color = 'white';

    // Revert after 2 seconds
    setTimeout(() => {
      button.innerHTML = originalText;
      button.style.background = '';
      button.style.borderColor = '';
      button.style.color = '';
    }, 2000);
  }

  private showErrorState(error: Error): void {
    if (!this.popupContainer || this.isDestroyed) return;

    this.logger?.error('Error occurred in showErrorState', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        word: this.currentWord,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    // Use enhanced error handling
    const errorContext = this.classifyError(error, {
      service: 'unknown',
      operation: 'load',
      word: this.currentWord,
    });

    this.updateErrorState(errorContext);
    this.showEnhancedErrorState(errorContext);
  }

  private attachEventHandlers(): void {
    if (!this.popupContainer) return;

    // Close button
    const closeButton = this.popupContainer.querySelector('.close-button');
    closeButton?.addEventListener('click', () => this.hide());

    // Action buttons
    const actionButtons = this.popupContainer.querySelectorAll('[data-action]');
    actionButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        // Use currentTarget first (the button itself), then fallback to target
        const currentTarget = event.currentTarget as HTMLElement;
        const target = event.target as HTMLElement;
        
        const action = currentTarget.getAttribute('data-action') || 
                      target.getAttribute('data-action') ||
                      target.closest('[data-action]')?.getAttribute('data-action') ||
                      null;
        
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
      case 'context-tts':
        await this.playContextTTS();
        break;
      case 'ai-enhance':
        await this.aiEnhance();
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
    if (!this.currentWord || this.isDestroyed) return;

    const actionKey = 'tts';
    this.setActionLoading(actionKey, true);

    try {
      const ttsPromise = this.ttsService.speak(this.currentWord);
      await this.trackOperation(ttsPromise);

      if (!this.isDestroyed) {
        this.events.onTTSPlayed?.(this.currentWord);
      }
    } catch (error) {
      this.logger?.error('TTS failed', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: this.currentWord,
          sourceLanguage: this.currentSourceLanguage,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (!this.isDestroyed) {
        // Use enhanced error handling for TTS errors
        const errorContext = this.classifyError(error as Error, {
          service: 'tts',
          operation: 'tts',
          word: this.currentWord,
        });

        this.updateErrorState(errorContext);
        this.showEnhancedErrorState(errorContext);
        this.events.onError?.(error as Error);
      }
    } finally {
      if (!this.isDestroyed) {
        this.setActionLoading(actionKey, false);
      }
    }
  }

  private async playContextTTS(): Promise<void> {
    if (!this.currentContext || this.currentContext.trim().length === 0 || this.isDestroyed) return;

    const actionKey = 'context-tts';
    this.setContextTTSLoading(true);

    try {
      const ttsPromise = this.ttsService.speak(this.currentContext);
      await this.trackOperation(ttsPromise);

      if (!this.isDestroyed) {
        this.logger?.debug('Context TTS played successfully', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word: this.currentWord,
            contextLength: this.currentContext.length,
            sourceLanguage: this.currentSourceLanguage,
          },
        });
      }
    } catch (error) {
      this.logger?.error('Context TTS failed', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: this.currentWord,
          contextLength: this.currentContext.length,
          sourceLanguage: this.currentSourceLanguage,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (!this.isDestroyed) {
        // Use enhanced error handling for context TTS errors
        const errorContext = this.classifyError(error as Error, {
          service: 'tts',
          operation: 'context-tts',
          word: this.currentWord,
        });

        this.updateErrorState(errorContext);
        this.showEnhancedErrorState(errorContext);
        this.events.onError?.(error as Error);
      }
    } finally {
      if (!this.isDestroyed) {
        this.setContextTTSLoading(false);
      }
    }
  }

  private async aiEnhance(): Promise<void> {
    if (!this.currentContext || this.currentContext.trim().length === 0 || this.isDestroyed) return;

    this.setAIEnhanceLoading(true);

    try {
      const enhancedAnalysis = await this.callOpenAI(this.currentContext);
      
      if (!this.isDestroyed) {
        this.displayAIEnhancement(enhancedAnalysis);
        
        this.logger?.debug('AI enhancement completed successfully', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word: this.currentWord,
            contextLength: this.currentContext.length,
            sourceLanguage: this.currentSourceLanguage,
            analysisLength: enhancedAnalysis.length,
          },
        });
      }
    } catch (error) {
      this.logger?.error('AI enhancement failed', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: this.currentWord,
          contextLength: this.currentContext.length,
          sourceLanguage: this.currentSourceLanguage,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      
      if (!this.isDestroyed) {
        // Use enhanced error handling for AI enhancement errors
        const errorContext = this.classifyError(error as Error, {
          service: 'ai-enhancement',
          operation: 'ai-enhance',
          word: this.currentWord,
        });

        this.updateErrorState(errorContext);
        this.showEnhancedErrorState(errorContext);
        this.events.onError?.(error as Error);
      }
    } finally {
      if (!this.isDestroyed) {
        this.setAIEnhanceLoading(false);
      }
    }
  }

  private async callOpenAI(text: string): Promise<string> {
    // Get API key from storage
    const apiKey = await this.getOpenAIApiKey();
    if (!apiKey) {
      throw new Error('OpenAI API key not found. Please set OPENAI_API_KEY in your environment.');
    }

    const prompt = `You will be given a sentence in Thai. Your task is to first translate the whole sentence into English and then break up the entire translation in detail. You will list each part of the original sentence on a per line and translate that part alone. This is an example.

<example1>
input:
ผมจะอยู่ที่นี่จนกว่าจะหมดสัญญา

output:
ผมจะอยู่ที่นี่จนกว่าจะหมดสัญญา (phǒm jà yùu thîi nîi jon kwàa jà mòt sǎn-yaa): I will stay here until the contract expires.
ผม (phǒm): I (male)
จะอยู่ (jà yùu): will stay
ที่นี่ (thîi nîi): here
จนกว่า (jon kwàa): until
จะหมดสัญญา(jà mòt sǎn-yaa): the contract expire.
</example1>

Now analyze this Thai sentence:
${text}`;

    const response = await fetch('https://openrouter.ai/api/v1/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite-preview-06-17',
        prompt,
        max_tokens: 1000,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].text) {
      throw new Error('Invalid response from OpenAI API');
    }

    return data.choices[0].text;
  }

  private async getOpenAIApiKey(): Promise<string | null> {
    return import.meta.env.VITE_AI_API_KEY;
  }

  private async checkWordSaved(word: string): Promise<void> {
    try {
      // Be tolerant of language code mismatches by checking a small language set
      const primary = (this.currentSourceLanguage || 'auto').toLowerCase();
      const candidates = Array.from(new Set([primary, 'auto', 'th', 'en', 'es', 'fr', 'de', 'pl']));

      let found = false;
      for (const lang of candidates) {
        // eslint-disable-next-line no-await-in-loop
        if (await this.vocabularyService.isWordSaved(word, lang)) {
          found = true;
          break;
        }
      }
      this.isWordSaved = found;
    } catch (error) {
      this.logger?.warn('Failed to check if word is saved', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.isWordSaved = false;
    }
  }

  private async saveWord(): Promise<void> {
    if (!this.currentWord || this.isDestroyed) return;

    const actionKey = 'save';
      // Prevent double clicks from racing
      if (this.isPerformingAction) return;
      this.isPerformingAction = true;
      this.setActionLoading(actionKey, true);

    try {
      if (this.isWordSaved) {
        // Remove word if it's already saved
        // Find the exact saved item by scanning cache (tolerate language mismatches)
        const vocabulary = await this.vocabularyService.getVocabulary();
        if (vocabulary.success && Array.isArray(vocabulary.data)) {
          const lc = this.currentWord.toLowerCase();
          const match = vocabulary.data.find((item) => item.word.toLowerCase() === lc);
          if (match) {
            await this.vocabularyService.removeWords([match.id]);
            this.isWordSaved = false;
            this.updateSaveButtonText();

            if (!this.isDestroyed) {
              // Use onWordSaved callback for UI refreshes elsewhere; removal path may not be listened separately
              this.events.onWordSaved?.(this.currentWord);
            }

            this.logger?.debug('Word removed from vocabulary', {
              component: ComponentType.WORD_LOOKUP,
              metadata: { word: this.currentWord, wordId: match.id },
            });

            try {
              vocabularyObserver.emitWordRemoved(match, 'user');
            } catch {}
          }
        }
      } else {
        // Save word if it's not already saved
        // Capture precise playback time in seconds (no heuristics)
        const currentTimeSeconds = (() => {
          try {
            const video = document.querySelector('video') as HTMLVideoElement | null;
            if (video && typeof video.currentTime === 'number' && !Number.isNaN(video.currentTime)) {
              return Math.max(0, Math.floor(video.currentTime));
            }
          } catch {}
          // Fallback: parse from URL param `t` if present
          try {
            const url = new URL(window.location.href);
            const tParam = url.searchParams.get('t');
            if (tParam) {
              const t = parseInt(tParam, 10);
              if (!Number.isNaN(t) && t >= 0) return t;
            }
          } catch {}
          return 0;
        })();

        const savePromise = this.vocabularyService.saveWord(
          this.currentWord,
          this.translation,
          this.currentContext,
          {
            sourceLanguage: this.currentSourceLanguage,
            targetLanguage: this.currentTargetLanguage,
            videoId: this.extractVideoId(window.location.href) || '',
            videoTitle: await this.getVideoTitle(),
            timestamp: currentTimeSeconds,
          },
        );

        const result = await this.trackOperation(savePromise);
        this.isWordSaved = true;
        // Reflect state in the UI immediately
        this.updateSaveButtonText();

        if (!this.isDestroyed) {
          this.events.onWordSaved?.(this.currentWord);
        }

        this.logger?.debug('Word saved to vocabulary', {
          component: ComponentType.WORD_LOOKUP,
          metadata: {
            word: this.currentWord,
            result: result?.success ? 'success' : 'failed',
            wordId: result?.data?.id,
          },
        });

        // Proactively emit added event to update highlights immediately
        try {
          if (result?.success && result.data) {
            vocabularyObserver.emitWordAdded(result.data, 'user');
          }
        } catch {}
      }
    } catch (error) {
      this.logger?.error('Save/remove word failed', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          word: this.currentWord,
          action: this.isWordSaved ? 'remove' : 'save',
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (!this.isDestroyed) {
        // Use enhanced error handling for storage errors
        const errorContext = this.classifyError(error as Error, {
          service: 'storage',
          operation: this.isWordSaved ? 'remove' : 'save',
          word: this.currentWord,
        });

        this.updateErrorState(errorContext);
        this.showEnhancedErrorState(errorContext);
        this.events.onError?.(error as Error);
      }
    } finally {
      this.isPerformingAction = false;
      if (!this.isDestroyed) {
        this.setActionLoading(actionKey, false);
      }
      // Re-check saved state after operation to keep UI truthful
      try {
        if (this.currentWord) {
          await this.checkWordSaved(this.currentWord);
          this.updateSaveButtonText();
        }
      } catch {}
    }
  }

  private async getVideoTitle(): Promise<string> {
    try {
      const titleElement = document.querySelector('h1.ytd-watch-metadata');
      return titleElement?.textContent?.trim() || 'Unknown Video';
    } catch (error) {
      return 'Unknown Video';
    }
  }

  private extractVideoId(url: string): string | null {
    const match = url.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  }

  private async retryLoad(): Promise<void> {
    if (!this.currentWord || this.isDestroyed) return;

    this.isLoading = true;
    this.showLoadingState();

    try {
      const contentPromise = this.loadWordContent(this.currentWord);
      const content = await this.trackOperation(contentPromise);

      if (!this.isDestroyed) {
        this.updateContent(content);
      }
    } catch (error) {
      if (!this.isDestroyed) {
        this.showErrorState(error as Error);
        this.events.onError?.(error as Error);
      }
    } finally {
      if (!this.isDestroyed) {
        this.isLoading = false;
      }
    }
  }

  // ========================================
  // Simplified Positioning Logic
  // ========================================

  private positionPopup(position: { x: number; y: number }): void {
    if (!this.popupContainer) return;

    // Get actual rendered dimensions instead of config values
    const rect = this.popupContainer.getBoundingClientRect();
    const actualWidth = rect.width || this.config.maxWidth;
    const actualHeight = rect.height || this.config.maxHeight;

    // Simple positioning: center horizontally, position above clicked word
    const x = Math.max(10, position.x - actualWidth / 2);

    // For bottom CSS positioning: distance from bottom of viewport to bottom of popup
    const gapAboveWord = 50;
    const bottomDistance = window.innerHeight - position.y + gapAboveWord;

    this.logger?.debug('Copied content to clipboard', {
      component: ComponentType.WORD_LOOKUP,
      metadata: {
        actualWidth,
        actualHeight,
        clickY: position.y,
        viewportHeight: window.innerHeight,
        bottomDistance,
        gapAboveWord,
        calculatedX: x,
      },
    });

    // ALWAYS use bottom positioning for upward placement
    this.popupContainer.style.left = `${x}px`;
    this.popupContainer.style.top = '';
    this.popupContainer.style.bottom = `${bottomDistance}px`;
  }

  private updatePositionClasses(
    placement: { x: number; y: number; placement: string },
    originalPosition: { x: number; y: number },
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

  // ========================================
  // Keyboard Navigation and Accessibility
  // ========================================

  private handleTabNavigation(event: KeyboardEvent): void {
    if (!this.popupContainer) return;

    const focusableElements = this.getFocusableElements();
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const currentFocus = this.shadowRoot?.activeElement as HTMLElement;

    // Focus trapping
    if (event.shiftKey) {
      // Shift+Tab - move backward
      if (currentFocus === firstElement || !currentFocus) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab - move forward
      if (currentFocus === lastElement || !currentFocus) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }

  private handleEnterSpace(event: KeyboardEvent): void {
    if (!this.shadowRoot) return;

    const target = event.target as HTMLElement;
    if (target.tagName === 'BUTTON' && target.hasAttribute('data-action')) {
      event.preventDefault();
      target.click();
    }
  }

  private getFocusableElements(): HTMLElement[] {
    if (!this.popupContainer) return [];

    const focusableSelectors = [
      'button:not([disabled])',
      'a[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ];

    const elements = this.popupContainer.querySelectorAll(focusableSelectors.join(','));
    return Array.from(elements) as HTMLElement[];
  }

  private setInitialFocus(): void {
    if (!this.popupContainer) return;

    // Focus the popup container first
    this.popupContainer.focus();

    // Then focus the first focusable element
    const focusableElements = this.getFocusableElements();
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }
  }

  private restoreFocus(): void {
    // Restore focus to the element that was focused before the popup opened
    // This would typically be the element that triggered the popup
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && activeElement.blur) {
      activeElement.blur();
    }
  }

  // ========================================
  // Click-Outside Detection
  // ========================================

  private handleClickOutside(event: Event): void {
    if (!this.isVisible || !this.container) return;

    const target = event.target as Node;
    const clickedElement = (event.composedPath?.()?.[0] as Element) || (target as Element);

    // Check if click is outside the popup container
    if (!this.isClickInsidePopup(clickedElement)) {
      // Add small delay to prevent conflicts with other click handlers
      setTimeout(() => {
        if (this.isVisible) {
          this.hide();
        }
      }, 10);
    }
  }

  private handleTouchOutside(event: Event): void {
    if (!this.isVisible || !this.container) return;

    const touchEvent = event as TouchEvent;
    if (touchEvent.touches.length === 0) return;

    const touch = touchEvent.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);

    if (target && !this.isClickInsidePopup(target)) {
      // Add small delay to prevent conflicts with other touch handlers
      setTimeout(() => {
        if (this.isVisible) {
          this.hide();
        }
      }, 10);
    }
  }

  private isClickInsidePopup(element: Element | Node): boolean {
    if (!this.container || !element) return false;

    // Check if element is within the main container
    if (this.container.contains(element as Node)) {
      return true;
    }

    // Check shadow DOM specifically
    if (this.shadowRoot && this.shadowRoot.contains(element as Node)) {
      return true;
    }

    // Check if element is within shadow DOM using composedPath
    const path = (element as Element).getRootNode?.();
    if (path === this.shadowRoot) {
      return true;
    }

    // Additional check for elements that might be related to the popup
    const elementAsHTMLElement = element as HTMLElement;
    if (elementAsHTMLElement.closest) {
      const popupAncestor = elementAsHTMLElement.closest('#linguatube-word-lookup-popup');
      if (popupAncestor) {
        return true;
      }
    }

    return false;
  }

  private attachClickOutsideListeners(): void {
    if (!this.clickOutsideHandler || !this.touchOutsideHandler) return;

    // Use capture phase to ensure we get the event before other handlers
    document.addEventListener('click', this.clickOutsideHandler, true);
    document.addEventListener('mousedown', this.clickOutsideHandler, true);
    document.addEventListener('touchstart', this.touchOutsideHandler, true);
    document.addEventListener('touchend', this.touchOutsideHandler, true);
  }

  private detachClickOutsideListeners(): void {
    if (!this.clickOutsideHandler || !this.touchOutsideHandler) return;

    document.removeEventListener('click', this.clickOutsideHandler, true);
    document.removeEventListener('mousedown', this.clickOutsideHandler, true);
    document.removeEventListener('touchstart', this.touchOutsideHandler, true);
    document.removeEventListener('touchend', this.touchOutsideHandler, true);
  }

  // Public method to temporarily disable click-outside (useful for testing or special cases)
  public disableClickOutside(): void {
    this.detachClickOutsideListeners();
  }

  // Public method to re-enable click-outside
  public enableClickOutside(): void {
    if (this.isVisible) {
      this.attachClickOutsideListeners();
    }
  }

  // ========================================
  // Extended API Methods
  // ========================================

  /**
   * Get current popup state
   */
  public getState(): {
    isVisible: boolean;
    isLoading: boolean;
    currentWord: string;
    translation: string;
    error: Error | null;
  } {
    return {
      isVisible: this.isVisible,
      isLoading: this.isLoading,
      currentWord: this.currentWord,
      translation: this.translation,
      error: null, // Could be enhanced to track errors
    };
  }

  /**
   * Check if popup is currently visible
   */
  public isPopupVisible(): boolean {
    return this.isVisible;
  }

  /**
   * Check if popup is currently loading
   */
  public isPopupLoading(): boolean {
    return this.isLoading;
  }

  /**
   * Get current word being looked up
   */
  public getCurrentWord(): string {
    return this.currentWord;
  }

  /**
   * Update popup configuration
   */
  public updateConfig(newConfig: Partial<WordLookupConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.applyConfiguration();
  }

  /**
   * Set default languages for word lookup
   */
  public setDefaultLanguages(sourceLanguage: string, targetLanguage: string): void {
    this.currentSourceLanguage = sourceLanguage;
    this.currentTargetLanguage = targetLanguage;
  }

  /**
   * Get current configuration
   */
  public getConfig(): WordLookupConfig {
    return { ...this.config };
  }

  /**
   * Update popup position
   */
  public updatePosition(position: { x: number; y: number }): void {
    if (this.isVisible) {
      this.positionPopup(position);
    }
  }

  /**
   * Set focus to popup
   */
  public focus(): void {
    if (this.isVisible) {
      this.setInitialFocus();
    }
  }

  /**
   * Enable/disable click-outside detection
   */
  public setClickOutsideEnabled(enabled: boolean): void {
    if (enabled) {
      this.enableClickOutside();
    } else {
      this.disableClickOutside();
    }
  }

  /**
   * Refresh content (re-fetch from services)
   */
  public async refreshContent(): Promise<void> {
    if (this.currentWord && this.isVisible && !this.isDestroyed) {
      this.isLoading = true;
      this.showSkeletonLoading();

      try {
        const contentPromise = this.loadWordContent(this.currentWord);
        const content = await this.trackOperation(contentPromise);

        if (!this.isDestroyed) {
          this.updateContent(content);
        }
      } catch (error) {
        if (!this.isDestroyed) {
          this.showErrorState(error as Error);
          this.events.onError?.(error as Error);
        }
      } finally {
        if (!this.isDestroyed) {
          this.isLoading = false;
        }
      }
    }
  }

  /**
   * Copy content to clipboard
   */
  public async copyToClipboard(
    content: 'word' | 'translation' | 'definition' | 'all',
  ): Promise<void> {
    if (!this.currentWord) return;

    try {
      let textToCopy = '';

      switch (content) {
        case 'word':
          textToCopy = this.currentWord;
          break;
        case 'translation':
          // Would need to store current content to access translation
          textToCopy = this.currentWord; // Fallback
          break;
        case 'definition':
          // Would need to store current content to access definition
          textToCopy = this.currentWord; // Fallback
          break;
        case 'all':
          textToCopy = this.currentWord; // Would format all content
          break;
      }

      await navigator.clipboard.writeText(textToCopy);
      this.logger?.debug('Copied content to clipboard', {
        component: ComponentType.WORD_LOOKUP,
        metadata: { contentType: content, word: this.currentWord },
      });
    } catch (error) {
      this.logger?.error('Failed to copy to clipboard', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          contentType: content,
          word: this.currentWord,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Enhanced event listener with typed events
   */
  public once(event: keyof PopupEvents, callback: (...args: any[]) => void): void {
    const wrappedCallback = (...args: any[]) => {
      callback(...args);
      this.off(event);
    };
    this.on(event, wrappedCallback);
  }

  /**
   * Emit custom event
   */
  public emit(event: string, data: any): void {
    // Could be enhanced to support custom events
    this.logger?.debug('Custom event emitted', {
      component: ComponentType.WORD_LOOKUP,
      metadata: { event, data },
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ========================================
  // Enhanced Error Handling System
  // ========================================

  private classifyError(
    error: Error,
    context: { service?: string; operation?: string; word?: string },
  ): ErrorContext {
    const message = error.message.toLowerCase();
    let type = ErrorType.UNKNOWN;
    let severity = ErrorSeverity.MEDIUM;
    let userMessage = 'Something went wrong';
    let guidance = 'Please try again';
    let retryable = true;
    let autoRetry = false;
    let retryDelay = 1000;
    let maxRetries = 3;
    let fallbackAvailable = false;

    // Check for partial failure first (but only for English words where definitions are expected)
    if ((error as any).isPartialFailure || message.includes('definition lookup failed')) {
      // Only treat as partial failure if we're expecting definitions (English words)
      if (
        context.word &&
        (this.currentSourceLanguage === 'en' || this.currentSourceLanguage === 'auto')
      ) {
        type = ErrorType.PARTIAL_FAILURE;
        severity = ErrorSeverity.LOW;
        userMessage = 'Partial information loaded';
        guidance = 'Some content is missing but you can continue';
        retryable = true;
        maxRetries = 1;
        fallbackAvailable = false;
      } else {
        // For non-English words, definition failure is expected and not an error
        // This shouldn't be classified as an error at all
        type = ErrorType.UNKNOWN;
        severity = ErrorSeverity.LOW;
        userMessage = 'Translation loaded successfully';
        guidance = 'Definition not available for non-English words';
        retryable = false;
        maxRetries = 0;
        fallbackAvailable = false;
      }
    }

    // Network-related errors
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('connection')
    ) {
      type = ErrorType.NETWORK;
      severity = ErrorSeverity.HIGH;
      userMessage = 'Network connection failed';
      guidance = 'Check your internet connection and try again';
      autoRetry = true;
      retryDelay = 2000;
      maxRetries = 3;
    }
    // Rate limiting
    else if (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429')
    ) {
      type = ErrorType.RATE_LIMIT;
      severity = ErrorSeverity.MEDIUM;
      userMessage = 'Too many requests';
      guidance = 'Please wait a moment before trying again';
      autoRetry = true;
      retryDelay = 5000;
      maxRetries = 2;
    }
    // Timeout errors
    else if (message.includes('timeout') || message.includes('timed out')) {
      type = ErrorType.TIMEOUT;
      severity = ErrorSeverity.MEDIUM;
      userMessage = 'Request timed out';
      guidance = 'The service is taking longer than expected. Try again';
      autoRetry = true;
      retryDelay = 3000;
      maxRetries = 2;
    }
    // Service unavailable
    else if (
      message.includes('service unavailable') ||
      message.includes('502') ||
      message.includes('503')
    ) {
      type = ErrorType.SERVICE_UNAVAILABLE;
      severity = ErrorSeverity.HIGH;
      userMessage = 'Service temporarily unavailable';
      guidance = 'The translation service is down. Try again later';
      autoRetry = false;
      retryDelay = 10000;
      maxRetries = 1;
    }
    // Translation-specific errors
    else if (context.service === 'translation' || context.operation === 'translate') {
      type = ErrorType.TRANSLATION_FAILED;
      severity = ErrorSeverity.MEDIUM;
      userMessage = 'Translation failed';
      guidance = 'Unable to translate this word. Try a different word';
      fallbackAvailable = true; // Can try dictionary only
      maxRetries = 2;
    }
    // Dictionary-specific errors
    else if (context.service === 'dictionary' || context.operation === 'dictionary') {
      type = ErrorType.DICTIONARY_FAILED;
      severity = ErrorSeverity.MEDIUM;
      userMessage = 'Definition not found';
      guidance = 'No definition available for this word';
      fallbackAvailable = true; // Can try translation only
      maxRetries = 2;
    }
    // TTS errors
    else if (context.service === 'tts' || context.operation === 'tts') {
      type = ErrorType.TTS_FAILED;
      severity = ErrorSeverity.LOW;
      userMessage = 'Audio playback failed';
      guidance = 'Unable to play pronunciation. Check your audio settings';
      retryable = true;
      maxRetries = 1;
    }
    // Storage errors
    else if (context.service === 'storage' || context.operation === 'save') {
      type = ErrorType.STORAGE_FAILED;
      severity = ErrorSeverity.LOW;
      userMessage = 'Failed to save word';
      guidance = 'Unable to save to vocabulary. Try again';
      maxRetries = 2;
    }
    // Validation errors
    else if (message.includes('invalid') || message.includes('validation')) {
      type = ErrorType.VALIDATION;
      severity = ErrorSeverity.LOW;
      userMessage = 'Invalid input';
      guidance = 'Please check the word and try again';
      retryable = false;
      maxRetries = 0;
    }

    return {
      type,
      severity,
      message: error.message,
      userMessage,
      guidance,
      retryable,
      autoRetry,
      retryDelay,
      maxRetries,
      fallbackAvailable,
      originalError: error,
      timestamp: Date.now(),
      context: {
        word: context.word,
        service: context.service,
        operation: context.operation,
        attempt: this.errorState.retryCount + 1,
      },
    };
  }

  private updateErrorState(errorContext: ErrorContext): void {
    this.errorState = {
      hasError: true,
      currentError: errorContext,
      retryCount: this.errorState.retryCount,
      lastRetryTime: Date.now(),
      isRetrying: false,
      errorHistory: [...this.errorState.errorHistory, errorContext].slice(-10), // Keep last 10 errors
    };
  }

  private clearErrorState(): void {
    this.errorState = {
      hasError: false,
      currentError: null,
      retryCount: 0,
      lastRetryTime: 0,
      isRetrying: false,
      errorHistory: this.errorState.errorHistory, // Keep history for analytics
    };
  }

  private getErrorIcon(type: ErrorType): string {
    switch (type) {
      case ErrorType.NETWORK:
        return '🌐';
      case ErrorType.SERVICE_UNAVAILABLE:
        return '🔧';
      case ErrorType.RATE_LIMIT:
        return '⏱️';
      case ErrorType.TIMEOUT:
        return '⏰';
      case ErrorType.VALIDATION:
        return '⚠️';
      case ErrorType.TRANSLATION_FAILED:
        return '🔤';
      case ErrorType.DICTIONARY_FAILED:
        return '📖';
      case ErrorType.PARTIAL_FAILURE:
        return '⚡';
      case ErrorType.TTS_FAILED:
        return '🔊';
      case ErrorType.STORAGE_FAILED:
        return '💾';
      default:
        return '❌';
    }
  }

  private getErrorIconClass(type: ErrorType): string {
    switch (type) {
      case ErrorType.NETWORK:
        return 'network';
      case ErrorType.SERVICE_UNAVAILABLE:
        return 'service';
      case ErrorType.TIMEOUT:
        return 'timeout';
      case ErrorType.VALIDATION:
        return 'validation';
      case ErrorType.PARTIAL_FAILURE:
        return 'partial';
      case ErrorType.RATE_LIMIT:
      case ErrorType.TRANSLATION_FAILED:
      case ErrorType.DICTIONARY_FAILED:
      case ErrorType.TTS_FAILED:
      case ErrorType.STORAGE_FAILED:
      default:
        return 'critical';
    }
  }

  private renderEnhancedErrorState(errorContext: ErrorContext): string {
    const icon = this.getErrorIcon(errorContext.type);
    const iconClass = this.getErrorIconClass(errorContext.type);
    const canRetry = errorContext.retryable && this.errorState.retryCount < errorContext.maxRetries;
    const isOffline = !navigator.onLine;

    let actions = '';

    if (canRetry) {
      actions += `
        <button class="error-retry-button" type="button" data-action="retry" ${this.errorState.isRetrying ? 'disabled' : ''}>
          ${this.errorState.isRetrying ? '⏳ Retrying...' : '🔄 Try Again'}
        </button>
      `;
    }

    if (errorContext.fallbackAvailable) {
      actions += `
        <button class="error-secondary-button" type="button" data-action="fallback">
          📖 Try Definition Only
        </button>
      `;
    }

    actions += `
      <button class="error-dismiss-button" type="button" data-action="dismiss">
        Dismiss
      </button>
    `;

    return `
      <div class="popup-content">
        <div class="popup-header">
          <div class="error-title">Word Lookup Error</div>
          <button class="close-button" type="button" aria-label="Close">×</button>
        </div>
        
        ${
          isOffline
            ? `
          <div class="offline-indicator">
            📡 You appear to be offline. Check your connection.
          </div>
        `
            : ''
        }
        
        <div class="error-container">
          <span class="error-icon ${iconClass}">${icon}</span>
          <div class="error-title">${this.escapeHtml(errorContext.userMessage)}</div>
          <div class="error-message">${this.escapeHtml(errorContext.guidance)}</div>
          
          <div class="error-actions">
            ${actions}
          </div>
          
          ${
            errorContext.autoRetry && canRetry
              ? `
            <div class="retry-countdown">
              Auto-retry in <span id="countdown">${Math.ceil(errorContext.retryDelay / 1000)}</span> seconds
            </div>
          `
              : ''
          }
          
          <div class="error-details">
            <button class="error-details-toggle" type="button" data-action="toggle-details">
              Show Details
            </button>
            <div class="error-details-content" style="display: none;">
              Error Type: ${errorContext.type}
              Severity: ${errorContext.severity}
              Attempt: ${errorContext.context.attempt}/${errorContext.maxRetries}
              Service: ${errorContext.context.service || 'Unknown'}
              
              Technical Details:
              ${this.escapeHtml(errorContext.message)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private async handleEnhancedRetry(errorContext: ErrorContext): Promise<void> {
    if (!errorContext.retryable || this.errorState.retryCount >= errorContext.maxRetries) {
      this.logger?.warn('Retry not allowed or max retries exceeded', {
        component: ComponentType.WORD_LOOKUP,
        metadata: {
          retryCount: this.errorState.retryCount,
          maxRetries: errorContext.maxRetries,
          retryable: errorContext.retryable,
        },
      });
      return;
    }

    // Update state to indicate retrying
    this.errorState = {
      ...this.errorState,
      isRetrying: true,
      retryCount: this.errorState.retryCount + 1,
    };

    try {
      // Add delay before retry
      await new Promise((resolve) => setTimeout(resolve, errorContext.retryDelay));

      if (this.isDestroyed) return;

      // Attempt to reload content
      await this.retryLoad();

      // Clear error state on success
      this.clearErrorState();
    } catch (error) {
      // Handle retry failure
      const newErrorContext = this.classifyError(error as Error, {
        service: errorContext.context.service,
        operation: errorContext.context.operation,
        word: this.currentWord,
      });

      this.updateErrorState(newErrorContext);
      this.renderEnhancedErrorState(newErrorContext);
    } finally {
      // Update state to indicate not retrying
      this.errorState = {
        ...this.errorState,
        isRetrying: false,
      };
    }
  }

  private async handleFallbackAction(): Promise<void> {
    if (!this.currentWord || this.isDestroyed) return;

    try {
      // Try dictionary-only fallback
      const definition = await this.trackOperation(
        this.dictionaryService.getDefinition(this.currentWord),
      );

      if (!this.isDestroyed) {
        const fallbackContent: PopupContent = {
          word: this.currentWord,
          translation: '', // No translation available
          phonetic: definition.phonetics?.[0]?.text || '',
          definitions: definition.meanings.map((meaning: any) => ({
            text: meaning.definitions[0]?.definition || '',
            partOfSpeech: meaning.partOfSpeech,
            level: 'intermediate' as const,
          })),
          examples: definition.meanings
            .flatMap((meaning: any) =>
              meaning.definitions.slice(0, 2).map((def: any) => ({
                text: def.example || '',
                translation: '',
                source: 'dictionary',
              })),
            )
            .filter((ex: any) => ex.text),
          partOfSpeech: definition.meanings[0]?.partOfSpeech || '',
          sourceLanguage: 'en',
          targetLanguage: 'es',
        };

        // Show partial content with warning
        this.updateContent(fallbackContent);

        // Add partial failure banner
        if (this.popupContainer) {
          const banner = document.createElement('div');
          banner.className = 'partial-error-banner';
          banner.innerHTML = `
            ⚠️ Translation unavailable. Showing definition only.
          `;
          this.popupContainer.querySelector('.popup-content')?.prepend(banner);
        }

        this.clearErrorState();
      }
    } catch (error) {
      // Fallback also failed
      const errorContext = this.classifyError(error as Error, {
        service: 'dictionary',
        operation: 'fallback',
        word: this.currentWord,
      });

      this.updateErrorState(errorContext);
      this.showEnhancedErrorState(errorContext);
    }
  }

  private showEnhancedErrorState(errorContext: ErrorContext): void {
    if (!this.popupContainer || this.isDestroyed) return;

    // Add error class to container
    this.popupContainer.classList.add('error');

    // Render enhanced error UI
    const errorHTML = this.renderEnhancedErrorState(errorContext);
    this.popupContainer.innerHTML = errorHTML;

    // Attach enhanced error event handlers
    this.attachEnhancedErrorHandlers(errorContext);

    // Start auto-retry countdown if applicable
    if (
      errorContext.autoRetry &&
      errorContext.retryable &&
      this.errorState.retryCount < errorContext.maxRetries
    ) {
      this.startAutoRetryCountdown(errorContext);
    }
  }

  private attachEnhancedErrorHandlers(errorContext: ErrorContext): void {
    if (!this.popupContainer) return;

    // Retry button
    const retryButton = this.popupContainer.querySelector(
      '[data-action="retry"]',
    ) as HTMLButtonElement;
    if (retryButton) {
      retryButton.addEventListener('click', () => {
        this.handleEnhancedRetry(errorContext);
      });
    }

    // Fallback button
    const fallbackButton = this.popupContainer.querySelector(
      '[data-action="fallback"]',
    ) as HTMLButtonElement;
    if (fallbackButton) {
      fallbackButton.addEventListener('click', () => {
        this.handleFallbackAction();
      });
    }

    // Dismiss button
    const dismissButton = this.popupContainer.querySelector(
      '[data-action="dismiss"]',
    ) as HTMLButtonElement;
    if (dismissButton) {
      dismissButton.addEventListener('click', () => {
        this.hide();
      });
    }

    // Close button
    const closeButton = this.popupContainer.querySelector('.close-button') as HTMLButtonElement;
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.hide();
      });
    }

    // Details toggle
    const detailsToggle = this.popupContainer.querySelector(
      '[data-action="toggle-details"]',
    ) as HTMLButtonElement;
    const detailsContent = this.popupContainer.querySelector(
      '.error-details-content',
    ) as HTMLElement;
    if (detailsToggle && detailsContent) {
      detailsToggle.addEventListener('click', () => {
        const isVisible = detailsContent.style.display !== 'none';
        detailsContent.style.display = isVisible ? 'none' : 'block';
        detailsToggle.textContent = isVisible ? 'Show Details' : 'Hide Details';
      });
    }
  }

  private startAutoRetryCountdown(errorContext: ErrorContext): void {
    const countdownElement = this.popupContainer?.querySelector('#countdown');
    if (!countdownElement) return;

    let remaining = Math.ceil(errorContext.retryDelay / 1000);

    const updateCountdown = () => {
      if (countdownElement && remaining > 0) {
        countdownElement.textContent = remaining.toString();
        remaining--;
        this.createTimeout(updateCountdown, 1000);
      } else if (remaining <= 0) {
        // Auto-retry
        this.handleEnhancedRetry(errorContext);
      }
    };

    updateCountdown();
  }

  // ========================================
  // Cleanup Utilities
  // ========================================

  /**
   * Creates a tracked timeout that will be automatically cleared on destroy
   */
  private createTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout> {
    const timeoutId = setTimeout(() => {
      this.animationTimeouts.delete(timeoutId);
      if (!this.isDestroyed) {
        callback();
      }
    }, delay);

    this.animationTimeouts.add(timeoutId);
    return timeoutId;
  }

  /**
   * Creates a tracked promise that will be monitored for cleanup
   */
  private trackOperation<T>(promise: Promise<T>): Promise<T> {
    this.pendingOperations.add(promise);

    const cleanup = () => {
      this.pendingOperations.delete(promise);
    };

    promise.then(cleanup, cleanup);
    return promise;
  }

  /**
   * Clears a tracked timeout
   */
  private clearTrackedTimeout(timeoutId: ReturnType<typeof setTimeout> | null): void {
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.animationTimeouts.delete(timeoutId);
    }
  }

  /**
   * Removes global event listeners
   */
  private removeGlobalEventListeners(): void {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler);
      this.keyboardHandler = null;
    }

    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }

    if (this.pagehideHandler) {
      window.removeEventListener('pagehide', this.pagehideHandler);
      this.pagehideHandler = null;
    }
  }

  /**
   * Clears all pending timeouts
   */
  private clearAllTimeouts(): void {
    // Clear tracked animation timeouts
    this.animationTimeouts.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    this.animationTimeouts.clear();

    // Clear specific timeouts
    if (this.autoHideTimeout) {
      clearTimeout(this.autoHideTimeout);
      this.autoHideTimeout = null;
    }

    if (this.loadingTimeout) {
      clearTimeout(this.loadingTimeout);
      this.loadingTimeout = null;
    }
  }

  /**
   * Waits for pending operations to complete or times out
   */
  private async waitForPendingOperations(timeoutMs: number = 5000): Promise<void> {
    if (this.pendingOperations.size === 0) return;

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    });

    const allOperations = Promise.allSettled(Array.from(this.pendingOperations));

    await Promise.race([allOperations, timeoutPromise]);
  }

  /**
   * Performs thorough cleanup of all resources
   */
  private performCompleteCleanup(): void {
    // Mark as destroyed to prevent further operations
    this.isDestroyed = true;

    // Clear all timeouts
    this.clearAllTimeouts();

    // Remove global event listeners
    this.removeGlobalEventListeners();

    // Detach click-outside listeners
    this.detachClickOutsideListeners();

    // Clear collections and maps
    this.actionLoadingStates.clear();
    this.pendingOperations.clear();

    // Clear event handlers
    this.events = {};

    // Clear DOM references
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    // Nullify all references
    this.container = null;
    this.shadowRoot = null;
    this.popupContainer = null;
    this.clickOutsideHandler = null;
    this.touchOutsideHandler = null;
    this.keyboardHandler = null;
    this.beforeUnloadHandler = null;
    this.pagehideHandler = null;

    // Reset state
    this.isVisible = false;
    this.isLoading = false;
    this.currentWord = '';
    this.translation = '';
    this.currentContext = '';
  }
}
