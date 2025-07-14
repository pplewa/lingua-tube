/**
 * LinguaTube Multi-Format Subtitle Parser
 * Handles parsing of multiple subtitle formats with automatic format detection
 */

import {
  SubtitleSegment,
  SubtitleFormat,
  ParseResult,
  ParseError,
  ParserConfig,
  DEFAULT_PARSER_CONFIG,
} from './types';
import { YouTubeXMLParser } from './XmlParser';
import { Logger } from '../logging/Logger';
import { ComponentType } from '../logging/types';

/**
 * VTT Cue data structure
 */
interface VTTCue {
  readonly id?: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
  readonly settings?: string;
}

/**
 * SRT Entry data structure
 */
interface SRTEntry {
  readonly index: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly text: string;
}

/**
 * Multi-format subtitle parser with automatic format detection
 */
export class MultiFormatSubtitleParser {
  // ========================================
  // Main Parsing Interface
  // ========================================

  /**
   * Parse subtitle content with automatic format detection
   */
  static parse(
    content: string,
    config: Partial<ParserConfig> = DEFAULT_PARSER_CONFIG,
  ): ParseResult {
    const logger = Logger.getInstance();
    const startTime = performance.now();

    try {
      logger?.info('Starting multi-format subtitle parsing', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          contentLength: content.length,
          encoding: config.encoding,
          strict: config.strict,
          mergeSegments: config.mergeSegments,
        },
      });

      // Validate input
      if (!content || typeof content !== 'string') {
        return this.createErrorResult([
          {
            message: 'Empty or invalid subtitle content',
            code: 'EMPTY_CONTENT',
            severity: 'error',
          },
        ]);
      }

      // Detect format
      const format = this.detectFormat(content);
      logger?.info('Detected subtitle format', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          format,
          contentLength: content.length,
        },
      });

      // Build complete parser config
      const fullConfig: ParserConfig = {
        format,
        encoding: config.encoding || 'utf-8',
        strict: config.strict || false,
        mergeSegments: config.mergeSegments || false,
        maxSegmentGap: config.maxSegmentGap || 2.0,
        preserveFormatting: config.preserveFormatting || true,
      };

      // Parse based on detected format
      let result: ParseResult;

      switch (format) {
        case SubtitleFormat.VTT:
        case SubtitleFormat.WEBVTT:
          result = this.parseVTT(content, fullConfig);
          break;

        case SubtitleFormat.SRT:
          result = this.parseSRT(content, fullConfig);
          break;

        case SubtitleFormat.YOUTUBE_XML:
        case SubtitleFormat.YOUTUBE_SRV1:
        case SubtitleFormat.YOUTUBE_SRV2:
        case SubtitleFormat.YOUTUBE_SRV3:
        case SubtitleFormat.TTML:
          result = YouTubeXMLParser.parseXML(content, fullConfig);
          break;

        default:
          result = this.parseGenericText(content, fullConfig);
      }

      const parseTime = performance.now() - startTime;
      logger?.info('Multi-format parsing completed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          parseTime: parseTime.toFixed(2),
          format,
          success: result.success,
          segmentCount: result.success ? result.segments?.length || 0 : 0,
          errorCount: result.errors?.length || 0,
        },
      });

      // Add format information to result
      if (result.success && result.metadata) {
        const updatedMetadata = { ...result.metadata, detectedFormat: format };
        result = { ...result, metadata: updatedMetadata };
      }

      return result;
    } catch (error) {
      logger?.error('Multi-format parsing failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          contentLength: content.length,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      return this.createErrorResult([
        {
          message: error instanceof Error ? error.message : 'Unknown parsing error',
          code: 'PARSE_ERROR',
          severity: 'error',
        },
      ]);
    }
  }

  // ========================================
  // Format Detection
  // ========================================

  /**
   * Detect subtitle format from content
   */
  private static detectFormat(content: string): SubtitleFormat {
    const cleaned = content.trim().toLowerCase();

    // VTT/WebVTT Detection
    if (cleaned.startsWith('webvtt') || cleaned.includes('webvtt')) {
      return SubtitleFormat.WEBVTT;
    }

    if (
      (cleaned.includes('-->') && cleaned.includes('note:')) ||
      (cleaned.includes('-->') && cleaned.includes('cue'))
    ) {
      return SubtitleFormat.VTT;
    }

    // SRT Detection
    if (this.isSRTFormat(cleaned)) {
      return SubtitleFormat.SRT;
    }

    // XML-based formats
    if (cleaned.includes('<?xml') || cleaned.includes('<transcript>')) {
      // Delegate to XML parser for specific XML format detection
      if (cleaned.includes('<transcript>') || cleaned.includes('<text ')) {
        return SubtitleFormat.YOUTUBE_XML;
      }

      if (cleaned.includes('srv1')) {
        return SubtitleFormat.YOUTUBE_SRV1;
      }

      if (cleaned.includes('srv2')) {
        return SubtitleFormat.YOUTUBE_SRV2;
      }

      if (cleaned.includes('srv3')) {
        return SubtitleFormat.YOUTUBE_SRV3;
      }

      if (cleaned.includes('tt:') || cleaned.includes('<tt ') || cleaned.includes('ttml')) {
        return SubtitleFormat.TTML;
      }

      return SubtitleFormat.YOUTUBE_XML; // Default XML
    }

    // If time patterns exist but no specific format detected, try VTT first
    if (cleaned.includes('-->')) {
      return SubtitleFormat.VTT;
    }

    // Default to generic text processing
    return SubtitleFormat.PLAIN_TEXT;
  }

  /**
   * Check if content matches SRT format pattern
   */
  private static isSRTFormat(content: string): boolean {
    // SRT format: number, time range, text, blank line
    const srtPattern = /^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/m;
    return srtPattern.test(content);
  }

  // ========================================
  // VTT/WebVTT Parser
  // ========================================

  /**
   * Parse WebVTT format
   */
  private static parseVTT(content: string, config: ParserConfig): ParseResult {
    const logger = Logger.getInstance();
    const errors: ParseError[] = [];
    const segments: SubtitleSegment[] = [];

    try {
      logger?.info('Parsing VTT/WebVTT format', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          contentLength: content.length,
          preserveFormatting: config.preserveFormatting,
        },
      });

      const lines = content.split(/\r?\n/);
      let currentCue: Partial<VTTCue> = {};
      let cueIndex = 0;
      let lineIndex = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        lineIndex = i + 1;

        // Skip WebVTT header and STYLE/NOTE blocks
        if (
          line.startsWith('WEBVTT') ||
          line.startsWith('STYLE') ||
          line.startsWith('NOTE:') ||
          line.startsWith('REGION:')
        ) {
          continue;
        }

        // Empty line indicates end of cue
        if (line === '') {
          if (this.isValidVTTCue(currentCue)) {
            const segment = this.vttCueToSegment(currentCue as VTTCue, cueIndex);
            if (segment) {
              segments.push(segment);
              cueIndex++;
            }
          }
          currentCue = {};
          continue;
        }

        // Time line (contains -->)
        if (line.includes('-->')) {
          const timeMatch = line.match(/^(?:(\S+)\s+)?(\S+)\s*-->\s*(\S+)(.*)$/);

          if (timeMatch) {
            const [, id, startTime, endTime, settings] = timeMatch;

            try {
              const newCue = {
                id: id || undefined,
                startTime: this.parseVTTTime(startTime),
                endTime: this.parseVTTTime(endTime),
                settings: settings?.trim() || undefined,
                text: currentCue.text || '',
              };
              currentCue = newCue;
            } catch (error) {
              errors.push({
                line: lineIndex,
                message: `Invalid time format: ${line}`,
                code: 'TIME_PARSE_ERROR',
                severity: 'warning',
              });
            }
          } else {
            errors.push({
              line: lineIndex,
              message: `Malformed time line: ${line}`,
              code: 'MALFORMED_TIME',
              severity: 'warning',
            });
          }
        }
        // Text line
        else if (line !== '' && 'startTime' in currentCue) {
          const newCue = {
            ...currentCue,
            text: (currentCue.text || '') + (currentCue.text ? '\n' : '') + line,
          };
          currentCue = newCue;
        }
        // Cue ID line (only if not already set and no time data yet)
        else if (line !== '' && !('startTime' in currentCue)) {
          const newCue = { ...currentCue, id: line };
          currentCue = newCue;
        }
      }

      // Handle last cue if file doesn't end with empty line
      if (this.isValidVTTCue(currentCue)) {
        const segment = this.vttCueToSegment(currentCue as VTTCue, cueIndex);
        if (segment) {
          segments.push(segment);
        }
      }

      logger?.info('VTT parsing completed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          segmentCount: segments.length,
          errorCount: errors.length,
        },
      });

      return {
        success: true,
        segments,
        metadata: {
          segmentCount: segments.length,
          language: 'unknown', // VTT doesn't typically specify language in content
          source: {
            type: 'vtt',
            isAutoGenerated: false,
            fetchedAt: Date.now(),
          },
        },
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      logger?.error('VTT parsing failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          contentLength: content.length,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      errors.push({
        message: `VTT parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'VTT_PARSE_ERROR',
        severity: 'error',
      });

      return this.createErrorResult(errors);
    }
  }

  /**
   * Check if VTT cue is valid
   */
  private static isValidVTTCue(cue: Partial<VTTCue>): cue is VTTCue {
    return (
      typeof cue.startTime === 'number' &&
      typeof cue.endTime === 'number' &&
      typeof cue.text === 'string' &&
      cue.text.trim() !== ''
    );
  }

  /**
   * Convert VTT cue to subtitle segment
   */
  private static vttCueToSegment(cue: VTTCue, index: number): SubtitleSegment | null {
    if (cue.endTime <= cue.startTime) {
      return null;
    }

    return {
      id: cue.id || `vtt_${index.toString().padStart(4, '0')}`,
      startTime: cue.startTime,
      endTime: cue.endTime,
      text: cue.text.trim(),
      styling: this.parseVTTStyling(cue.text),
      position: this.parseVTTPosition(cue.settings),
    };
  }

  /**
   * Parse VTT time format (00:00:00.000 or 00:00.000)
   */
  private static parseVTTTime(timeStr: string): number {
    // Remove any extra spaces and handle malformed input
    timeStr = timeStr.trim();

    // Format: HH:MM:SS.mmm or MM:SS.mmm
    const timeMatch = timeStr.match(/^(?:(\d+):)?(\d+):(\d+)\.(\d+)$/);

    if (timeMatch) {
      const [, hours, minutes, seconds, milliseconds] = timeMatch;

      let totalSeconds = parseInt(seconds);
      totalSeconds += parseInt(minutes) * 60;

      if (hours) {
        totalSeconds += parseInt(hours) * 3600;
      }

      // Convert milliseconds (VTT uses 3 digits)
      totalSeconds += parseInt(milliseconds.padEnd(3, '0')) / 1000;

      return totalSeconds;
    }

    throw new Error(`Invalid VTT time format: ${timeStr}`);
  }

  /**
   * Parse VTT text styling
   */
  private static parseVTTStyling(text: string): any {
    // VTT supports <b>, <i>, <u>, <c.class>, etc.
    // For now, return undefined since we extract the raw text
    // This could be expanded to parse VTT styling tags
    return undefined;
  }

  /**
   * Parse VTT positioning settings
   */
  private static parseVTTPosition(settings?: string): any {
    if (!settings) {
      return undefined;
    }

    // VTT positioning: align:start line:90% position:50%
    // For now, return undefined since this is complex to parse
    // This could be expanded to parse VTT positioning
    return undefined;
  }

  // ========================================
  // SRT Parser
  // ========================================

  /**
   * Parse SRT format
   */
  private static parseSRT(content: string, config: ParserConfig): ParseResult {
    const logger = Logger.getInstance();
    const errors: ParseError[] = [];
    const segments: SubtitleSegment[] = [];

    try {
      logger?.info('Parsing SRT format', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          contentLength: content.length,
          preserveFormatting: config.preserveFormatting,
        },
      });

      // Split into entries (separated by double newlines)
      const entries = content.split(/\r?\n\r?\n/).filter((entry) => entry.trim() !== '');

      for (let i = 0; i < entries.length; i++) {
        try {
          const segment = this.parseSRTEntry(entries[i], i);
          if (segment) {
            segments.push(segment);
          }
        } catch (error) {
          errors.push({
            line: i + 1,
            message: `Error parsing SRT entry ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            code: 'SRT_ENTRY_ERROR',
            severity: 'warning',
          });
        }
      }

      logger?.info('SRT parsing completed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          segmentCount: segments.length,
          errorCount: errors.length,
          entriesProcessed: entries.length,
        },
      });

      return {
        success: true,
        segments,
        metadata: {
          segmentCount: segments.length,
          language: 'unknown',
          source: {
            type: 'srt',
            isAutoGenerated: false,
            fetchedAt: Date.now(),
          },
        },
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      logger?.error('SRT parsing failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          contentLength: content.length,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      errors.push({
        message: `SRT parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'SRT_PARSE_ERROR',
        severity: 'error',
      });

      return this.createErrorResult(errors);
    }
  }

  /**
   * Parse individual SRT entry
   */
  private static parseSRTEntry(entry: string, index: number): SubtitleSegment | null {
    const lines = entry.split(/\r?\n/);

    if (lines.length < 3) {
      return null; // Invalid entry
    }

    // Line 1: Index (optional validation)
    const entryIndex = parseInt(lines[0].trim());

    // Line 2: Time range
    const timeLine = lines[1].trim();
    const timeMatch = timeLine.match(
      /^(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})$/,
    );

    if (!timeMatch) {
      throw new Error(`Invalid SRT time format: ${timeLine}`);
    }

    const [, startTimeStr, endTimeStr] = timeMatch;
    const startTime = this.parseSRTTime(startTimeStr);
    const endTime = this.parseSRTTime(endTimeStr);

    // Lines 3+: Text content
    const text = lines.slice(2).join('\n').trim();

    if (!text) {
      return null; // Empty text
    }

    return {
      id: `srt_${entryIndex.toString().padStart(4, '0')}`,
      startTime,
      endTime,
      text,
      styling: this.parseSRTStyling(text),
    };
  }

  /**
   * Parse SRT time format (HH:MM:SS,mmm)
   */
  private static parseSRTTime(timeStr: string): number {
    const timeMatch = timeStr.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);

    if (!timeMatch) {
      throw new Error(`Invalid SRT time format: ${timeStr}`);
    }

    const [, hours, minutes, seconds, milliseconds] = timeMatch;

    let totalSeconds = parseInt(seconds);
    totalSeconds += parseInt(minutes) * 60;
    totalSeconds += parseInt(hours) * 3600;
    totalSeconds += parseInt(milliseconds) / 1000;

    return totalSeconds;
  }

  /**
   * Parse SRT styling (basic HTML tags)
   */
  private static parseSRTStyling(text: string): any {
    // SRT supports basic HTML tags like <b>, <i>, <u>, <font>
    // For now, return undefined since we extract the raw text
    // This could be expanded to parse SRT styling
    return undefined;
  }

  // ========================================
  // Generic Text Parser
  // ========================================

  /**
   * Parse generic text format (fallback)
   */
  private static parseGenericText(content: string, config: ParserConfig): ParseResult {
    const logger = Logger.getInstance();
    const errors: ParseError[] = [];
    const segments: SubtitleSegment[] = [];

    try {
      logger?.info('Parsing as generic text format', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          contentLength: content.length,
          preserveFormatting: config.preserveFormatting,
        },
      });

      // Split into lines and group into segments
      const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Create a simple segment with estimated timing
        const startTime = i * 3; // 3 seconds per line
        const endTime = startTime + 3;

        segments.push({
          id: `text_${i.toString().padStart(4, '0')}`,
          startTime,
          endTime,
          text: line,
        });
      }

      logger?.info('Generic text parsing completed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          segmentCount: segments.length,
          errorCount: errors.length,
          linesProcessed: lines.length,
        },
      });

      return {
        success: true,
        segments,
        metadata: {
          segmentCount: segments.length,
          language: 'unknown',
          source: {
            type: 'text',
            isAutoGenerated: false,
            fetchedAt: Date.now(),
          },
        },
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      logger?.error('Generic text parsing failed', {
        component: ComponentType.SUBTITLE_MANAGER,
        metadata: {
          contentLength: content.length,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      errors.push({
        message: `Text parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        code: 'TEXT_PARSE_ERROR',
        severity: 'error',
      });

      return this.createErrorResult(errors);
    }
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Create error result
   */
  private static createErrorResult(errors: ParseError[]): ParseResult {
    return {
      success: false,
      errors,
    };
  }

  /**
   * Clean subtitle text (remove HTML tags, normalize whitespace)
   */
  static cleanSubtitleText(text: string): string {
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Validate subtitle segment timing
   */
  static validateTiming(segment: SubtitleSegment): boolean {
    return (
      segment.startTime >= 0 &&
      segment.endTime > segment.startTime &&
      isFinite(segment.startTime) &&
      isFinite(segment.endTime)
    );
  }

  /**
   * Convert time to human readable format
   */
  static formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    } else {
      return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
  }
}
