# YouTube Player Utilities

Comprehensive utility functions with strict TypeScript typings to support YouTube player interaction features.

## Overview

This module provides a collection of reusable utilities that consolidate common patterns found throughout the YouTube player interaction codebase. All functions include strict TypeScript typing, comprehensive error handling, and extensive edge case coverage.

## Installation

```typescript
import {
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
  mergeObjects,
} from './utilities';

// Or import everything
import PlayerUtils from './utilities';
```

## API Reference

### Time Utilities

#### `parseTimeToSeconds(timeString: string): number`

Parse time string to seconds with support for multiple formats.

**Supported formats:**

- Decimal seconds: `"45.5"` → `45.5`
- Seconds: `"45"` → `45`
- MM:SS: `"3:45"` → `225`
- HH:MM:SS: `"1:23:45"` → `5025`
- With milliseconds: `"1:23:45.500"` → `5025.5`

```typescript
// Examples
parseTimeToSeconds('45.5'); // 45.5
parseTimeToSeconds('1:30'); // 90
parseTimeToSeconds('1:23:45'); // 5025
parseTimeToSeconds('1:23:45.500'); // 5025.5

// Error handling
try {
  parseTimeToSeconds('invalid');
} catch (error) {
  console.error(error.message); // "Invalid time format: invalid. Expected formats: HH:MM:SS, MM:SS, SS, or decimal seconds"
}
```

#### `formatTime(seconds: number, options?: TimeFormatOptions): string`

Format seconds to time string with various output formats.

```typescript
interface TimeFormatOptions {
  readonly format: 'srt' | 'vtt' | 'human' | 'seconds';
  readonly precision?: number; // decimal places for seconds
  readonly includeMilliseconds?: boolean;
}

// Examples
formatTime(5025.5, { format: 'human' }); // "1:23:45"
formatTime(5025.5, { format: 'srt', includeMilliseconds: true }); // "01:23:45,500"
formatTime(5025.5, { format: 'vtt', includeMilliseconds: true }); // "1:23:45.500"
formatTime(5025.5, { format: 'seconds', precision: 3 }); // "5025.500"
```

#### `validateTimeRange(startTime: number, endTime: number): ValidationResult`

Validate that a time range is valid.

```typescript
const result = validateTimeRange(10, 30);
if (result.isValid) {
  console.log('Range is valid:', result.value); // { startTime: 10, endTime: 30 }
} else {
  console.error('Invalid range:', result.error);
}

// Error cases
validateTimeRange(30, 10); // { isValid: false, error: "Start time must be less than end time" }
validateTimeRange(-5, 10); // { isValid: false, error: "Start and end times must be non-negative" }
```

#### `isTimeInRange(time: number, startTime: number, endTime: number, tolerance?: number): boolean`

Check if a time is within a range with optional tolerance.

```typescript
isTimeInRange(15, 10, 20); // true
isTimeInRange(25, 10, 20); // false
isTimeInRange(9.9, 10, 20, 0.2); // true (within tolerance)
```

### Math Utilities

#### `clamp(value: number, options: ClampOptions): number`

Clamp a value to a specified range.

```typescript
interface ClampOptions {
  readonly min: number;
  readonly max: number;
  readonly inclusive?: boolean;
}

// Examples
clamp(15, { min: 0, max: 10 }); // 10
clamp(-5, { min: 0, max: 10 }); // 0
clamp(5, { min: 0, max: 10, inclusive: false }); // 5
clamp(10, { min: 0, max: 10, inclusive: false }); // 9.999999999999998 (max - epsilon)
```

#### `isInRange(value: number, min: number, max: number, inclusive?: boolean): boolean`

Check if a value is within a range.

```typescript
isInRange(5, 0, 10); // true
isInRange(10, 0, 10); // true
isInRange(10, 0, 10, false); // false (exclusive)
isInRange(15, 0, 10); // false
```

#### `lerp(start: number, end: number, t: number): number`

Linear interpolation between two values.

```typescript
lerp(0, 100, 0.5); // 50
lerp(10, 20, 0.75); // 17.5
lerp(100, 0, 0.25); // 75
```

#### `mapRange(value, fromMin, fromMax, toMin, toMax): number`

Map a value from one range to another.

```typescript
// Map volume from 0-1 to 0-100
mapRange(0.7, 0, 1, 0, 100); // 70

// Map playback rate from 0.25-2 to -100-100
mapRange(1.25, 0.25, 2, -100, 100); // 14.285714285714286
```

### DOM Utilities

#### `safeQuerySelector<T>(selector: string, options?: DOMQueryOptions): Promise<T | null>`

Safe DOM query with retries, fallback selectors, and validation.

```typescript
interface DOMQueryOptions {
  readonly timeout?: number;
  readonly retries?: number;
  readonly fallbackSelectors?: string[];
  readonly validateElement?: (element: Element) => boolean;
}

// Basic usage
const videoElement = await safeQuerySelector<HTMLVideoElement>('video');

// With fallback selectors and validation
const videoElement = await safeQuerySelector<HTMLVideoElement>('video[src*="youtube"]', {
  retries: 5,
  fallbackSelectors: ['video', 'iframe[src*="youtube"]'],
  validateElement: (el) => el instanceof HTMLVideoElement && el.duration > 0,
});
```

#### `waitForElement<T>(selector: string, options?: DOMQueryOptions): Promise<T | null>`

Wait for an element to appear in the DOM with MutationObserver.

```typescript
// Wait for YouTube player to load
const player = await waitForElement<HTMLVideoElement>('video', {
  timeout: 10000,
  validateElement: (el) => el instanceof HTMLVideoElement && !isNaN(el.duration),
});

// With abort signal
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // Cancel after 5s

const element = await waitForElement('video', {
  signal: controller.signal,
}).catch((error) => {
  console.log('Operation was aborted');
});
```

#### `isElementValid(element: unknown): element is Element`

Type guard to check if an element is valid and connected to DOM.

```typescript
const maybeElement = document.querySelector('video');
if (isElementValid(maybeElement)) {
  // TypeScript now knows maybeElement is Element
  console.log(maybeElement.tagName);
}
```

#### `isValidVideoElement(element: unknown): element is HTMLVideoElement`

Type guard specifically for HTMLVideoElement with functionality checks.

```typescript
const element = document.querySelector('video');
if (isValidVideoElement(element)) {
  // TypeScript knows element is HTMLVideoElement
  await element.play();
  console.log('Duration:', element.duration);
}
```

### Event Utilities

#### `throttle<T>(func: T, delay: number, options?: ThrottleOptions): T & { cancel, flush }`

Throttle function execution to limit call frequency.

```typescript
interface ThrottleOptions {
  readonly leading?: boolean; // Call immediately on first invoke
  readonly trailing?: boolean; // Call after delay when calls stop
}

// Basic throttling for scroll events
const throttledScroll = throttle(() => {
  console.log('Scroll event');
}, 100);

window.addEventListener('scroll', throttledScroll);

// Advanced usage
const throttledUpdate = throttle((data: string) => updateUI(data), 250, {
  leading: true,
  trailing: false,
});

// Cancel pending calls
throttledUpdate.cancel();

// Force immediate execution of pending call
throttledUpdate.flush();
```

#### `debounce<T>(func: T, delay: number, options?: DebounceOptions): T & { cancel, flush }`

Debounce function execution to delay calls until after delay period.

```typescript
interface DebounceOptions {
  readonly immediate?: boolean; // Call immediately on first invoke
}

// Basic debouncing for search input
const debouncedSearch = debounce((query: string) => {
  performSearch(query);
}, 300);

// Immediate execution, then debounce subsequent calls
const debouncedSave = debounce(() => saveData(), 1000, { immediate: true });

// Control methods
debouncedSearch.cancel(); // Cancel pending execution
debouncedSearch.flush(); // Execute immediately
```

### Async Utilities

#### `delay(ms: number): Promise<void>`

Simple promise-based delay utility.

```typescript
// Wait 1 second
await delay(1000);

// Use in sequences
await delay(500);
console.log('After 500ms');
await delay(1000);
console.log('After another 1000ms');
```

#### `withTimeout<T>(promise: Promise<T>, options: TimeoutOptions): Promise<T>`

Add timeout capability to any promise.

```typescript
interface TimeoutOptions {
  readonly timeoutMs: number;
  readonly timeoutMessage?: string;
}

// Timeout a fetch request
try {
  const response = await withTimeout(fetch('/api/data'), {
    timeoutMs: 5000,
    timeoutMessage: 'API request timed out',
  });
} catch (error) {
  console.error(error.message); // "API request timed out"
}

// Timeout DOM operations
const element = await withTimeout(waitForElement('video'), { timeoutMs: 10000 });
```

#### `retry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T>`

Retry operations with exponential backoff and jitter.

```typescript
interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelay: number;
  readonly maxDelay?: number;
  readonly exponentialBackoff?: boolean;
  readonly jitter?: boolean;
}

// Retry API call
const data = await retry(() => fetch('/api/unstable-endpoint').then((r) => r.json()), {
  maxAttempts: 3,
  baseDelay: 1000,
  exponentialBackoff: true,
  jitter: true,
});

// Retry with linear backoff
const result = await retry(() => performUnreliableOperation(), {
  maxAttempts: 5,
  baseDelay: 500,
  exponentialBackoff: false,
});
```

### Validation Utilities

#### `validateNumber(value: unknown, name: string, options?): ValidationResult<number>`

Comprehensive number validation with constraints.

```typescript
const result = validateNumber(userInput, 'volume', {
  min: 0,
  max: 1,
  finite: true,
});

if (result.isValid) {
  setVolume(result.value!);
} else {
  showError(result.error);
}

// Integer validation
const idResult = validateNumber(input, 'userId', {
  min: 1,
  integer: true,
});
```

#### `validateString(value: unknown, name: string, options?): ValidationResult<string>`

String validation with length and pattern constraints.

```typescript
const urlResult = validateString(input, 'videoUrl', {
  nonEmpty: true,
  pattern: /^https:\/\/www\.youtube\.com\/watch\?v=/,
  maxLength: 500,
});

const nameResult = validateString(input, 'title', {
  minLength: 1,
  maxLength: 100,
  nonEmpty: true,
});
```

### String Utilities

#### `sanitizeString(input: string): string`

Sanitize string for safe HTML display.

```typescript
const userInput = '<script>alert("xss")</script>';
const safe = sanitizeString(userInput);
console.log(safe); // "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
```

#### `truncateString(str: string, maxLength: number, ellipsis?: string): string`

Truncate string with customizable ellipsis.

```typescript
truncateString('Very long video title here', 20); // "Very long video ..."
truncateString('Short title', 20); // "Short title"
truncateString('Custom ellipsis example', 15, ' [more]'); // "Custom el [more]"
```

#### `safeJsonParse<T>(json: string): SafeParseResult<T>`

Safe JSON parsing with error handling.

```typescript
const result = safeJsonParse<{ title: string }>('{"title":"Video"}');
if (result.success) {
  console.log(result.data!.title); // "Video"
} else {
  console.error('Parse error:', result.error);
}

// Invalid JSON
const badResult = safeJsonParse('invalid json');
console.log(badResult.success); // false
console.log(badResult.error); // "Unexpected token i in JSON at position 0"
```

### Object Utilities

#### `deepClone<T>(obj: T): T`

Deep clone objects using JSON methods (for serializable objects).

```typescript
const original = {
  settings: { volume: 0.8, autoplay: true },
  history: [1, 2, 3],
};

const cloned = deepClone(original);
cloned.settings.volume = 0.5; // Original unchanged
console.log(original.settings.volume); // 0.8
```

#### `isEmpty(obj: unknown): boolean`

Check if various types are empty.

```typescript
isEmpty(null); // true
isEmpty(undefined); // true
isEmpty([]); // true
isEmpty({}); // true
isEmpty(''); // true
isEmpty('  '); // true
isEmpty([1, 2, 3]); // false
isEmpty({ key: 'val' }); // false
```

#### `mergeObjects<T>(target: T, source: Partial<T>): T`

Type-safe object merging.

```typescript
const defaults = {
  volume: 1.0,
  autoplay: false,
  quality: 'auto' as const,
};

const userSettings = {
  volume: 0.7,
  autoplay: true,
};

const merged = mergeObjects(defaults, userSettings);
// Result: { volume: 0.7, autoplay: true, quality: 'auto' }
```

## Integration with PlayerInteractionService

These utilities are designed to integrate seamlessly with the existing PlayerInteractionService:

```typescript
import {
  validateNumber,
  clamp,
  isValidVideoElement,
  debounce,
  withTimeout,
  formatTime
} from './utilities';

// Enhanced validation in PlayerInteractionService
private enhancedValidateTimeValue(timeInSeconds: number): void {
  const result = validateNumber(timeInSeconds, 'timeInSeconds', {
    min: 0,
    finite: true
  });

  if (!result.isValid) {
    throw new ValidationError('timeInSeconds', timeInSeconds, result.error!);
  }

  const duration = this.getDuration();
  if (duration > 0) {
    const clampedTime = clamp(timeInSeconds, { min: 0, max: duration });
    if (clampedTime !== timeInSeconds) {
      console.warn(`[PlayerInteractionService] Time ${timeInSeconds}s clamped to ${clampedTime}s`);
    }
  }
}

// Enhanced element validation
private enhancedIsValidVideoElement(element: unknown): element is HTMLVideoElement {
  return isValidVideoElement(element) &&
         element.readyState >= HTMLMediaElement.HAVE_METADATA;
}

// Debounced state updates
private debouncedStateUpdate = debounce(() => {
  this.updatePlayerState('debounced_update');
}, 100);

// Timeout-protected operations
public async safePlay(): Promise<void> {
  this.ensureVideoElementReady();

  try {
    await withTimeout(
      this.videoElement!.play(),
      { timeoutMs: 5000, timeoutMessage: 'Play operation timed out' }
    );
  } catch (error) {
    this.notifyError(PlayerErrorCode.PLAYBACK_FAILED, error.message);
    throw error;
  }
}

// Human-readable time formatting for UI
public getCurrentTimeFormatted(): string {
  const currentTime = this.getCurrentTime();
  return formatTime(currentTime, { format: 'human' });
}
```

## Error Handling

All utilities include comprehensive error handling:

1. **Type Validation**: Parameters are validated at runtime
2. **Boundary Checking**: Numeric values are checked against valid ranges
3. **Graceful Degradation**: Functions provide fallback behavior when possible
4. **Detailed Error Messages**: Errors include context and suggested fixes
5. **TypeScript Safety**: Full type safety with proper type guards

## Performance Considerations

- **Throttling/Debouncing**: Includes cancel and flush methods for fine control
- **DOM Operations**: Includes timeout and retry mechanisms
- **Memory Management**: Proper cleanup of timers and observers
- **Caching**: Where appropriate (e.g., in DOM utilities)
- **Minimal Overhead**: Functions are optimized for frequent use

## Testing Edge Cases

All utilities are designed to handle edge cases commonly found in YouTube's environment:

- **Dynamic DOM**: Elements that appear/disappear during SPA navigation
- **Rapid Events**: High-frequency events that need throttling
- **Network Issues**: Timeouts and retry logic for unreliable operations
- **Invalid Data**: Robust validation for user input and API responses
- **Browser Compatibility**: Graceful degradation for unsupported features

## Contributing

When adding new utilities:

1. Include comprehensive TypeScript typing
2. Add proper error handling and validation
3. Provide usage examples in documentation
4. Consider edge cases specific to YouTube's environment
5. Include JSDoc comments for all public functions
6. Follow existing naming conventions and patterns
