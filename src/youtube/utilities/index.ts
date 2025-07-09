/**
 * LinguaTube YouTube Player Utilities
 * 
 * Comprehensive utility functions with strict TypeScript typings
 * to support YouTube player interaction features.
 * 
 * @module YouTubePlayerUtilities
 */

// ========================================
// Type Definitions
// ========================================

export interface TimeFormatOptions {
  readonly format: 'srt' | 'vtt' | 'human' | 'seconds';
  readonly precision?: number; // decimal places for seconds
  readonly includeMilliseconds?: boolean;
}

export interface ClampOptions {
  readonly min: number;
  readonly max: number;
  readonly inclusive?: boolean;
}

export interface ThrottleOptions {
  readonly leading?: boolean;
  readonly trailing?: boolean;
}

export interface DebounceOptions {
  readonly immediate?: boolean;
}

export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelay: number;
  readonly maxDelay?: number;
  readonly exponentialBackoff?: boolean;
  readonly jitter?: boolean;
}

export interface TimeoutOptions {
  readonly timeoutMs: number;
  readonly timeoutMessage?: string;
}

export interface DOMQueryOptions {
  readonly timeout?: number;
  readonly retries?: number;
  readonly fallbackSelectors?: string[];
  readonly validateElement?: (element: Element) => boolean;
}

export interface ValidationResult<T = unknown> {
  readonly isValid: boolean;
  readonly value?: T;
  readonly error?: string;
  readonly details?: Record<string, unknown>;
}

export interface SafeParseResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

// ========================================
// Time Utilities
// ========================================

/**
 * Parse time string to seconds
 * Supports formats: "HH:MM:SS", "MM:SS", "SS", "HH:MM:SS.mmm"
 */
export function parseTimeToSeconds(timeString: string): number {
  if (typeof timeString !== 'string' || !timeString.trim()) {
    throw new Error('Invalid time string: must be non-empty string');
  }

  const cleanTime = timeString.trim();
  
  // Handle decimal seconds (e.g., "45.5")
  if (/^\d+(\.\d+)?$/.test(cleanTime)) {
    const seconds = parseFloat(cleanTime);
    if (isNaN(seconds) || seconds < 0) {
      throw new Error(`Invalid seconds value: ${cleanTime}`);
    }
    return seconds;
  }

  // Handle time format (HH:MM:SS, MM:SS, etc.)
  const timeRegex = /^(?:(\d{1,2}):)?(?:(\d{1,2}):)?(\d{1,2})(?:\.(\d{1,3}))?$/;
  const match = cleanTime.match(timeRegex);
  
  if (!match) {
    throw new Error(`Invalid time format: ${timeString}. Expected formats: HH:MM:SS, MM:SS, SS, or decimal seconds`);
  }

  const [, hours = '0', minutes = '0', seconds, milliseconds = '0'] = match;
  
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  const s = parseInt(seconds, 10);
  const ms = parseInt(milliseconds.padEnd(3, '0'), 10);
  
  if (m >= 60 || s >= 60) {
    throw new Error(`Invalid time values: minutes and seconds must be less than 60`);
  }
  
  return h * 3600 + m * 60 + s + ms / 1000;
}

/**
 * Format seconds to time string
 */
export function formatTime(seconds: number, options: TimeFormatOptions = { format: 'human' }): string {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
    throw new Error('Invalid seconds value: must be non-negative number');
  }

  const { format, precision = 2, includeMilliseconds = false } = options;
  
  if (format === 'seconds') {
    return includeMilliseconds 
      ? seconds.toFixed(3)
      : seconds.toFixed(precision);
  }

  const totalSeconds = Math.floor(seconds);
  const milliseconds = Math.floor((seconds - totalSeconds) * 1000);
  
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  const pad = (num: number, len: number = 2): string => num.toString().padStart(len, '0');
  
  let timeStr = '';
  
  switch (format) {
    case 'srt':
      timeStr = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
      if (includeMilliseconds) {
        timeStr += `,${pad(milliseconds, 3)}`;
      }
      break;
      
    case 'vtt':
      timeStr = hours > 0 
        ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
        : `${pad(minutes)}:${pad(secs)}`;
      if (includeMilliseconds) {
        timeStr += `.${pad(milliseconds, 3)}`;
      }
      break;
      
    case 'human':
    default:
      if (hours > 0) {
        timeStr = `${hours}:${pad(minutes)}:${pad(secs)}`;
      } else {
        timeStr = `${minutes}:${pad(secs)}`;
      }
      break;
  }
  
  return timeStr;
}

/**
 * Validate time range
 */
export function validateTimeRange(startTime: number, endTime: number): ValidationResult<{ startTime: number; endTime: number }> {
  if (typeof startTime !== 'number' || typeof endTime !== 'number') {
    return {
      isValid: false,
      error: 'Start and end times must be numbers'
    };
  }
  
  if (isNaN(startTime) || isNaN(endTime)) {
    return {
      isValid: false,
      error: 'Start and end times must be valid numbers'
    };
  }
  
  if (startTime < 0 || endTime < 0) {
    return {
      isValid: false,
      error: 'Start and end times must be non-negative'
    };
  }
  
  if (startTime >= endTime) {
    return {
      isValid: false,
      error: 'Start time must be less than end time',
      details: { startTime, endTime }
    };
  }
  
  return {
    isValid: true,
    value: { startTime, endTime }
  };
}

/**
 * Check if time is within range
 */
export function isTimeInRange(time: number, startTime: number, endTime: number, tolerance: number = 0): boolean {
  if (typeof time !== 'number' || typeof startTime !== 'number' || typeof endTime !== 'number') {
    return false;
  }
  
  return time >= (startTime - tolerance) && time <= (endTime + tolerance);
}

// ========================================
// Math Utilities
// ========================================

/**
 * Clamp value to range
 */
export function clamp(value: number, options: ClampOptions): number {
  const { min, max, inclusive = true } = options;
  
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error('Value must be a valid number');
  }
  
  if (min >= max) {
    throw new Error('Min value must be less than max value');
  }
  
  if (inclusive) {
    return Math.min(Math.max(value, min), max);
  } else {
    // Exclusive bounds
    if (value <= min) return min + Number.EPSILON;
    if (value >= max) return max - Number.EPSILON;
    return value;
  }
}

/**
 * Check if value is in range
 */
export function isInRange(value: number, min: number, max: number, inclusive: boolean = true): boolean {
  if (typeof value !== 'number' || typeof min !== 'number' || typeof max !== 'number') {
    return false;
  }
  
  if (isNaN(value) || isNaN(min) || isNaN(max)) {
    return false;
  }
  
  return inclusive 
    ? value >= min && value <= max
    : value > min && value < max;
}

/**
 * Linear interpolation
 */
export function lerp(start: number, end: number, t: number): number {
  if (typeof start !== 'number' || typeof end !== 'number' || typeof t !== 'number') {
    throw new Error('All parameters must be numbers');
  }
  
  return start + t * (end - start);
}

/**
 * Map value from one range to another
 */
export function mapRange(
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number
): number {
  const normalizedValue = (value - fromMin) / (fromMax - fromMin);
  return lerp(toMin, toMax, normalizedValue);
}

// ========================================
// DOM Utilities
// ========================================

/**
 * Safe DOM query with retries and validation
 */
export async function safeQuerySelector<T extends Element = Element>(
  selector: string,
  options: DOMQueryOptions = {}
): Promise<T | null> {
  const {
    timeout = 5000,
    retries = 3,
    fallbackSelectors = [],
    validateElement
  } = options;
  
  const selectors = [selector, ...fallbackSelectors];
  
  for (let attempt = 0; attempt < retries; attempt++) {
    for (const currentSelector of selectors) {
      try {
        const element = document.querySelector<T>(currentSelector);
        
        if (element && (!validateElement || validateElement(element))) {
          return element;
        }
      } catch (error) {
        console.warn(`[safeQuerySelector] Query failed for selector "${currentSelector}":`, error);
      }
    }
    
    if (attempt < retries - 1) {
      await delay(Math.min(100 * (attempt + 1), 1000));
    }
  }
  
  return null;
}

/**
 * Wait for element to appear in DOM
 */
export function waitForElement<T extends Element = Element>(
  selector: string,
  options: DOMQueryOptions & { signal?: AbortSignal } = {}
): Promise<T | null> {
  const { timeout = 10000, validateElement, signal } = options;
  
  return new Promise((resolve, reject) => {
    // Check if already exists
    const existing = document.querySelector<T>(selector);
    if (existing && (!validateElement || validateElement(existing))) {
      resolve(existing);
      return;
    }
    
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = (node as Element).matches?.(selector) 
                ? (node as T)
                : (node as Element).querySelector<T>(selector);
                
              if (element && (!validateElement || validateElement(element))) {
                observer.disconnect();
                resolve(element);
                return;
              }
            }
          }
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    // Setup timeout
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
    
    // Handle abort signal
    if (signal) {
      const abortHandler = () => {
        observer.disconnect();
        clearTimeout(timeoutId);
        reject(new Error('Operation aborted'));
      };
      
      if (signal.aborted) {
        abortHandler();
        return;
      }
      
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
}

/**
 * Check if element is valid and accessible
 */
export function isElementValid(element: unknown): element is Element {
  return element instanceof Element && 
         element.isConnected && 
         element.nodeType === Node.ELEMENT_NODE;
}

/**
 * Check if element is a valid video element
 */
export function isValidVideoElement(element: unknown): element is HTMLVideoElement {
  return element instanceof HTMLVideoElement &&
         element.isConnected &&
         typeof element.play === 'function' &&
         typeof element.pause === 'function' &&
         !isNaN(element.duration || 0);
}

// ========================================
// Event Utilities
// ========================================

/**
 * Throttle function execution
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
  options: ThrottleOptions = {}
): T & { cancel: () => void; flush: () => void } {
  const { leading = true, trailing = true } = options;
  
  let timeoutId: number | null = null;
  let lastCallTime = 0;
  let lastArgs: Parameters<T> | null = null;
  let lastThis: any = null;
  
  const throttled = function(this: any, ...args: Parameters<T>) {
    const now = Date.now();
    lastThis = this;
    lastArgs = args;
    
    const timeSinceLastCall = now - lastCallTime;
    
    if (leading && lastCallTime === 0) {
      lastCallTime = now;
      return func.apply(this, args);
    }
    
    if (timeSinceLastCall >= delay) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      lastCallTime = now;
      return func.apply(this, args);
    }
    
    if (trailing && !timeoutId) {
      timeoutId = window.setTimeout(() => {
        lastCallTime = Date.now();
        timeoutId = null;
        if (lastArgs && lastThis) {
          func.apply(lastThis, lastArgs);
        }
      }, delay - timeSinceLastCall);
    }
  } as T & { cancel: () => void; flush: () => void };
  
  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastCallTime = 0;
    lastArgs = null;
    lastThis = null;
  };
  
  throttled.flush = () => {
    if (timeoutId && lastArgs && lastThis) {
      clearTimeout(timeoutId);
      timeoutId = null;
      lastCallTime = Date.now();
      func.apply(lastThis, lastArgs);
    }
  };
  
  return throttled;
}

/**
 * Debounce function execution
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number,
  options: DebounceOptions = {}
): T & { cancel: () => void; flush: () => void } {
  const { immediate = false } = options;
  
  let timeoutId: number | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastThis: any = null;
  
  const debounced = function(this: any, ...args: Parameters<T>) {
    lastThis = this;
    lastArgs = args;
    
    const callNow = immediate && !timeoutId;
    
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      if (!immediate && lastArgs && lastThis) {
        func.apply(lastThis, lastArgs);
      }
    }, delay);
    
    if (callNow) {
      return func.apply(this, args);
    }
  } as T & { cancel: () => void; flush: () => void };
  
  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
    lastThis = null;
  };
  
  debounced.flush = () => {
    if (timeoutId && lastArgs && lastThis) {
      clearTimeout(timeoutId);
      timeoutId = null;
      func.apply(lastThis, lastArgs);
    }
  };
  
  return debounced;
}

// ========================================
// Async Utilities
// ========================================

/**
 * Simple delay utility
 */
export function delay(ms: number): Promise<void> {
  if (typeof ms !== 'number' || ms < 0) {
    throw new Error('Delay must be a non-negative number');
  }
  
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Add timeout to promise
 */
export function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, timeoutMessage = `Operation timed out after ${timeoutMs}ms` } = options;
  
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeoutId));
  });
}

/**
 * Retry operation with exponential backoff
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    baseDelay,
    maxDelay = 30000,
    exponentialBackoff = true,
    jitter = true
  } = options;
  
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxAttempts) {
        throw lastError;
      }
      
      let delayTime = exponentialBackoff 
        ? Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
        : baseDelay;
      
      if (jitter) {
        delayTime *= (0.5 + Math.random() * 0.5); // ±50% jitter
      }
      
      await delay(delayTime);
    }
  }
  
  throw lastError!;
}

// ========================================
// Validation Utilities
// ========================================

/**
 * Validate numeric parameter
 */
export function validateNumber(
  value: unknown,
  name: string,
  options: {
    min?: number;
    max?: number;
    integer?: boolean;
    finite?: boolean;
  } = {}
): ValidationResult<number> {
  const { min, max, integer = false, finite = true } = options;
  
  if (typeof value !== 'number') {
    return {
      isValid: false,
      error: `${name} must be a number, got ${typeof value}`
    };
  }
  
  if (isNaN(value)) {
    return {
      isValid: false,
      error: `${name} cannot be NaN`
    };
  }
  
  if (finite && !isFinite(value)) {
    return {
      isValid: false,
      error: `${name} must be finite`
    };
  }
  
  if (integer && !Number.isInteger(value)) {
    return {
      isValid: false,
      error: `${name} must be an integer`
    };
  }
  
  if (typeof min === 'number' && value < min) {
    return {
      isValid: false,
      error: `${name} must be >= ${min}, got ${value}`
    };
  }
  
  if (typeof max === 'number' && value > max) {
    return {
      isValid: false,
      error: `${name} must be <= ${max}, got ${value}`
    };
  }
  
  return {
    isValid: true,
    value
  };
}

/**
 * Validate string parameter
 */
export function validateString(
  value: unknown,
  name: string,
  options: {
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    nonEmpty?: boolean;
  } = {}
): ValidationResult<string> {
  const { minLength, maxLength, pattern, nonEmpty = false } = options;
  
  if (typeof value !== 'string') {
    return {
      isValid: false,
      error: `${name} must be a string, got ${typeof value}`
    };
  }
  
  if (nonEmpty && value.trim().length === 0) {
    return {
      isValid: false,
      error: `${name} cannot be empty`
    };
  }
  
  if (typeof minLength === 'number' && value.length < minLength) {
    return {
      isValid: false,
      error: `${name} must be at least ${minLength} characters long`
    };
  }
  
  if (typeof maxLength === 'number' && value.length > maxLength) {
    return {
      isValid: false,
      error: `${name} must be at most ${maxLength} characters long`
    };
  }
  
  if (pattern && !pattern.test(value)) {
    return {
      isValid: false,
      error: `${name} does not match required pattern`
    };
  }
  
  return {
    isValid: true,
    value
  };
}

// ========================================
// String Utilities
// ========================================

/**
 * Sanitize string for safe display
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  return input
    .replace(/[<>&"']/g, (char) => {
      const entityMap: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#x27;'
      };
      return entityMap[char] || char;
    })
    .trim();
}

/**
 * Truncate string with ellipsis
 */
export function truncateString(
  str: string,
  maxLength: number,
  ellipsis: string = '...'
): string {
  if (typeof str !== 'string' || str.length <= maxLength) {
    return str;
  }
  
  return str.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Safe JSON parse with error handling
 */
export function safeJsonParse<T = unknown>(json: string): SafeParseResult<T> {
  try {
    const data = JSON.parse(json) as T;
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Invalid JSON'
    };
  }
}

// ========================================
// Object Utilities
// ========================================

/**
 * Deep clone object using JSON methods (safe for serializable objects)
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    // Fallback for non-serializable objects
    return obj;
  }
}

/**
 * Check if object is empty
 */
export function isEmpty(obj: unknown): boolean {
  if (obj === null || obj === undefined) {
    return true;
  }
  
  if (Array.isArray(obj)) {
    return obj.length === 0;
  }
  
  if (typeof obj === 'object') {
    return Object.keys(obj).length === 0;
  }
  
  if (typeof obj === 'string') {
    return obj.trim().length === 0;
  }
  
  return false;
}

/**
 * Merge objects with type safety
 */
export function mergeObjects<T extends Record<string, any>>(
  target: T,
  source: Partial<T>
): T {
  const result = { ...target };
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      if (sourceValue !== undefined) {
        result[key] = sourceValue;
      }
    }
  }
  
  return result;
}

// ========================================
// Export All
// ========================================

export default {
  // Time utilities
  parseTimeToSeconds,
  formatTime,
  validateTimeRange,
  isTimeInRange,
  
  // Math utilities
  clamp,
  isInRange,
  lerp,
  mapRange,
  
  // DOM utilities
  safeQuerySelector,
  waitForElement,
  isElementValid,
  isValidVideoElement,
  
  // Event utilities
  throttle,
  debounce,
  
  // Async utilities
  delay,
  withTimeout,
  retry,
  
  // Validation utilities
  validateNumber,
  validateString,
  
  // String utilities
  sanitizeString,
  truncateString,
  safeJsonParse,
  
  // Object utilities
  deepClone,
  isEmpty,
  mergeObjects
} as const; 