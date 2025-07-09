// Core translation API service using Microsoft Translator REST API
// Handles text translation, language detection, and API communication

import createClient, { TranslatorCredential } from '@azure-rest/ai-translation-text';
import {
  TranslationConfig,
  TranslateTextRequest,
  TranslateTextResponse,
  DetectLanguageRequest,
  DetectLanguageResponse,
  SupportedLanguagesResponse,
  TranslationError,
  TranslationErrorCode,
  LanguageCode
} from './types';
import { configService } from './ConfigService';

// ============================================================================
// Translation Error Implementation
// ============================================================================

export class TranslationErrorImpl extends Error implements TranslationError {
  code: TranslationErrorCode;
  details?: any;
  retryable: boolean;
  timestamp: number;

  constructor(message: string, code: TranslationErrorCode, details?: any) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
    this.details = details;
    this.retryable = this.isRetryableError(code);
    this.timestamp = Date.now();
  }

  private isRetryableError(code: TranslationErrorCode): boolean {
    const retryableCodes = [
      TranslationErrorCode.NETWORK_ERROR,
      TranslationErrorCode.TIMEOUT,
      TranslationErrorCode.SERVICE_UNAVAILABLE,
      TranslationErrorCode.RATE_LIMIT_EXCEEDED
    ];
    
    return retryableCodes.includes(code);
  }
}

// ============================================================================
// API Client Management
// ============================================================================

export class TranslationApiService {
  private client: any = null;
  private config: TranslationConfig | null = null;
  private clientInitPromise: Promise<void> | null = null;

  // --------------------------------------------------------------------------
  // Client Initialization
  // --------------------------------------------------------------------------

  /**
   * Initialize the API client with current configuration
   */
  private async initializeClient(): Promise<void> {
    if (this.clientInitPromise) {
      return this.clientInitPromise;
    }

    this.clientInitPromise = this._doInitializeClient();
    return this.clientInitPromise;
  }

  private async _doInitializeClient(): Promise<void> {
    try {
      this.config = await configService.getConfig();
      
      // Create the credential and client
      const credential: TranslatorCredential = {
        key: this.config.apiKey,
        region: this.config.region || 'global'
      };
      this.client = createClient(this.config.endpoint, credential);

      console.log('Microsoft Translator API client initialized successfully');
    } catch (error) {
      this.client = null;
      this.config = null;
      this.clientInitPromise = null;
      
      if (error instanceof Error) {
        throw this.createTranslationError(
          `Failed to initialize translation client: ${error.message}`,
          TranslationErrorCode.INVALID_CONFIG,
          { originalError: error }
        );
      }
      
      throw this.createTranslationError(
        'Failed to initialize translation client',
        TranslationErrorCode.INVALID_CONFIG,
        { originalError: error }
      );
    }
  }

  /**
   * Ensure the client is ready for use
   */
  private async ensureClientReady(): Promise<void> {
    if (!this.client || !this.config) {
      await this.initializeClient();
    }
  }

  // --------------------------------------------------------------------------
  // Core Translation Functions
  // --------------------------------------------------------------------------

  /**
   * Translate text from one language to another
   */
  async translateText(request: TranslateTextRequest): Promise<string> {
    await this.ensureClientReady();

    // Validate request
    this.validateTranslateRequest(request);

    try {
      const { text, fromLanguage, toLanguage, category, textType } = request;
      
      // Prepare the API request body
      const requestBody = [{
        Text: text
      }];

      // Prepare query parameters
      const queryParams: any = {
        'api-version': this.config!.apiVersion,
        to: [toLanguage]
      };

      if (fromLanguage && fromLanguage !== 'auto') {
        queryParams.from = fromLanguage;
      }

      if (category) {
        queryParams.category = category;
      }

      if (textType) {
        queryParams.textType = textType;
      }

      // Make the API call
      const response = await this.client.path('/translate').post({
        body: requestBody,
        queryParameters: queryParams,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // Handle the response
      if (response.status !== '200') {
        throw this.handleApiError(response);
      }

      const responseData = await response.body;
      
      if (!Array.isArray(responseData) || responseData.length === 0) {
        throw this.createTranslationError(
          'Invalid response format from translation API',
          TranslationErrorCode.PARSING_ERROR,
          { response: responseData }
        );
      }

      const translation = responseData[0];
      
      if (!translation.translations || translation.translations.length === 0) {
        throw this.createTranslationError(
          'No translation returned from API',
          TranslationErrorCode.PARSING_ERROR,
          { response: responseData }
        );
      }

      return translation.translations[0].text;

    } catch (error) {
      if (error instanceof TranslationErrorImpl) {
        throw error;
      }

      throw this.createTranslationError(
        'Translation request failed',
        TranslationErrorCode.NETWORK_ERROR,
        { originalError: error, request }
      );
    }
  }

  /**
   * Translate multiple texts in a batch
   */
  async translateTexts(
    texts: string[], 
    fromLanguage: string | undefined, 
    toLanguage: string,
    category?: string,
    textType?: 'plain' | 'html'
  ): Promise<string[]> {
    await this.ensureClientReady();

    if (!texts || texts.length === 0) {
      throw this.createTranslationError(
        'No texts provided for translation',
        TranslationErrorCode.EMPTY_TEXT
      );
    }

    // Check batch size limits
    if (texts.length > this.config!.batchConfig.maxTextsPerBatch) {
      throw this.createTranslationError(
        `Batch size exceeds limit of ${this.config!.batchConfig.maxTextsPerBatch}`,
        TranslationErrorCode.BATCH_ERROR,
        { textsCount: texts.length, maxAllowed: this.config!.batchConfig.maxTextsPerBatch }
      );
    }

    try {
      // Prepare the API request body
      const requestBody = texts.map(text => ({ Text: text }));

      // Calculate total size
      const totalSize = JSON.stringify(requestBody).length;
      if (totalSize > this.config!.batchConfig.maxBatchSizeBytes) {
        throw this.createTranslationError(
          'Batch size exceeds byte limit',
          TranslationErrorCode.BATCH_ERROR,
          { size: totalSize, maxAllowed: this.config!.batchConfig.maxBatchSizeBytes }
        );
      }

      // Prepare query parameters
      const queryParams: any = {
        'api-version': this.config!.apiVersion,
        to: [toLanguage]
      };

      if (fromLanguage && fromLanguage !== 'auto') {
        queryParams.from = fromLanguage;
      }

      if (category) {
        queryParams.category = category;
      }

      if (textType) {
        queryParams.textType = textType;
      }

      // Make the API call
      const response = await this.client.path('/translate').post({
        body: requestBody,
        queryParameters: queryParams,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // Handle the response
      if (response.status !== '200') {
        throw this.handleApiError(response);
      }

      const responseData = await response.body;
      
      if (!Array.isArray(responseData)) {
        throw this.createTranslationError(
          'Invalid response format from batch translation API',
          TranslationErrorCode.PARSING_ERROR,
          { response: responseData }
        );
      }

      // Extract translations
      const translations: string[] = [];
      for (let i = 0; i < responseData.length; i++) {
        const translation = responseData[i];
        
        if (!translation.translations || translation.translations.length === 0) {
          throw this.createTranslationError(
            `No translation returned for text at index ${i}`,
            TranslationErrorCode.PARSING_ERROR,
            { index: i, response: translation }
          );
        }

        translations.push(translation.translations[0].text);
      }

      return translations;

    } catch (error) {
      if (error instanceof TranslationErrorImpl) {
        throw error;
      }

      throw this.createTranslationError(
        'Batch translation request failed',
        TranslationErrorCode.BATCH_ERROR,
        { originalError: error, textsCount: texts.length }
      );
    }
  }

  /**
   * Detect the language of the input text
   */
  async detectLanguage(request: DetectLanguageRequest): Promise<string> {
    await this.ensureClientReady();

    if (!request.text || request.text.trim().length === 0) {
      throw this.createTranslationError(
        'Text is required for language detection',
        TranslationErrorCode.EMPTY_TEXT
      );
    }

    try {
      // Prepare the API request body
      const requestBody = [{
        Text: request.text
      }];

      // Make the API call
      const response = await this.client.path('/detect').post({
        body: requestBody,
        queryParameters: {
          'api-version': this.config!.apiVersion
        },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      // Handle the response
      if (response.status !== '200') {
        throw this.handleApiError(response);
      }

      const responseData = await response.body;
      
      if (!Array.isArray(responseData) || responseData.length === 0) {
        throw this.createTranslationError(
          'Invalid response format from language detection API',
          TranslationErrorCode.PARSING_ERROR,
          { response: responseData }
        );
      }

      const detection = responseData[0];
      
      if (!detection.language) {
        throw this.createTranslationError(
          'No language detected in response',
          TranslationErrorCode.PARSING_ERROR,
          { response: responseData }
        );
      }

      return detection.language;

    } catch (error) {
      if (error instanceof TranslationErrorImpl) {
        throw error;
      }

      throw this.createTranslationError(
        'Language detection request failed',
        TranslationErrorCode.NETWORK_ERROR,
        { originalError: error, request }
      );
    }
  }

  /**
   * Get supported languages for translation
   */
  async getSupportedLanguages(): Promise<SupportedLanguagesResponse> {
    await this.ensureClientReady();

    try {
      // Make the API call
      const response = await this.client.path('/languages').get({
        queryParameters: {
          'api-version': this.config!.apiVersion,
          scope: 'translation'
        }
      });

      // Handle the response
      if (response.status !== '200') {
        throw this.handleApiError(response);
      }

      const responseData = await response.body;
      
      if (!responseData || typeof responseData !== 'object') {
        throw this.createTranslationError(
          'Invalid response format from languages API',
          TranslationErrorCode.PARSING_ERROR,
          { response: responseData }
        );
      }

      return responseData as SupportedLanguagesResponse;

    } catch (error) {
      if (error instanceof TranslationErrorImpl) {
        throw error;
      }

      throw this.createTranslationError(
        'Failed to get supported languages',
        TranslationErrorCode.NETWORK_ERROR,
        { originalError: error }
      );
    }
  }

  // --------------------------------------------------------------------------
  // Validation and Error Handling
  // --------------------------------------------------------------------------

  /**
   * Validate a translation request
   */
  private validateTranslateRequest(request: TranslateTextRequest): void {
    if (!request.text || request.text.trim().length === 0) {
      throw this.createTranslationError(
        'Text is required for translation',
        TranslationErrorCode.EMPTY_TEXT
      );
    }

    if (!request.toLanguage) {
      throw this.createTranslationError(
        'Target language is required',
        TranslationErrorCode.UNSUPPORTED_LANGUAGE
      );
    }

    // Check text length (Azure has a 50,000 character limit per request)
    if (request.text.length > 50000) {
      throw this.createTranslationError(
        'Text exceeds maximum length of 50,000 characters',
        TranslationErrorCode.TEXT_TOO_LONG,
        { textLength: request.text.length, maxLength: 50000 }
      );
    }

    // Validate language codes if provided
    if (request.fromLanguage && request.fromLanguage !== 'auto') {
      if (!this.isValidLanguageCode(request.fromLanguage)) {
        throw this.createTranslationError(
          'Invalid source language code',
          TranslationErrorCode.UNSUPPORTED_LANGUAGE,
          { language: request.fromLanguage }
        );
      }
    }

    if (!this.isValidLanguageCode(request.toLanguage)) {
      throw this.createTranslationError(
        'Invalid target language code',
        TranslationErrorCode.UNSUPPORTED_LANGUAGE,
        { language: request.toLanguage }
      );
    }
  }

  /**
   * Check if a language code is valid
   */
  private isValidLanguageCode(code: string): boolean {
    // For now, use a basic check - this could be enhanced with the actual supported languages
    return /^[a-z]{2}(-[A-Z]{2})?$/.test(code) || code === 'auto';
  }

  /**
   * Handle API error responses
   */
  private handleApiError(response: any): TranslationErrorImpl {
    const status = response.status;
    let code: TranslationErrorCode;
    let message: string;

    switch (status) {
      case '400':
        code = TranslationErrorCode.INVALID_REQUEST;
        message = 'Invalid request parameters';
        break;
      case '401':
        code = TranslationErrorCode.UNAUTHORIZED;
        message = 'Invalid or missing API key';
        break;
      case '403':
        code = TranslationErrorCode.FORBIDDEN;
        message = 'Access forbidden - check your subscription';
        break;
      case '408':
        code = TranslationErrorCode.TIMEOUT;
        message = 'Request timeout';
        break;
      case '429':
        code = TranslationErrorCode.RATE_LIMIT_EXCEEDED;
        message = 'Rate limit exceeded';
        break;
      case '500':
      case '502':
      case '503':
      case '504':
        code = TranslationErrorCode.SERVICE_UNAVAILABLE;
        message = 'Translation service is temporarily unavailable';
        break;
      default:
        code = TranslationErrorCode.UNKNOWN_ERROR;
        message = `Unexpected API error (status: ${status})`;
    }

    return this.createTranslationError(message, code, {
      status,
      response: response.body
    });
  }

  /**
   * Create a standardized translation error
   */
  private createTranslationError(
    message: string,
    code: TranslationErrorCode,
    details?: any
  ): TranslationErrorImpl {
    return new TranslationErrorImpl(message, code, details);
  }

  // --------------------------------------------------------------------------
  // Client Management
  // --------------------------------------------------------------------------

  /**
   * Reset the client (useful when configuration changes)
   */
  async resetClient(): Promise<void> {
    this.client = null;
    this.config = null;
    this.clientInitPromise = null;
    await this.initializeClient();
  }

  /**
   * Check if the client is ready
   */
  isReady(): boolean {
    return this.client !== null && this.config !== null;
  }

  /**
   * Get current configuration
   */
  getCurrentConfig(): TranslationConfig | null {
    return this.config;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

// Export a singleton instance for use throughout the application
export const translationApiService = new TranslationApiService(); 