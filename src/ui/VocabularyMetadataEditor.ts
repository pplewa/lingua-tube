import { VocabularyItem } from '../storage/types';
import { VocabularyManager } from '../vocabulary/VocabularyManager';

// ========================================
// Types and Interfaces
// ========================================

export interface MetadataEditorConfig {
  readonly showTags: boolean;
  readonly showLearningStatus: boolean;
  readonly showNotes: boolean;
  readonly showDifficulty: boolean;
  readonly showFrequency: boolean;
  readonly allowTagCreation: boolean;
  readonly maxNotesLength: number;
  readonly theme: 'light' | 'dark' | 'auto';
}

export interface MetadataEditorEvents {
  onSave: (metadata: Partial<VocabularyItem>) => void;
  onCancel: () => void;
  onChange: (field: string, value: any) => void;
}

export const DEFAULT_METADATA_CONFIG: MetadataEditorConfig = {
  showTags: true,
  showLearningStatus: true,
  showNotes: true,
  showDifficulty: true,
  showFrequency: false, // Read-only, typically
  allowTagCreation: true,
  maxNotesLength: 500,
  theme: 'auto',
};

// ========================================
// Vocabulary Metadata Editor Component
// ========================================

export class VocabularyMetadataEditor {
  private container: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private vocabularyManager: VocabularyManager;
  
  private config: MetadataEditorConfig;
  private events: { [K in keyof MetadataEditorEvents]?: MetadataEditorEvents[K] } = {};
  
  private currentItem: VocabularyItem | null = null;
  private currentMetadata: Partial<VocabularyItem> = {};
  private availableTags: string[] = [];
  private isDirty = false;

  constructor(config: Partial<MetadataEditorConfig> = {}) {
    this.config = { ...DEFAULT_METADATA_CONFIG, ...config };
    this.vocabularyManager = VocabularyManager.getInstance();
  }

  public async initialize(container: HTMLElement): Promise<void> {
    this.container = container;
    this.createShadowDOM();
    await this.loadAvailableTags();
  }

  public async editItem(item: VocabularyItem): Promise<void> {
    this.currentItem = item;
    this.currentMetadata = {
      tags: item.tags || [],
      learningStatus: item.learningStatus,
      difficulty: item.difficulty,
      notes: item.notes,
      frequency: item.frequency,
    };
    this.isDirty = false;
    await this.render();
  }

  public destroy(): void {
    if (this.container && this.shadowRoot) {
      this.container.removeChild(this.shadowRoot.host);
    }
    this.container = null;
    this.shadowRoot = null;
    this.currentItem = null;
  }

  public on<K extends keyof MetadataEditorEvents>(
    event: K,
    callback: MetadataEditorEvents[K]
  ): void {
    this.events[event] = callback;
  }

  public off<K extends keyof MetadataEditorEvents>(event: K): void {
    delete this.events[event];
  }

  // ========================================
  // Private Methods
  // ========================================

  private createShadowDOM(): void {
    if (!this.container) return;

    const wrapper = document.createElement('div');
    this.shadowRoot = wrapper.attachShadow({ mode: 'closed' });
    this.container.appendChild(wrapper);

    // Add styles
    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadowRoot.appendChild(style);

    // Add content container
    const content = document.createElement('div');
    content.className = 'metadata-editor';
    this.shadowRoot.appendChild(content);

    this.attachEventHandlers();
  }

  private async loadAvailableTags(): Promise<void> {
    this.availableTags = await this.vocabularyManager.getAllTags();
  }

  private async render(): Promise<void> {
    if (!this.shadowRoot || !this.currentItem) return;

    const content = this.shadowRoot.querySelector('.metadata-editor');
    if (!content) return;

    content.innerHTML = this.renderEditor();
  }

  private renderEditor(): string {
    if (!this.currentItem) return '<div class="no-item">No item selected</div>';

    return `
      <div class="editor-header">
        <h3>Edit Metadata: ${this.escapeHtml(this.currentItem.word)}</h3>
        <button class="close-button" data-action="cancel">×</button>
      </div>
      
      <div class="editor-content">
        ${this.config.showTags ? this.renderTagsSection() : ''}
        ${this.config.showLearningStatus ? this.renderLearningStatusSection() : ''}
        ${this.config.showDifficulty ? this.renderDifficultySection() : ''}
        ${this.config.showNotes ? this.renderNotesSection() : ''}
        ${this.config.showFrequency ? this.renderFrequencySection() : ''}
      </div>
      
      <div class="editor-footer">
        <button class="action-button secondary" data-action="cancel">Cancel</button>
        <button class="action-button primary" data-action="save" ${!this.isDirty ? 'disabled' : ''}>
          Save Changes
        </button>
      </div>
    `;
  }

  private renderTagsSection(): string {
    const currentTags = this.currentMetadata.tags || [];
    
    return `
      <div class="field-section">
        <label class="field-label">Tags</label>
        <div class="tags-container">
          <div class="current-tags">
            ${currentTags.map(tag => `
              <span class="tag-chip">
                ${this.escapeHtml(tag)}
                <button class="tag-remove" data-action="remove-tag" data-tag="${this.escapeHtml(tag)}">×</button>
              </span>
            `).join('')}
          </div>
          <div class="tag-input-container">
            <input 
              type="text" 
              class="tag-input" 
              placeholder="Add tag..."
              data-field="new-tag"
            >
            <button class="add-tag-button" data-action="add-tag">Add</button>
          </div>
          ${this.availableTags.length > 0 ? `
            <div class="suggested-tags">
              <span class="suggestion-label">Suggestions:</span>
              ${this.availableTags
                .filter(tag => !currentTags.includes(tag))
                .slice(0, 5)
                .map(tag => `
                  <button class="suggestion-tag" data-action="add-suggested-tag" data-tag="${this.escapeHtml(tag)}">
                    ${this.escapeHtml(tag)}
                  </button>
                `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  private renderLearningStatusSection(): string {
    const currentStatus = this.currentMetadata.learningStatus || 'new';
    const statuses = [
      { value: 'new', label: 'New', description: 'Just added to vocabulary' },
      { value: 'learning', label: 'Learning', description: 'Currently studying' },
      { value: 'review', label: 'Review', description: 'Needs periodic review' },
      { value: 'mastered', label: 'Mastered', description: 'Well understood' },
    ];

    return `
      <div class="field-section">
        <label class="field-label">Learning Status</label>
        <div class="status-options">
          ${statuses.map(status => `
            <label class="status-option ${status.value === currentStatus ? 'selected' : ''}">
              <input 
                type="radio" 
                name="learning-status" 
                value="${status.value}"
                ${status.value === currentStatus ? 'checked' : ''}
                data-field="learningStatus"
              >
              <div class="status-content">
                <span class="status-label">${status.label}</span>
                <span class="status-description">${status.description}</span>
              </div>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }

  private renderDifficultySection(): string {
    const currentDifficulty = this.currentMetadata.difficulty || '';
    const difficulties = [
      { value: '', label: 'Not Set' },
      { value: 'easy', label: 'Easy' },
      { value: 'medium', label: 'Medium' },
      { value: 'hard', label: 'Hard' },
    ];

    return `
      <div class="field-section">
        <label class="field-label">Difficulty</label>
        <select class="difficulty-select" data-field="difficulty">
          ${difficulties.map(diff => `
            <option value="${diff.value}" ${diff.value === currentDifficulty ? 'selected' : ''}>
              ${diff.label}
            </option>
          `).join('')}
        </select>
      </div>
    `;
  }

  private renderNotesSection(): string {
    const currentNotes = this.currentMetadata.notes || '';

    return `
      <div class="field-section">
        <label class="field-label">Notes</label>
        <textarea 
          class="notes-textarea" 
          placeholder="Add personal notes, mnemonics, or additional context..."
          maxlength="${this.config.maxNotesLength}"
          data-field="notes"
        >${this.escapeHtml(currentNotes)}</textarea>
        <div class="notes-counter">
          ${currentNotes.length}/${this.config.maxNotesLength} characters
        </div>
      </div>
    `;
  }

  private renderFrequencySection(): string {
    const frequency = this.currentItem?.frequency || 0;

    return `
      <div class="field-section">
        <label class="field-label">Usage Frequency</label>
        <div class="frequency-display">
          <span class="frequency-value">${frequency}</span>
          <span class="frequency-label">times encountered</span>
        </div>
      </div>
    `;
  }

  private attachEventHandlers(): void {
    if (!this.shadowRoot) return;

    // Click handlers
    this.shadowRoot.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const action = target.getAttribute('data-action');

      switch (action) {
        case 'cancel':
          this.handleCancel();
          break;
        case 'save':
          this.handleSave();
          break;
        case 'add-tag':
          this.handleAddTag();
          break;
        case 'remove-tag':
          this.handleRemoveTag(target.getAttribute('data-tag') || '');
          break;
        case 'add-suggested-tag':
          this.handleAddSuggestedTag(target.getAttribute('data-tag') || '');
          break;
      }
    });

    // Input change handlers
    this.shadowRoot.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const field = target.getAttribute('data-field');

      if (field) {
        this.handleFieldChange(field, target.value);
      }
    });

    // Radio button change handlers
    this.shadowRoot.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const field = target.getAttribute('data-field');

      if (field && target.type === 'radio') {
        this.handleFieldChange(field, target.value);
      }
    });

    // Enter key for tag input
    this.shadowRoot.addEventListener('keydown', (e) => {
      const keyboardEvent = e as KeyboardEvent;
      if (keyboardEvent.key === 'Enter') {
        const target = e.target as HTMLElement;
        if (target.classList.contains('tag-input')) {
          e.preventDefault();
          this.handleAddTag();
        }
      }
    });
  }

  private handleCancel(): void {
    this.events.onCancel?.();
  }

  private async handleSave(): Promise<void> {
    if (!this.currentItem || !this.isDirty) return;

    const metadata = this.collectMetadata();
    this.events.onSave?.(metadata);
  }

  private handleFieldChange(field: string, value: string): void {
    this.isDirty = true;
    this.events.onChange?.(field, value);
    
    // Update UI to reflect dirty state
    this.updateSaveButton();
    
    // Update character counter for notes
    if (field === 'notes') {
      this.updateNotesCounter(value);
    }
  }

  private handleAddTag(): void {
    if (!this.shadowRoot) return;

    const input = this.shadowRoot.querySelector('.tag-input') as HTMLInputElement;
    if (!input) return;

    const tag = input.value.trim();
    if (!tag) return;

    const currentTags = this.currentMetadata.tags || [];
    if (currentTags.includes(tag)) {
      input.value = '';
      return;
    }

    // Add tag to metadata
    this.currentMetadata = {
      ...this.currentMetadata,
      tags: [...currentTags, tag],
    };

    this.isDirty = true;
    input.value = '';
    this.render();
  }

  private handleRemoveTag(tag: string): void {
    if (!this.currentItem || !tag) return;

    const currentTags = this.currentMetadata.tags || [];
    const newTags = currentTags.filter(t => t !== tag);

    this.currentMetadata = {
      ...this.currentMetadata,
      tags: newTags,
    };

    this.isDirty = true;
    this.render();
  }

  private handleAddSuggestedTag(tag: string): void {
    if (!this.shadowRoot) return;

    const input = this.shadowRoot.querySelector('.tag-input') as HTMLInputElement;
    if (input) {
      input.value = tag;
      this.handleAddTag();
    }
  }

  private collectMetadata(): Partial<VocabularyItem> {
    if (!this.shadowRoot || !this.currentItem) return {};

    const metadata: Partial<VocabularyItem> = {};

    // Tags
    if (this.config.showTags && this.currentMetadata.tags) {
      Object.assign(metadata, { tags: this.currentMetadata.tags });
    }

    // Learning status
    if (this.config.showLearningStatus) {
      const statusInput = this.shadowRoot.querySelector('input[name="learning-status"]:checked') as HTMLInputElement;
      if (statusInput) {
        Object.assign(metadata, { learningStatus: statusInput.value as VocabularyItem['learningStatus'] });
      }
    }

    // Difficulty
    if (this.config.showDifficulty) {
      const difficultySelect = this.shadowRoot.querySelector('.difficulty-select') as HTMLSelectElement;
      if (difficultySelect && difficultySelect.value) {
        Object.assign(metadata, { difficulty: difficultySelect.value as VocabularyItem['difficulty'] });
      }
    }

    // Notes
    if (this.config.showNotes) {
      const notesTextarea = this.shadowRoot.querySelector('.notes-textarea') as HTMLTextAreaElement;
      if (notesTextarea && notesTextarea.value.trim()) {
        Object.assign(metadata, { notes: notesTextarea.value.trim() });
      }
    }

    return metadata;
  }

  private updateSaveButton(): void {
    if (!this.shadowRoot) return;

    const saveButton = this.shadowRoot.querySelector('[data-action="save"]') as HTMLButtonElement;
    if (saveButton) {
      saveButton.disabled = !this.isDirty;
    }
  }

  private updateNotesCounter(value: string): void {
    if (!this.shadowRoot) return;

    const counter = this.shadowRoot.querySelector('.notes-counter');
    if (counter) {
      counter.textContent = `${value.length}/${this.config.maxNotesLength} characters`;
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private getStyles(): string {
    return `
      .metadata-editor {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        overflow: hidden;
        max-width: 600px;
        margin: 0 auto;
      }

      .editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
      }

      .editor-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #1a202c;
      }

      .close-button {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #718096;
        padding: 0;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
      }

      .close-button:hover {
        background: #e2e8f0;
      }

      .editor-content {
        padding: 20px;
        max-height: 500px;
        overflow-y: auto;
      }

      .field-section {
        margin-bottom: 24px;
      }

      .field-section:last-child {
        margin-bottom: 0;
      }

      .field-label {
        display: block;
        font-weight: 600;
        color: #2d3748;
        margin-bottom: 8px;
        font-size: 14px;
      }

      /* Tags Section */
      .tags-container {
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 12px;
        background: #f7fafc;
      }

      .current-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 12px;
      }

      .tag-chip {
        display: inline-flex;
        align-items: center;
        background: #bee3f8;
        color: #2b6cb0;
        padding: 4px 8px;
        border-radius: 16px;
        font-size: 12px;
        gap: 4px;
      }

      .tag-remove {
        background: none;
        border: none;
        color: #2b6cb0;
        cursor: pointer;
        font-size: 14px;
        padding: 0;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .tag-remove:hover {
        background: rgba(43, 108, 176, 0.2);
      }

      .tag-input-container {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }

      .tag-input {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #cbd5e0;
        border-radius: 6px;
        font-size: 14px;
      }

      .add-tag-button {
        padding: 8px 16px;
        background: #4299e1;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: background-color 0.2s;
      }

      .add-tag-button:hover {
        background: #3182ce;
      }

      .suggested-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }

      .suggestion-label {
        font-size: 12px;
        color: #718096;
        margin-right: 8px;
      }

      .suggestion-tag {
        background: #edf2f7;
        color: #4a5568;
        border: 1px solid #cbd5e0;
        padding: 4px 8px;
        border-radius: 12px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .suggestion-tag:hover {
        background: #e2e8f0;
        border-color: #a0aec0;
      }

      /* Learning Status Section */
      .status-options {
        display: grid;
        gap: 8px;
      }

      .status-option {
        display: flex;
        align-items: center;
        padding: 12px;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .status-option:hover {
        border-color: #cbd5e0;
        background: #f7fafc;
      }

      .status-option.selected {
        border-color: #4299e1;
        background: #ebf8ff;
      }

      .status-option input[type="radio"] {
        margin-right: 12px;
      }

      .status-content {
        display: flex;
        flex-direction: column;
      }

      .status-label {
        font-weight: 600;
        color: #2d3748;
        font-size: 14px;
      }

      .status-description {
        font-size: 12px;
        color: #718096;
        margin-top: 2px;
      }

      /* Difficulty Section */
      .difficulty-select {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #cbd5e0;
        border-radius: 6px;
        font-size: 14px;
        background: white;
      }

      /* Notes Section */
      .notes-textarea {
        width: 100%;
        min-height: 80px;
        padding: 12px;
        border: 1px solid #cbd5e0;
        border-radius: 6px;
        font-size: 14px;
        font-family: inherit;
        resize: vertical;
        box-sizing: border-box;
      }

      .notes-counter {
        text-align: right;
        font-size: 12px;
        color: #718096;
        margin-top: 4px;
      }

      /* Frequency Section */
      .frequency-display {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        background: #f7fafc;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }

      .frequency-value {
        font-size: 24px;
        font-weight: 700;
        color: #2b6cb0;
      }

      .frequency-label {
        color: #718096;
        font-size: 14px;
      }

      /* Footer */
      .editor-footer {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        padding: 20px;
        background: #f8fafc;
        border-top: 1px solid #e2e8f0;
      }

      .action-button {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .action-button.secondary {
        background: #edf2f7;
        color: #4a5568;
      }

      .action-button.secondary:hover {
        background: #e2e8f0;
      }

      .action-button.primary {
        background: #4299e1;
        color: white;
      }

      .action-button.primary:hover:not(:disabled) {
        background: #3182ce;
      }

      .action-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .no-item {
        text-align: center;
        padding: 40px;
        color: #718096;
        font-size: 16px;
      }

      /* Dark theme support */
      @media (prefers-color-scheme: dark) {
        .metadata-editor {
          background: #2d3748;
          color: #e2e8f0;
        }

        .editor-header {
          background: #4a5568;
          border-bottom-color: #718096;
        }

        .editor-header h3 {
          color: #e2e8f0;
        }

        .editor-footer {
          background: #4a5568;
          border-top-color: #718096;
        }

        .tags-container {
          background: #4a5568;
          border-color: #718096;
        }

        .tag-input,
        .difficulty-select,
        .notes-textarea {
          background: #4a5568;
          border-color: #718096;
          color: #e2e8f0;
        }

        .frequency-display {
          background: #4a5568;
          border-color: #718096;
        }

        .status-option {
          border-color: #718096;
        }

        .status-option:hover {
          background: #4a5568;
        }

        .status-option.selected {
          background: #2c5282;
          border-color: #4299e1;
        }
      }
    `;
  }
} 