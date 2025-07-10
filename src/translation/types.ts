// Types and interfaces for Microsoft Translator API integration

// ============================================================================
// Configuration Types
// ============================================================================

export interface TranslationConfig {
  apiKey: string;
  endpoint: string;
  region?: string;
  apiVersion: string;
  timeout: number;
  retryAttempts: number;
  rateLimitConfig: RateLimitConfig;
  cacheConfig: CacheConfig;
  batchConfig: BatchConfig;
}

export interface RateLimitConfig {
  maxCharactersPerMonth: number;
  maxCharactersPerMinute: number;
  maxRequestsPerSecond: number;
  trackingEnabled: boolean;
}

export interface CacheConfig {
  enabled: boolean;
  ttlHours: number;
  maxEntries: number;
  compressionEnabled: boolean;
}

export interface BatchConfig {
  enabled: boolean;
  maxTextsPerBatch: number;
  maxBatchSizeBytes: number;
  batchTimeoutMs: number;
}

// ============================================================================
// API Types
// ============================================================================

export interface TranslateTextRequest {
  text: string;
  fromLanguage?: string;
  toLanguage: string;
  category?: string;
  textType?: 'plain' | 'html';
}

export interface TranslateTextResponse {
  translations: Array<{
    text: string;
    to: string;
    sentLen?: {
      srcSentLen: number[];
      transSentLen: number[];
    };
  }>;
  detectedLanguage?: {
    language: string;
    score: number;
  };
}

export interface DetectLanguageRequest {
  text: string;
}

export interface DetectLanguageResponse {
  language: string;
  score: number;
  isTranslationSupported: boolean;
  isTransliterationSupported: boolean;
}

export interface SupportedLanguagesResponse {
  translation: Record<string, LanguageInfo>;
  transliteration?: Record<string, LanguageInfo>;
  dictionary?: Record<string, LanguageInfo>;
}

export interface LanguageInfo {
  name: string;
  nativeName: string;
  dir: 'ltr' | 'rtl';
}

// ============================================================================
// Subtitle Integration Types
// ============================================================================

export interface Subtitle {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface TranslatedSubtitle extends Subtitle {
  originalText: string;
  translatedText: string;
  fromLanguage: string;
  toLanguage: string;
  translationConfidence?: number;
}

export interface SubtitleTranslationRequest {
  subtitles: Subtitle[];
  fromLanguage?: string;
  toLanguage: string;
  preserveFormatting: boolean;
  mergeStrategy?: 'none' | 'by-speaker' | 'by-timing';
}

// ============================================================================
// Service Interface Types
// ============================================================================

export interface ITranslationService {
  translateText(request: TranslateTextRequest): Promise<string>;
  translateSubtitles(request: SubtitleTranslationRequest): Promise<TranslatedSubtitle[]>;
  detectLanguage(request: DetectLanguageRequest): Promise<string>;
  getSupportedLanguages(): Promise<SupportedLanguagesResponse>;
  getUsageStats(): Promise<UsageStats>;
  clearCache(): Promise<void>;
}

export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlHours?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): Promise<CacheStats>;
}

export interface IRateLimiter {
  checkLimit(characterCount: number): Promise<boolean>;
  recordUsage(characterCount: number): Promise<void>;
  getRemainingQuota(): Promise<RateLimitStatus>;
  reset(): Promise<void>;
}

// ============================================================================
// Caching Types
// ============================================================================

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
  size: number;
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  evictionCount: number;
}

// ============================================================================
// Rate Limiting Types
// ============================================================================

export interface RateLimitStatus {
  charactersUsedThisMonth: number;
  charactersRemainingThisMonth: number;
  requestsThisSecond: number;
  resetTimeSeconds: number;
  isLimitExceeded: boolean;
}

export interface UsageRecord {
  timestamp: number;
  characterCount: number;
  requestCount: number;
  endpoint: string;
}

// ============================================================================
// Batch Processing Types
// ============================================================================

export interface BatchRequest {
  id: string;
  texts: string[];
  fromLanguage?: string;
  toLanguage: string;
  priority: number;
  timestamp: number;
  callback?: (results: BatchResult) => void;
}

export interface BatchResult {
  id: string;
  translations: string[];
  success: boolean;
  error?: TranslationError;
  processingTime: number;
}

export interface BatchQueue {
  pending: BatchRequest[];
  processing: BatchRequest[];
  completed: BatchResult[];
}

// ============================================================================
// Error Types
// ============================================================================

export enum TranslationErrorCode {
  // Configuration Errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_API_KEY = 'MISSING_API_KEY',
  INVALID_ENDPOINT = 'INVALID_ENDPOINT',
  SERVICE_NOT_CONFIGURED = 'SERVICE_NOT_CONFIGURED',

  // Authentication Errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  API_KEY_EXPIRED = 'API_KEY_EXPIRED',

  // Request Errors
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNSUPPORTED_LANGUAGE = 'UNSUPPORTED_LANGUAGE',
  TEXT_TOO_LONG = 'TEXT_TOO_LONG',
  EMPTY_TEXT = 'EMPTY_TEXT',

  // Rate Limiting Errors
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Network Errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  // Processing Errors
  PARSING_ERROR = 'PARSING_ERROR',
  BATCH_ERROR = 'BATCH_ERROR',
  CACHE_ERROR = 'CACHE_ERROR',
  CANCELLED = 'CANCELLED',

  // Unknown Errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface TranslationError extends Error {
  code: TranslationErrorCode;
  details?: any;
  retryable: boolean;
  timestamp: number;
}

// ============================================================================
// Usage and Monitoring Types
// ============================================================================

export interface UsageStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  charactersTranslated: number;
  charactersRemainingThisMonth: number;
  averageResponseTime: number;
  cacheStats: CacheStats;
  errorBreakdown: Record<TranslationErrorCode, number>;
  languagePairUsage: Record<string, number>;
  lastUpdated: number;
}

export interface ServiceMetrics {
  requestCount: number;
  successCount: number;
  errorCount: number;
  totalCharacters: number;
  averageResponseTime: number;
  cacheHitRate: number;
  lastRequestTime: number;
  uptime: number;
}

// ============================================================================
// Configuration Defaults
// ============================================================================

export const DEFAULT_TRANSLATION_CONFIG: Partial<TranslationConfig> = {
  endpoint: 'https://api.cognitive.microsofttranslator.com',
  apiVersion: '3.0',
  timeout: 30000,
  retryAttempts: 3,
  rateLimitConfig: {
    maxCharactersPerMonth: 2000000, // Free tier limit
    maxCharactersPerMinute: 10000,
    maxRequestsPerSecond: 10,
    trackingEnabled: true
  },
  cacheConfig: {
    enabled: true,
    ttlHours: 24,
    maxEntries: 10000,
    compressionEnabled: true
  },
  batchConfig: {
    enabled: true,
    maxTextsPerBatch: 100, // Azure API limit
    maxBatchSizeBytes: 50000,
    batchTimeoutMs: 5000
  }
};

// ============================================================================
// Language Code Types
// ============================================================================

export type LanguageCode = 
  | 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ru' | 'ja' | 'ko' | 'zh' 
  | 'ar' | 'hi' | 'tr' | 'pl' | 'nl' | 'sv' | 'da' | 'no' | 'fi' | 'cs'
  | 'hu' | 'ro' | 'bg' | 'hr' | 'sk' | 'sl' | 'et' | 'lv' | 'lt' | 'mt'
  | 'el' | 'he' | 'th' | 'vi' | 'id' | 'ms' | 'tl' | 'sw' | 'yo' | 'zu'
  | 'af' | 'sq' | 'am' | 'hy' | 'az' | 'eu' | 'be' | 'bn' | 'bs' | 'my'
  | 'ca' | 'ceb' | 'ny' | 'co' | 'cy' | 'eo' | 'fa' | 'fy' | 'gd' | 'gl'
  | 'ka' | 'gu' | 'ht' | 'ha' | 'haw' | 'iw' | 'hmn' | 'is' | 'ig' | 'ga'
  | 'jw' | 'kn' | 'kk' | 'km' | 'rw' | 'ku' | 'ky' | 'lo' | 'la' | 'lb'
  | 'mk' | 'mg' | 'ml' | 'mi' | 'mr' | 'mn' | 'ne' | 'ps' | 'pa' | 'sm'
  | 'sr' | 'st' | 'sn' | 'sd' | 'si' | 'so' | 'su' | 'tg' | 'ta' | 'tt'
  | 'te' | 'uk' | 'ur' | 'ug' | 'uz' | 'xh' | 'yi' | 'auto';

// ============================================================================
// Dictionary API Types
// ============================================================================

export interface Phonetic {
  text?: string;
  audio?: string;
}

export interface Definition {
  definition: string;
  example?: string;
  synonyms: string[];
  antonyms: string[];
}

export interface Meaning {
  partOfSpeech: string;
  definitions: Definition[];
  synonyms?: string[];
  antonyms?: string[];
}

export interface WordDefinition {
  word: string;
  phonetic?: string;
  phonetics: Phonetic[];
  origin?: string;
  meanings: Meaning[];
  license?: {
    name: string;
    url: string;
  };
  sourceUrls: string[];
}

export interface DictionaryApiResponse extends WordDefinition {}

export interface DictionaryErrorResponse {
  title: string;
  message: string;
  resolution: string;
}

export interface DictionaryRequest {
  word: string;
  language: LanguageCode;
}

export interface DictionaryConfig {
  baseUrl: string;
  timeout: number;
  retryAttempts: number;
  cacheTtlHours: number;
  supportedLanguages: LanguageCode[];
}

export interface IDictionaryService {
  getDefinition(word: string, language: LanguageCode): Promise<WordDefinition>;
  getPhonetics(word: string, language: LanguageCode): Promise<Phonetic[]>;
  getPronunciationUrl(word: string, language: LanguageCode): Promise<string>;
  isLanguageSupported(language: LanguageCode): boolean;
  clearCache(): Promise<void>;
}

// Dictionary-specific error codes
export enum DictionaryErrorCode {
  WORD_NOT_FOUND = 'WORD_NOT_FOUND',
  UNSUPPORTED_LANGUAGE = 'UNSUPPORTED_LANGUAGE',
  INVALID_WORD = 'INVALID_WORD',
  API_UNAVAILABLE = 'API_UNAVAILABLE',
  PARSING_ERROR = 'PARSING_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  CACHE_ERROR = 'CACHE_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface DictionaryError extends Error {
  code: DictionaryErrorCode;
  details?: any;
  retryable: boolean;
  timestamp: number;
}

// ============================================================================
// Text-to-Speech (TTS) Types
// ============================================================================

export interface TTSConfig {
  defaultRate: number;
  defaultPitch: number;
  defaultVolume: number;
  queueTimeout: number;
  fallbackToAudio: boolean;
  preferredVoiceNames: Record<string, string[]>; // language -> preferred voice names
}

export interface TTSRequest {
  text: string;
  language: LanguageCode;
  voice?: SpeechSynthesisVoice;
  rate?: number;
  pitch?: number;
  volume?: number;
  priority?: number;
}

export interface TTSQueueItem extends TTSRequest {
  id: string;
  timestamp: number;
  resolve: () => void;
  reject: (error: TTSError) => void;
  utterance?: SpeechSynthesisUtterance;
}

export interface TTSVoiceInfo {
  voice: SpeechSynthesisVoice;
  name: string;
  language: string;
  localService: boolean;
  isDefault: boolean;
  quality: 'high' | 'medium' | 'low';
}

export interface TTSStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  fallbacksUsed: number;
  averageDuration: number;
  queueLength: number;
  voicesAvailable: number;
  lastRequestTime: number;
}

export interface ITTSService {
  speak(text: string, language: LanguageCode): Promise<void>;
  speakWithOptions(request: TTSRequest): Promise<void>;
  getAvailableVoices(): SpeechSynthesisVoice[];
  getVoicesForLanguage(language: LanguageCode): SpeechSynthesisVoice[];
  setPreferredVoice(language: LanguageCode, voice: SpeechSynthesisVoice): void;
  setRate(rate: number): void;
  setPitch(pitch: number): void;
  setVolume(volume: number): void;
  pause(): void;
  resume(): void;
  cancel(): void;
  isSupported(): boolean;
  isSpeaking(): boolean;
  getStats(): TTSStats;
}

// TTS-specific error codes
export enum TTSErrorCode {
  NOT_SUPPORTED = 'NOT_SUPPORTED',
  NO_VOICES_AVAILABLE = 'NO_VOICES_AVAILABLE',
  UNSUPPORTED_LANGUAGE = 'UNSUPPORTED_LANGUAGE',
  INVALID_TEXT = 'INVALID_TEXT',
  SYNTHESIS_FAILED = 'SYNTHESIS_FAILED',
  VOICE_NOT_FOUND = 'VOICE_NOT_FOUND',
  AUDIO_INTERRUPTED = 'AUDIO_INTERRUPTED',
  QUEUE_TIMEOUT = 'QUEUE_TIMEOUT',
  BROWSER_LIMITATION = 'BROWSER_LIMITATION',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface TTSError extends Error {
  code: TTSErrorCode;
  details?: any;
  retryable: boolean;
  timestamp: number;
}

export const SUPPORTED_LANGUAGES: Record<LanguageCode, string> = {
  'en': 'English',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'ja': 'Japanese',
  'ko': 'Korean',
  'zh': 'Chinese',
  'ar': 'Arabic',
  'hi': 'Hindi',
  'tr': 'Turkish',
  'pl': 'Polish',
  'nl': 'Dutch',
  'sv': 'Swedish',
  'da': 'Danish',
  'no': 'Norwegian',
  'fi': 'Finnish',
  'cs': 'Czech',
  'hu': 'Hungarian',
  'ro': 'Romanian',
  'bg': 'Bulgarian',
  'hr': 'Croatian',
  'sk': 'Slovak',
  'sl': 'Slovenian',
  'et': 'Estonian',
  'lv': 'Latvian',
  'lt': 'Lithuanian',
  'mt': 'Maltese',
  'el': 'Greek',
  'he': 'Hebrew',
  'th': 'Thai',
  'vi': 'Vietnamese',
  'id': 'Indonesian',
  'ms': 'Malay',
  'tl': 'Filipino',
  'sw': 'Swahili',
  'yo': 'Yoruba',
  'zu': 'Zulu',
  'af': 'Afrikaans',
  'sq': 'Albanian',
  'am': 'Amharic',
  'hy': 'Armenian',
  'az': 'Azerbaijani',
  'eu': 'Basque',
  'be': 'Belarusian',
  'bn': 'Bengali',
  'bs': 'Bosnian',
  'my': 'Myanmar',
  'ca': 'Catalan',
  'ceb': 'Cebuano',
  'ny': 'Chichewa',
  'co': 'Corsican',
  'cy': 'Welsh',
  'eo': 'Esperanto',
  'fa': 'Persian',
  'fy': 'Frisian',
  'gd': 'Scottish Gaelic',
  'gl': 'Galician',
  'ka': 'Georgian',
  'gu': 'Gujarati',
  'ht': 'Haitian Creole',
  'ha': 'Hausa',
  'haw': 'Hawaiian',
  'iw': 'Hebrew',
  'hmn': 'Hmong',
  'is': 'Icelandic',
  'ig': 'Igbo',
  'ga': 'Irish',
  'jw': 'Javanese',
  'kn': 'Kannada',
  'kk': 'Kazakh',
  'km': 'Khmer',
  'rw': 'Kinyarwanda',
  'ku': 'Kurdish',
  'ky': 'Kyrgyz',
  'lo': 'Lao',
  'la': 'Latin',
  'lb': 'Luxembourgish',
  'mk': 'Macedonian',
  'mg': 'Malagasy',
  'ml': 'Malayalam',
  'mi': 'Maori',
  'mr': 'Marathi',
  'mn': 'Mongolian',
  'ne': 'Nepali',
  'ps': 'Pashto',
  'pa': 'Punjabi',
  'sm': 'Samoan',
  'sr': 'Serbian',
  'st': 'Sesotho',
  'sn': 'Shona',
  'sd': 'Sindhi',
  'si': 'Sinhala',
  'so': 'Somali',
  'su': 'Sundanese',
  'tg': 'Tajik',
  'ta': 'Tamil',
  'tt': 'Tatar',
  'te': 'Telugu',
  'uk': 'Ukrainian',
  'ur': 'Urdu',
  'ug': 'Uyghur',
  'uz': 'Uzbek',
  'xh': 'Xhosa',
  'yi': 'Yiddish',
  'auto': 'Auto-detect'
}; 