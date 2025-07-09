/**
 * LinguaTube Subtitle Segment Merger
 * Handles merging of subtitle segments based on timing, speakers, and content analysis
 */

import {
  SubtitleSegment,
  SubtitleFile,
  MergeConfig,
  SubtitleSegmentMetadata,
  SubtitleStyling
} from './types';

/**
 * Merge operation result
 */
export interface MergeResult {
  readonly success: boolean;
  readonly originalCount: number;
  readonly mergedCount: number;
  readonly segments: SubtitleSegment[];
  readonly operations: MergeOperation[];
  readonly warnings: MergeWarning[];
}

/**
 * Individual merge operation record
 */
export interface MergeOperation {
  readonly type: 'merge' | 'split' | 'skip';
  readonly sourceSegments: string[]; // segment IDs
  readonly resultSegment?: string; // merged segment ID
  readonly reason: string;
  readonly timeSaved?: number; // gap eliminated in seconds
}

/**
 * Merge warning
 */
export interface MergeWarning {
  readonly code: string;
  readonly message: string;
  readonly segmentIds: string[];
  readonly severity: 'info' | 'warning' | 'error';
}

/**
 * Default merge configuration
 */
export const DEFAULT_MERGE_CONFIG: MergeConfig = {
  maxGap: 2.0, // 2 seconds
  minDuration: 0.5, // 0.5 seconds
  maxDuration: 10.0, // 10 seconds
  preserveSpeakers: true,
  mergeStrategy: 'time'
};

/**
 * Segment merger implementation
 */
export class SegmentMerger {
  private readonly config: MergeConfig;

  constructor(config: Partial<MergeConfig> = {}) {
    this.config = { ...DEFAULT_MERGE_CONFIG, ...config };
  }

  // ========================================
  // Main Merge Operations
  // ========================================

  /**
   * Merge segments in a subtitle file
   */
  async mergeFile(subtitleFile: SubtitleFile): Promise<MergeResult> {
    const startTime = Date.now();
    console.log(`[LinguaTube] Starting segment merge for ${subtitleFile.segments.length} segments`);

    const result = await this.mergeSegments(subtitleFile.segments);

    const processingTime = Date.now() - startTime;
    console.log(`[LinguaTube] Merge completed: ${result.originalCount} → ${result.mergedCount} segments (${processingTime}ms)`);

    return result;
  }

  /**
   * Merge a list of subtitle segments
   */
  async mergeSegments(segments: SubtitleSegment[]): Promise<MergeResult> {
    const operations: MergeOperation[] = [];
    const warnings: MergeWarning[] = [];
    const originalCount = segments.length;

    if (segments.length === 0) {
      return {
        success: true,
        originalCount: 0,
        mergedCount: 0,
        segments: [],
        operations: [],
        warnings: []
      };
    }

    // Sort segments by start time
    const sortedSegments = [...segments].sort((a, b) => a.startTime - b.startTime);

    // Apply merge strategy
    let mergedSegments: SubtitleSegment[];
    
    switch (this.config.mergeStrategy) {
      case 'time':
        mergedSegments = await this.mergeByTime(sortedSegments, operations, warnings);
        break;
      case 'speaker':
        mergedSegments = await this.mergeBySpeaker(sortedSegments, operations, warnings);
        break;
      case 'content':
        mergedSegments = await this.mergeByContent(sortedSegments, operations, warnings);
        break;
      default:
        mergedSegments = await this.mergeByTime(sortedSegments, operations, warnings);
    }

    // Post-processing cleanup
    mergedSegments = await this.postProcessSegments(mergedSegments, operations, warnings);

    return {
      success: true,
      originalCount,
      mergedCount: mergedSegments.length,
      segments: mergedSegments,
      operations,
      warnings
    };
  }

  // ========================================
  // Merge Strategy Implementations
  // ========================================

  /**
   * Merge segments based on time gaps
   */
  private async mergeByTime(
    segments: SubtitleSegment[],
    operations: MergeOperation[],
    warnings: MergeWarning[]
  ): Promise<SubtitleSegment[]> {
    const merged: SubtitleSegment[] = [];
    let currentSegment: SubtitleSegment | null = null;

    for (const segment of segments) {
      if (!currentSegment) {
        currentSegment = { ...segment };
        continue;
      }

      const gap = segment.startTime - currentSegment.endTime;
      const canMerge = this.canMergeByTime(currentSegment, segment, gap);

      if (canMerge) {
        // Merge segments
        const mergedSegment = await this.combineSegments(currentSegment, segment);
        
        operations.push({
          type: 'merge',
          sourceSegments: [currentSegment.id, segment.id],
          resultSegment: mergedSegment.id,
          reason: `Time gap of ${gap.toFixed(2)}s within threshold`,
          timeSaved: gap
        });

        currentSegment = mergedSegment;
      } else {
        // Push current segment and start new one
        merged.push(currentSegment);
        currentSegment = { ...segment };

        if (gap > this.config.maxGap) {
          operations.push({
            type: 'skip',
            sourceSegments: [segment.id],
            reason: `Gap ${gap.toFixed(2)}s exceeds threshold ${this.config.maxGap}s`
          });
        }
      }
    }

    // Don't forget the last segment
    if (currentSegment) {
      merged.push(currentSegment);
    }

    return merged;
  }

  /**
   * Merge segments based on speaker context
   */
  private async mergeBySpeaker(
    segments: SubtitleSegment[],
    operations: MergeOperation[],
    warnings: MergeWarning[]
  ): Promise<SubtitleSegment[]> {
    if (!this.config.preserveSpeakers) {
      // Fall back to time-based merging
      return this.mergeByTime(segments, operations, warnings);
    }

    const merged: SubtitleSegment[] = [];
    let currentGroup: SubtitleSegment[] = [];
    let currentSpeaker: string | null = null;

    for (const segment of segments) {
      const segmentSpeaker = segment.metadata?.speaker || null;
      
      // Check if we should start a new speaker group
      if (currentSpeaker !== segmentSpeaker || currentGroup.length === 0) {
        // Process current group
        if (currentGroup.length > 0) {
          const groupResult = await this.mergeSegmentGroup(currentGroup, operations, warnings);
          merged.push(...groupResult);
        }

        // Start new group
        currentGroup = [segment];
        currentSpeaker = segmentSpeaker;
      } else {
        // Same speaker - check if we can merge by time
        const lastSegment = currentGroup[currentGroup.length - 1];
        const gap = segment.startTime - lastSegment.endTime;

        if (gap <= this.config.maxGap) {
          currentGroup.push(segment);
        } else {
          // Gap too large, process current group and start new one
          const groupResult = await this.mergeSegmentGroup(currentGroup, operations, warnings);
          merged.push(...groupResult);
          currentGroup = [segment];
        }
      }
    }

    // Process final group
    if (currentGroup.length > 0) {
      const groupResult = await this.mergeSegmentGroup(currentGroup, operations, warnings);
      merged.push(...groupResult);
    }

    return merged;
  }

  /**
   * Merge segments based on content analysis
   */
  private async mergeByContent(
    segments: SubtitleSegment[],
    operations: MergeOperation[],
    warnings: MergeWarning[]
  ): Promise<SubtitleSegment[]> {
    const merged: SubtitleSegment[] = [];
    let currentSegment: SubtitleSegment | null = null;

    for (const segment of segments) {
      if (!currentSegment) {
        currentSegment = { ...segment };
        continue;
      }

      const canMerge = this.canMergeByContent(currentSegment, segment);
      
      if (canMerge) {
        const mergedSegment = await this.combineSegments(currentSegment, segment);
        
        operations.push({
          type: 'merge',
          sourceSegments: [currentSegment.id, segment.id],
          resultSegment: mergedSegment.id,
          reason: 'Content analysis suggests segments should be combined'
        });

        currentSegment = mergedSegment;
      } else {
        merged.push(currentSegment);
        currentSegment = { ...segment };
      }
    }

    if (currentSegment) {
      merged.push(currentSegment);
    }

    return merged;
  }

  // ========================================
  // Merge Decision Logic
  // ========================================

  /**
   * Check if segments can be merged based on timing
   */
  private canMergeByTime(segment1: SubtitleSegment, segment2: SubtitleSegment, gap: number): boolean {
    // Basic gap check
    if (gap > this.config.maxGap) {
      return false;
    }

    // Check if merged duration would be acceptable
    const mergedDuration = segment2.endTime - segment1.startTime;
    if (mergedDuration > this.config.maxDuration) {
      return false;
    }

    // Check minimum duration
    const segment1Duration = segment1.endTime - segment1.startTime;
    const segment2Duration = segment2.endTime - segment2.startTime;
    
    if (segment1Duration < this.config.minDuration || segment2Duration < this.config.minDuration) {
      return true; // Merge short segments
    }

    // Check speaker consistency if enabled
    if (this.config.preserveSpeakers) {
      const speaker1 = segment1.metadata?.speaker;
      const speaker2 = segment2.metadata?.speaker;
      
      if (speaker1 && speaker2 && speaker1 !== speaker2) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if segments can be merged based on content
   */
  private canMergeByContent(segment1: SubtitleSegment, segment2: SubtitleSegment): boolean {
    const text1 = segment1.text.trim();
    const text2 = segment2.text.trim();

    // Don't merge if either segment is empty
    if (!text1 || !text2) {
      return false;
    }

    // Check for sentence continuity
    if (this.isSentenceContinuation(text1, text2)) {
      return true;
    }

    // Check for incomplete words or phrases
    if (this.isIncompletePhrase(text1) || this.isIncompletePhrase(text2)) {
      return true;
    }

    // Check timing constraints
    const gap = segment2.startTime - segment1.endTime;
    return gap <= this.config.maxGap;
  }

  /**
   * Check if second text continues the first sentence
   */
  private isSentenceContinuation(text1: string, text2: string): boolean {
    // Check if first text doesn't end with sentence-ending punctuation
    const sentenceEnders = /[.!?]$/;
    if (sentenceEnders.test(text1.trim())) {
      return false;
    }

    // Check if second text starts with lowercase (continuation)
    const firstChar = text2.trim().charAt(0);
    return firstChar === firstChar.toLowerCase() && /[a-z]/.test(firstChar);
  }

  /**
   * Check if text appears to be an incomplete phrase
   */
  private isIncompletePhrase(text: string): boolean {
    const trimmed = text.trim();
    
    // Very short segments are likely incomplete
    if (trimmed.length < 3) {
      return true;
    }

    // Ends with comma, suggesting continuation
    if (trimmed.endsWith(',')) {
      return true;
    }

    // Starts with conjunction or preposition
    const continuationWords = /^(and|but|or|so|then|also|however|therefore|because|since|when|while|if|as|like|than)\s+/i;
    if (continuationWords.test(trimmed)) {
      return true;
    }

    return false;
  }

  // ========================================
  // Segment Combination Logic
  // ========================================

  /**
   * Combine two segments into one
   */
  private async combineSegments(segment1: SubtitleSegment, segment2: SubtitleSegment): Promise<SubtitleSegment> {
    // Combine text with appropriate spacing
    const combinedText = this.combineText(segment1.text, segment2.text);
    
    // Merge timing
    const startTime = Math.min(segment1.startTime, segment2.startTime);
    const endTime = Math.max(segment1.endTime, segment2.endTime);
    
    // Merge metadata
    const mergedMetadata = this.mergeMetadata(segment1.metadata, segment2.metadata);
    
    // Merge styling (prefer first segment's styling)
    const mergedStyling = this.mergeStyling(segment1.styling, segment2.styling);
    
    // Create new segment
    return {
      id: this.generateMergedId(segment1.id, segment2.id),
      startTime,
      endTime,
      text: combinedText,
      originalText: this.combineOriginalText(segment1.originalText, segment2.originalText),
      styling: mergedStyling,
      position: segment1.position, // Use first segment's position
      metadata: mergedMetadata
    };
  }

  /**
   * Merge group of segments
   */
  private async mergeSegmentGroup(
    segments: SubtitleSegment[],
    operations: MergeOperation[],
    warnings: MergeWarning[]
  ): Promise<SubtitleSegment[]> {
    if (segments.length <= 1) {
      return segments;
    }

    // Apply time-based merging within the group
    return this.mergeByTime(segments, operations, warnings);
  }

  /**
   * Combine text from two segments
   */
  private combineText(text1: string, text2: string): string {
    const trimmed1 = text1.trim();
    const trimmed2 = text2.trim();
    
    if (!trimmed1) return trimmed2;
    if (!trimmed2) return trimmed1;
    
    // Determine appropriate spacing
    const needsSpace = !trimmed1.endsWith(' ') && !trimmed2.startsWith(' ') && 
                      !/[.!?]$/.test(trimmed1) && !/^[,;:]/.test(trimmed2);
    
    return needsSpace ? `${trimmed1} ${trimmed2}` : `${trimmed1}${trimmed2}`;
  }

  /**
   * Combine original text if available
   */
  private combineOriginalText(original1?: string, original2?: string): string | undefined {
    if (!original1 && !original2) return undefined;
    if (!original1) return original2;
    if (!original2) return original1;
    
    return this.combineText(original1, original2);
  }

  /**
   * Merge metadata from two segments
   */
  private mergeMetadata(
    metadata1?: SubtitleSegmentMetadata,
    metadata2?: SubtitleSegmentMetadata
  ): SubtitleSegmentMetadata | undefined {
    if (!metadata1 && !metadata2) return undefined;
    if (!metadata1) return metadata2;
    if (!metadata2) return metadata1;

    return {
      speaker: metadata1.speaker || metadata2.speaker,
      language: metadata1.language || metadata2.language,
      confidence: Math.min(metadata1.confidence || 1, metadata2.confidence || 1),
      region: metadata1.region || metadata2.region,
      notes: [...(metadata1.notes || []), ...(metadata2.notes || [])],
      tags: [...new Set([...(metadata1.tags || []), ...(metadata2.tags || [])])]
    };
  }

  /**
   * Merge styling from two segments
   */
  private mergeStyling(
    styling1?: SubtitleStyling,
    styling2?: SubtitleStyling
  ): SubtitleStyling | undefined {
    if (!styling1 && !styling2) return undefined;
    if (!styling1) return styling2;
    if (!styling2) return styling1;

    // Prefer first segment's styling, but merge compatible properties
    return {
      ...styling1,
      // Only merge if both have the same value
      bold: styling1.bold === styling2.bold ? styling1.bold : undefined,
      italic: styling1.italic === styling2.italic ? styling1.italic : undefined,
      underline: styling1.underline === styling2.underline ? styling1.underline : undefined
    };
  }

  /**
   * Generate ID for merged segment
   */
  private generateMergedId(id1: string, id2: string): string {
    return `${id1}_${id2}_merged`;
  }

  // ========================================
  // Post-Processing
  // ========================================

  /**
   * Post-process merged segments
   */
  private async postProcessSegments(
    segments: SubtitleSegment[],
    operations: MergeOperation[],
    warnings: MergeWarning[]
  ): Promise<SubtitleSegment[]> {
    const processed: SubtitleSegment[] = [];

    for (const segment of segments) {
      // Check for issues
      const segmentWarnings = this.validateSegment(segment);
      warnings.push(...segmentWarnings);

      // Clean up text
      const cleanedSegment = this.cleanSegmentText(segment);
      processed.push(cleanedSegment);
    }

    return processed;
  }

  /**
   * Validate merged segment
   */
  private validateSegment(segment: SubtitleSegment): MergeWarning[] {
    const warnings: MergeWarning[] = [];

    // Check duration
    const duration = segment.endTime - segment.startTime;
    if (duration > this.config.maxDuration) {
      warnings.push({
        code: 'DURATION_TOO_LONG',
        message: `Segment duration ${duration.toFixed(2)}s exceeds maximum ${this.config.maxDuration}s`,
        segmentIds: [segment.id],
        severity: 'warning'
      });
    }

    if (duration < this.config.minDuration) {
      warnings.push({
        code: 'DURATION_TOO_SHORT',
        message: `Segment duration ${duration.toFixed(2)}s below minimum ${this.config.minDuration}s`,
        segmentIds: [segment.id],
        severity: 'info'
      });
    }

    // Check text length
    if (segment.text.length > 200) {
      warnings.push({
        code: 'TEXT_TOO_LONG',
        message: `Segment text length ${segment.text.length} characters may be too long for display`,
        segmentIds: [segment.id],
        severity: 'warning'
      });
    }

    return warnings;
  }

  /**
   * Clean segment text
   */
  private cleanSegmentText(segment: SubtitleSegment): SubtitleSegment {
    const cleanedText = segment.text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    return {
      ...segment,
      text: cleanedText
    };
  }

  // ========================================
  // Utility Methods
  // ========================================

  /**
   * Get merge configuration
   */
  getConfig(): MergeConfig {
    return { ...this.config };
  }

  /**
   * Create new merger with updated configuration
   */
  withConfig(config: Partial<MergeConfig>): SegmentMerger {
    return new SegmentMerger({ ...this.config, ...config });
  }

  /**
   * Calculate potential savings from merging
   */
  calculateMergePotential(segments: SubtitleSegment[]): {
    mergeable: number;
    timeGaps: number;
    estimatedReduction: number;
  } {
    let mergeable = 0;
    let totalTimeGaps = 0;

    for (let i = 0; i < segments.length - 1; i++) {
      const current = segments[i];
      const next = segments[i + 1];
      const gap = next.startTime - current.endTime;

      if (this.canMergeByTime(current, next, gap)) {
        mergeable++;
        totalTimeGaps += gap;
      }
    }

    const estimatedReduction = Math.max(0, mergeable / segments.length);

    return {
      mergeable,
      timeGaps: totalTimeGaps,
      estimatedReduction
    };
  }
}

// ========================================
// Factory Functions and Utilities
// ========================================

/**
 * Create segment merger with default configuration
 */
export function createSegmentMerger(config?: Partial<MergeConfig>): SegmentMerger {
  return new SegmentMerger(config);
}

/**
 * Create merger optimized for time-based merging
 */
export function createTimeMerger(): SegmentMerger {
  return new SegmentMerger({
    maxGap: 1.5,
    minDuration: 0.3,
    maxDuration: 8.0,
    mergeStrategy: 'time',
    preserveSpeakers: false
  });
}

/**
 * Create merger optimized for speaker preservation
 */
export function createSpeakerMerger(): SegmentMerger {
  return new SegmentMerger({
    maxGap: 3.0,
    minDuration: 0.5,
    maxDuration: 12.0,
    mergeStrategy: 'speaker',
    preserveSpeakers: true
  });
}

/**
 * Create merger optimized for content analysis
 */
export function createContentMerger(): SegmentMerger {
  return new SegmentMerger({
    maxGap: 2.5,
    minDuration: 0.4,
    maxDuration: 10.0,
    mergeStrategy: 'content',
    preserveSpeakers: true
  });
}

/**
 * Quick merge function for simple use cases
 */
export async function mergeSubtitleSegments(
  segments: SubtitleSegment[],
  config?: Partial<MergeConfig>
): Promise<SubtitleSegment[]> {
  const merger = createSegmentMerger(config);
  const result = await merger.mergeSegments(segments);
  return result.segments;
}

/**
 * Default segment merger instance
 */
export const segmentMerger = createSegmentMerger(); 