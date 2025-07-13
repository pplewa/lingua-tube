// Dictionary API service using Free Dictionary API
// Handles word definitions, phonetics, and pronunciation URLs

import {
  WordDefinition,
  Phonetic,
  DictionaryRequest,
  DictionaryConfig,
  DictionaryError,
  DictionaryErrorCode,
  DictionaryApiResponse,
  DictionaryErrorResponse,
  IDictionaryService,
  LanguageCode,
} from './types';

// ============================================================================
// Dictionary Error Implementation
// ============================================================================

export class DictionaryErrorImpl extends Error implements DictionaryError {
  code: DictionaryErrorCode;
  details?: any;
  retryable: boolean;
  timestamp: number;

  constructor(message: string, code: DictionaryErrorCode, details?: any) {
    super(message);
    this.name = 'DictionaryError';
    this.code = code;
    this.details = details;
    this.retryable = this.isRetryableError(code);
    this.timestamp = Date.now();
  }

  private isRetryableError(code: DictionaryErrorCode): boolean {
    const retryableCodes = [
      DictionaryErrorCode.NETWORK_ERROR,
      DictionaryErrorCode.TIMEOUT,
      DictionaryErrorCode.API_UNAVAILABLE,
    ];

    return retryableCodes.includes(code);
  }
}

// ============================================================================
// Dictionary API Service Implementation
// ============================================================================

export class DictionaryApiService implements IDictionaryService {
  private config: DictionaryConfig;
  private cache: Map<string, { data: WordDefinition; timestamp: number }> = new Map();

  constructor() {
    this.config = {
      baseUrl: 'https://api.dictionaryapi.dev/api/v2/entries',
      timeout: 10000, // 10 seconds
      retryAttempts: 3,
      cacheTtlHours: 24, // Cache definitions for 24 hours
      supportedLanguages: ['en'], // Only English is supported by Free Dictionary API
    };
  }

  // --------------------------------------------------------------------------
  // Public API Methods
  // --------------------------------------------------------------------------

  /**
   * Get complete word definition including meanings, phonetics, and pronunciation
   */
  async getDefinition(word: string, language: LanguageCode = 'en'): Promise<WordDefinition> {
    this.validateRequest(word, language);

    // Check cache first
    const cacheKey = this.getCacheKey(word, language);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const definition = await this.fetchDefinitionFromApi(word, language);

      // Cache the result
      this.setCache(cacheKey, definition);

      return definition;
    } catch (error) {
      if (error instanceof DictionaryErrorImpl) {
        throw error;
      }

      throw this.createDictionaryError(
        'Failed to fetch word definition',
        DictionaryErrorCode.UNKNOWN_ERROR,
        { originalError: error, word, language },
      );
    }
  }

  /**
   * Get phonetics for a word
   */
  async getPhonetics(word: string, language: LanguageCode = 'en'): Promise<Phonetic[]> {
    const definition = await this.getDefinition(word, language);
    return definition.phonetics;
  }

  /**
   * Get pronunciation URL for a word
   */
  async getPronunciationUrl(word: string, language: LanguageCode = 'en'): Promise<string> {
    const phonetics = await this.getPhonetics(word, language);

    // Find first phonetic entry with audio
    const phoneticWithAudio = phonetics.find((p) => p.audio && p.audio.trim() !== '');

    if (!phoneticWithAudio?.audio) {
      throw this.createDictionaryError(
        'No pronunciation audio available for this word',
        DictionaryErrorCode.WORD_NOT_FOUND,
        { word, language, phonetics },
      );
    }

    return phoneticWithAudio.audio;
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(language: LanguageCode): boolean {
    return this.config.supportedLanguages.includes(language);
  }

  /**
   * Clear the cache
   */
  async clearCache(): Promise<void> {
    this.cache.clear();
  }

  // --------------------------------------------------------------------------
  // Private API Methods
  // --------------------------------------------------------------------------

  /**
   * Fetch definition from the Free Dictionary API with retry logic
   */
  private async fetchDefinitionFromApi(
    word: string,
    language: LanguageCode,
  ): Promise<WordDefinition> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const url = `${this.config.baseUrl}/${language}/${encodeURIComponent(word)}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'LinguaTube Extension/1.0',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 404) {
            // Try to parse error response
            try {
              const errorData: DictionaryErrorResponse = await response.json();
              throw this.createDictionaryError(
                errorData.message || 'Word not found',
                DictionaryErrorCode.WORD_NOT_FOUND,
                { word, language, apiError: errorData },
              );
            } catch (parseError) {
              throw this.createDictionaryError(
                'Word not found',
                DictionaryErrorCode.WORD_NOT_FOUND,
                { word, language, status: response.status },
              );
            }
          }

          throw this.createDictionaryError(
            `API request failed with status ${response.status}`,
            DictionaryErrorCode.API_UNAVAILABLE,
            { word, language, status: response.status, statusText: response.statusText },
          );
        }

        const data: DictionaryApiResponse[] = await response.json();

        if (!Array.isArray(data) || data.length === 0) {
          throw this.createDictionaryError(
            'Invalid response format from dictionary API',
            DictionaryErrorCode.PARSING_ERROR,
            { word, language, response: data },
          );
        }

        // Return the first definition (Free Dictionary API returns an array)
        const definition = data[0];

        // Validate required fields
        if (!definition.word || !definition.meanings || !Array.isArray(definition.meanings)) {
          throw this.createDictionaryError(
            'Invalid definition structure received',
            DictionaryErrorCode.PARSING_ERROR,
            { word, language, definition },
          );
        }

        // Ensure phonetics array exists
        if (!definition.phonetics) {
          definition.phonetics = [];
        }

        return definition;
      } catch (error) {
        lastError = error as Error;

        // Don't retry certain errors
        if (error instanceof DictionaryErrorImpl) {
          const nonRetryableCodes = [
            DictionaryErrorCode.WORD_NOT_FOUND,
            DictionaryErrorCode.UNSUPPORTED_LANGUAGE,
            DictionaryErrorCode.INVALID_WORD,
            DictionaryErrorCode.PARSING_ERROR,
          ];

          if (nonRetryableCodes.includes(error.code)) {
            throw error;
          }
        }

        // Handle AbortError (timeout)
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = this.createDictionaryError('Request timeout', DictionaryErrorCode.TIMEOUT, {
            word,
            language,
            attempt,
          });
        }

        // If this isn't the last attempt, wait before retrying
        if (attempt < this.config.retryAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    throw (
      lastError ||
      this.createDictionaryError('All retry attempts failed', DictionaryErrorCode.NETWORK_ERROR, {
        word,
        language,
      })
    );
  }

  // --------------------------------------------------------------------------
  // Validation Methods
  // --------------------------------------------------------------------------

  /**
   * Validate the dictionary request
   */
  private validateRequest(word: string, language: LanguageCode): void {
    if (!word || typeof word !== 'string' || word.trim().length === 0) {
      throw this.createDictionaryError(
        'Word is required and must be a non-empty string',
        DictionaryErrorCode.INVALID_WORD,
        { word, language },
      );
    }

    if (word.trim().length > 100) {
      throw this.createDictionaryError(
        'Word is too long (maximum 100 characters)',
        DictionaryErrorCode.INVALID_WORD,
        { word, language },
      );
    }

    if (!this.isLanguageSupported(language)) {
      throw this.createDictionaryError(
        `Language '${language}' is not supported. Only English ('en') is currently supported.`,
        DictionaryErrorCode.UNSUPPORTED_LANGUAGE,
        { word, language, supportedLanguages: this.config.supportedLanguages },
      );
    }

    // Simple validation - just check for basic sanity
    // Let the dictionary API handle language-specific validation
    const trimmedWord = word.trim();
    if (trimmedWord.length === 0) {
      throw this.createDictionaryError('Word cannot be empty', DictionaryErrorCode.INVALID_WORD, {
        word,
        language,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Cache Management
  // --------------------------------------------------------------------------

  /**
   * Generate cache key for word and language
   */
  private getCacheKey(word: string, language: LanguageCode): string {
    return `${language}:${word.toLowerCase().trim()}`;
  }

  /**
   * Get definition from cache if not expired
   */
  private getFromCache(key: string): WordDefinition | null {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache entry has expired
    const now = Date.now();
    const ageHours = (now - cached.timestamp) / (1000 * 60 * 60);

    if (ageHours > this.config.cacheTtlHours) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Store definition in cache
   */
  private setCache(key: string, definition: WordDefinition): void {
    this.cache.set(key, {
      data: definition,
      timestamp: Date.now(),
    });

    // Simple cache size management - keep only last 1000 entries
    if (this.cache.size > 1000) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Error Handling
  // --------------------------------------------------------------------------

  /**
   * Create a dictionary error with consistent structure
   */
  private createDictionaryError(
    message: string,
    code: DictionaryErrorCode,
    details?: any,
  ): DictionaryErrorImpl {
    return new DictionaryErrorImpl(message, code, details);
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Get current configuration
   */
  getConfig(): DictionaryConfig {
    return { ...this.config };
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [key, entry] of this.cache.entries()) {
      const ageHours = (now - entry.timestamp) / (1000 * 60 * 60);
      if (ageHours <= this.config.cacheTtlHours) {
        validEntries++;
      } else {
        expiredEntries++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      cacheTtlHours: this.config.cacheTtlHours,
    };
  }
}

// ============================================================================
// Service Instance Export
// ============================================================================

// Create singleton instance
export const dictionaryApiService = new DictionaryApiService();

// Export default for easy importing
export default dictionaryApiService;
