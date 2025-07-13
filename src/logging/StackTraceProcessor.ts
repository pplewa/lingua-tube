// ========================================
// Stack Trace Processing and Error Source Handling
// ========================================

import { ComponentType, ErrorType, ErrorSeverity } from './types';

/**
 * Stack trace frame information
 */
export interface StackFrame {
  readonly functionName?: string;
  readonly fileName?: string;
  readonly lineNumber?: number;
  readonly columnNumber?: number;
  readonly source?: string;
  readonly isNative?: boolean;
  readonly isExtensionCode?: boolean;
}

/**
 * Processed stack trace with enhanced information
 */
export interface ProcessedStackTrace {
  readonly original: string;
  readonly processed: string;
  readonly frames: StackFrame[];
  readonly redacted: boolean;
  readonly sourceMapApplied: boolean;
  readonly errorSource: ErrorSource;
  readonly sensitiveDataFound: boolean;
}

/**
 * Error source classification
 */
export enum ErrorSource {
  EXTENSION_CODE = 'extension_code',
  THIRD_PARTY = 'third_party',
  BROWSER_API = 'browser_api',
  USER_SCRIPT = 'user_script',
  CONTENT_SCRIPT = 'content_script',
  BACKGROUND_SCRIPT = 'background_script',
  POPUP_SCRIPT = 'popup_script',
  UNKNOWN = 'unknown',
}

/**
 * Source map entry for deobfuscation
 */
export interface SourceMapEntry {
  readonly originalLine: number;
  readonly originalColumn: number;
  readonly originalSource: string;
  readonly originalName?: string;
}

/**
 * Redaction configuration
 */
export interface RedactionConfig {
  readonly redactUrls: boolean;
  readonly redactPaths: boolean;
  readonly redactUserData: boolean;
  readonly redactApiKeys: boolean;
  readonly redactTokens: boolean;
  readonly customPatterns: RegExp[];
  readonly preserveExtensionPaths: boolean;
}

/**
 * Default redaction configuration
 */
export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  redactUrls: true,
  redactPaths: true,
  redactUserData: true,
  redactApiKeys: true,
  redactTokens: true,
  customPatterns: [],
  preserveExtensionPaths: true,
};

/**
 * Stack trace processor for Chrome extension error handling
 */
export class StackTraceProcessor {
  private static instance: StackTraceProcessor | null = null;
  private redactionConfig: RedactionConfig;
  private extensionId: string;
  private sourceMapCache: Map<string, any> = new Map();

  private constructor(config: Partial<RedactionConfig> = {}) {
    this.redactionConfig = { ...DEFAULT_REDACTION_CONFIG, ...config };
    this.extensionId = this.getExtensionId();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<RedactionConfig>): StackTraceProcessor {
    if (!StackTraceProcessor.instance) {
      StackTraceProcessor.instance = new StackTraceProcessor(config);
    }
    return StackTraceProcessor.instance;
  }

  /**
   * Process error and extract enhanced stack trace information
   */
  public processError(error: Error, context?: { component?: ComponentType }): ProcessedStackTrace {
    const originalStack = this.captureStackTrace(error);
    const frames = this.parseStackTrace(originalStack);
    const errorSource = this.classifyErrorSource(frames, context?.component);

    // Apply redaction
    const { redactedStack, sensitiveDataFound } = this.redactStackTrace(originalStack);

    // Process frames for additional information
    const processedFrames = this.enhanceFrames(frames);

    return {
      original: originalStack,
      processed: redactedStack,
      frames: processedFrames,
      redacted: sensitiveDataFound,
      sourceMapApplied: false, // TODO: Implement source map processing
      errorSource,
      sensitiveDataFound,
    };
  }

  /**
   * Capture stack trace with enhanced error information
   */
  private captureStackTrace(error: Error): string {
    // Use V8's captureStackTrace if available
    if (typeof Error !== 'undefined' && (Error as any).captureStackTrace) {
      const captureTarget = {};
      (Error as any).captureStackTrace(captureTarget, this.captureStackTrace);
      return (captureTarget as any).stack || error.stack || '';
    }

    // Fallback to error.stack
    if (error.stack) {
      return error.stack;
    }

    // Last resort: create new error for stack trace
    try {
      throw new Error('Stack trace capture');
    } catch (e) {
      return (e as Error).stack || 'No stack trace available';
    }
  }

  /**
   * Parse stack trace into individual frames
   */
  private parseStackTrace(stackTrace: string): StackFrame[] {
    const frames: StackFrame[] = [];
    const lines = stackTrace.split('\n');

    for (const line of lines) {
      const frame = this.parseStackFrame(line.trim());
      if (frame) {
        frames.push(frame);
      }
    }

    return frames;
  }

  /**
   * Parse individual stack frame line
   */
  private parseStackFrame(line: string): StackFrame | null {
    if (!line || line.startsWith('Error') || line.startsWith('    at Error')) {
      return null;
    }

    // Chrome/V8 format: "    at functionName (file:line:column)"
    const chromeMatch = line.match(/^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/);
    if (chromeMatch) {
      return {
        functionName: chromeMatch[1] !== '<anonymous>' ? chromeMatch[1] : undefined,
        fileName: chromeMatch[2],
        lineNumber: parseInt(chromeMatch[3], 10),
        columnNumber: parseInt(chromeMatch[4], 10),
        source: line,
        isNative: chromeMatch[2].includes('[native code]'),
        isExtensionCode: this.isExtensionFile(chromeMatch[2]),
      };
    }

    // Chrome/V8 format without function name: "    at file:line:column"
    const chromeSimpleMatch = line.match(/^\s*at\s+(.+?):(\d+):(\d+)$/);
    if (chromeSimpleMatch) {
      return {
        fileName: chromeSimpleMatch[1],
        lineNumber: parseInt(chromeSimpleMatch[2], 10),
        columnNumber: parseInt(chromeSimpleMatch[3], 10),
        source: line,
        isNative: chromeSimpleMatch[1].includes('[native code]'),
        isExtensionCode: this.isExtensionFile(chromeSimpleMatch[1]),
      };
    }

    // Firefox format: "functionName@file:line:column"
    const firefoxMatch = line.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
    if (firefoxMatch) {
      return {
        functionName: firefoxMatch[1],
        fileName: firefoxMatch[2],
        lineNumber: parseInt(firefoxMatch[3], 10),
        columnNumber: parseInt(firefoxMatch[4], 10),
        source: line,
        isNative: firefoxMatch[2].includes('[native code]'),
        isExtensionCode: this.isExtensionFile(firefoxMatch[2]),
      };
    }

    // Generic fallback
    return {
      source: line,
      isNative: line.includes('[native code]'),
      isExtensionCode: false,
    };
  }

  /**
   * Classify error source based on stack frames
   */
  private classifyErrorSource(frames: StackFrame[], component?: ComponentType): ErrorSource {
    if (frames.length === 0) {
      return ErrorSource.UNKNOWN;
    }

    const topFrame = frames[0];

    // Check if error originates from extension code
    if (topFrame.isExtensionCode) {
      if (component) {
        switch (component) {
          case ComponentType.BACKGROUND:
            return ErrorSource.BACKGROUND_SCRIPT;
          case ComponentType.CONTENT_SCRIPT:
            return ErrorSource.CONTENT_SCRIPT;
          case ComponentType.POPUP:
            return ErrorSource.POPUP_SCRIPT;
          default:
            return ErrorSource.EXTENSION_CODE;
        }
      }
      return ErrorSource.EXTENSION_CODE;
    }

    // Check for browser API errors
    if (
      topFrame.fileName?.includes('chrome-extension://') ||
      topFrame.fileName?.includes('moz-extension://')
    ) {
      return ErrorSource.BROWSER_API;
    }

    // Check for third-party code
    if (
      topFrame.fileName?.includes('node_modules') ||
      topFrame.fileName?.includes('vendor') ||
      topFrame.fileName?.includes('lib/')
    ) {
      return ErrorSource.THIRD_PARTY;
    }

    // Check for user script injection
    if (
      topFrame.fileName?.includes('userscript') ||
      topFrame.functionName?.includes('userScript')
    ) {
      return ErrorSource.USER_SCRIPT;
    }

    return ErrorSource.UNKNOWN;
  }

  /**
   * Redact sensitive information from stack trace
   */
  private redactStackTrace(stackTrace: string): {
    redactedStack: string;
    sensitiveDataFound: boolean;
  } {
    let redacted = stackTrace;
    let sensitiveDataFound = false;

    // Redact URLs (except extension URLs if preserveExtensionPaths is true)
    if (this.redactionConfig.redactUrls) {
      const urlPattern = /https?:\/\/[^\s)]+/g;
      if (urlPattern.test(redacted)) {
        sensitiveDataFound = true;
        redacted = redacted.replace(urlPattern, (match) => {
          if (
            this.redactionConfig.preserveExtensionPaths &&
            (match.includes('chrome-extension://') || match.includes('moz-extension://'))
          ) {
            return match;
          }
          return '[REDACTED_URL]';
        });
      }
    }

    // Redact file paths
    if (this.redactionConfig.redactPaths) {
      const pathPatterns = [
        /\/Users\/[^\/\s)]+/g, // macOS user paths
        /C:\\Users\\[^\\\/\s)]+/g, // Windows user paths
        /\/home\/[^\/\s)]+/g, // Linux user paths
        /\/tmp\/[^\s)]+/g, // Temporary paths
        /\/var\/[^\s)]+/g, // Variable paths
      ];

      for (const pattern of pathPatterns) {
        if (pattern.test(redacted)) {
          sensitiveDataFound = true;
          redacted = redacted.replace(pattern, '[REDACTED_PATH]');
        }
      }
    }

    // Redact API keys and tokens
    if (this.redactionConfig.redactApiKeys) {
      const apiKeyPatterns = [
        /[A-Za-z0-9]{32,}/g, // Generic long strings (potential API keys)
        /sk-[A-Za-z0-9]{48}/g, // OpenAI API keys
        /xoxb-[A-Za-z0-9-]+/g, // Slack tokens
        /ghp_[A-Za-z0-9]{36}/g, // GitHub tokens
        /Bearer\s+[A-Za-z0-9._-]+/g, // Bearer tokens
      ];

      for (const pattern of apiKeyPatterns) {
        if (pattern.test(redacted)) {
          sensitiveDataFound = true;
          redacted = redacted.replace(pattern, '[REDACTED_TOKEN]');
        }
      }
    }

    // Redact user data patterns
    if (this.redactionConfig.redactUserData) {
      const userDataPatterns = [
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email addresses
        /\b\d{3}-\d{2}-\d{4}\b/g, // SSN patterns
        /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/g, // Credit card patterns
      ];

      for (const pattern of userDataPatterns) {
        if (pattern.test(redacted)) {
          sensitiveDataFound = true;
          redacted = redacted.replace(pattern, '[REDACTED_USER_DATA]');
        }
      }
    }

    // Apply custom redaction patterns
    for (const pattern of this.redactionConfig.customPatterns) {
      if (pattern.test(redacted)) {
        sensitiveDataFound = true;
        redacted = redacted.replace(pattern, '[REDACTED_CUSTOM]');
      }
    }

    return { redactedStack: redacted, sensitiveDataFound };
  }

  /**
   * Enhance frames with additional metadata
   */
  private enhanceFrames(frames: StackFrame[]): StackFrame[] {
    return frames.map((frame) => ({
      ...frame,
      isExtensionCode: this.isExtensionFile(frame.fileName || ''),
      isNative: frame.isNative || this.isNativeCode(frame.fileName || ''),
    }));
  }

  /**
   * Check if file belongs to extension
   */
  private isExtensionFile(fileName: string): boolean {
    if (!fileName) return false;

    return (
      fileName.includes(`chrome-extension://${this.extensionId}`) ||
      fileName.includes(`moz-extension://${this.extensionId}`) ||
      fileName.includes('/build/') ||
      fileName.includes('/dist/') ||
      fileName.includes('/src/')
    );
  }

  /**
   * Check if code is native browser code
   */
  private isNativeCode(fileName: string): boolean {
    return (
      fileName.includes('[native code]') || fileName.includes('<anonymous>') || fileName === ''
    );
  }

  /**
   * Get current extension ID
   */
  private getExtensionId(): string {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        return chrome.runtime.id;
      }
    } catch (error) {
      // Ignore errors when chrome APIs are not available
    }
    return 'unknown';
  }

  /**
   * Update redaction configuration
   */
  public updateConfig(config: Partial<RedactionConfig>): void {
    this.redactionConfig = { ...this.redactionConfig, ...config };
  }

  /**
   * Get current redaction configuration
   */
  public getConfig(): RedactionConfig {
    return { ...this.redactionConfig };
  }

  /**
   * Clear source map cache
   */
  public clearSourceMapCache(): void {
    this.sourceMapCache.clear();
  }

  /**
   * Extract technical details from error for debugging
   */
  public extractTechnicalDetails(error: Error, processedTrace: ProcessedStackTrace): string {
    const details = [];

    details.push(`Error Type: ${error.name}`);
    details.push(`Message: ${error.message}`);
    details.push(`Source: ${processedTrace.errorSource}`);
    details.push(`Extension Code: ${processedTrace.frames.some((f) => f.isExtensionCode)}`);
    details.push(`Sensitive Data Redacted: ${processedTrace.sensitiveDataFound}`);
    details.push(`Frame Count: ${processedTrace.frames.length}`);

    if (processedTrace.frames.length > 0) {
      const topFrame = processedTrace.frames[0];
      if (topFrame.fileName) {
        details.push(
          `Top Frame: ${topFrame.fileName}:${topFrame.lineNumber}:${topFrame.columnNumber}`,
        );
      }
      if (topFrame.functionName) {
        details.push(`Function: ${topFrame.functionName}`);
      }
    }

    return details.join('\n');
  }

  /**
   * Generate user-friendly error message based on processed stack trace
   */
  public generateUserMessage(error: Error, processedTrace: ProcessedStackTrace): string {
    const errorSource = processedTrace.errorSource;
    const hasExtensionCode = processedTrace.frames.some((f) => f.isExtensionCode);

    if (hasExtensionCode) {
      switch (errorSource) {
        case ErrorSource.EXTENSION_CODE:
        case ErrorSource.BACKGROUND_SCRIPT:
        case ErrorSource.CONTENT_SCRIPT:
        case ErrorSource.POPUP_SCRIPT:
          return 'An error occurred in the extension. Please try refreshing the page or restarting the extension.';

        case ErrorSource.THIRD_PARTY:
          return 'An error occurred with a third-party component. The extension may continue to work normally.';

        case ErrorSource.BROWSER_API:
          return 'An error occurred while communicating with the browser. Please check your browser permissions.';

        default:
          return 'An unexpected error occurred. Please try again.';
      }
    }

    return 'An error occurred. Please try again or contact support if the problem persists.';
  }
}
