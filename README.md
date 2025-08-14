# LinguaTube

> A Chrome extension for language learning through YouTube videos with dual subtitles, interactive word lookup, and vocabulary building.

## 🎯 Overview

LinguaTube transforms YouTube into a powerful language learning platform by enhancing video playback with intelligent subtitle features, instant word translation, and vocabulary management. The extension seamlessly integrates with YouTube's video player to provide a comprehensive language immersion experience.

## ✨ Key Features

### 🔤 Dual Subtitle Engine

- **Dual Language Display**: Show both target language and native language subtitles simultaneously
- **Smart Subtitle Discovery**: Automatically detects and prioritizes official human-created subtitles over auto-generated ones
- **Real-time Translation**: Translates target language subtitles when native language subtitles aren't available
- **Customizable Positioning**: Adjust subtitle placement, font size, and colors
- **Toggle Controls**: Show/hide each subtitle track independently

### 📚 Interactive Word Lookup

- **Click-to-Translate**: Click any word in subtitles for instant translation and definition
- **Rich Word Information**: Get translations, definitions, phonetic transcriptions, and pronunciation
- **Contextual Learning**: View words within their original sentence context
- **Multi-API Integration**: Uses Microsoft Translator API and Free Dictionary API for comprehensive word data

### 🎧 Pronunciation & TTS

- **Text-to-Speech**: Native OS integration for word pronunciation
- **Audio Caching**: Intelligent caching of pronunciations to reduce latency
- **Phonetic Support**: IPA phonetic transcriptions for accurate pronunciation learning

### 📖 Vocabulary Management

- **Smart Vocabulary Capture**: Save words with translation, definition, and source context
- **Visual Highlighting**: Previously saved words are highlighted in future videos
- **Vocabulary Browser**: View and manage your saved vocabulary through the extension popup
- **Local Storage**: All vocabulary data stored locally using Chrome storage API

### 🎮 Enhanced Playback Controls

- **Language Learning Optimized**: Specialized controls for repetitive learning
- **Sentence Looping**: Repeat specific subtitle segments for focused practice
- **Speed Controls**: Adjust playback speed for better comprehension
- **Direct Video API**: Uses HTML5 video element API for reliable control

### 🇹🇭 Thai Subtitle Segmentation (Hybrid)

- Hybrid segmenter combines Intl.Segmenter with per-video collocation merges and dictionary hints
- No runtime network calls during playback; optional single AI hint fetch per video (disabled by default)
- Dev overlay available to visualize tokenization/merges

## 🏗️ Technical Architecture

### Core Architecture

- **Platform**: Chrome Extension (Manifest V3)
- **Client-Side Only**: No backend server required for MVP
- **Local Storage**: All user data stored using `chrome.storage.local` API
- **Modern Stack**: TypeScript + React + Vite for development

### Data Flow

1. **Content Script Injection**: Automatically injected into YouTube video pages
2. **Subtitle Discovery**: Parses YouTube's `ytInitialPlayerResponse` global object
3. **Subtitle Fetching**: Uses fetch API to retrieve subtitle files (avoiding CORS issues)
4. **Translation Processing**: Sends subtitles to Microsoft Translator API when needed
5. **UI Rendering**: Custom React components render dual subtitles over the video player
6. **User Interaction**: Click events trigger word lookup and vocabulary saving
7. **Data Persistence**: Vocabulary and settings saved to Chrome local storage

### API Integration

| Service            | Provider                 | Purpose                                 |
| ------------------ | ------------------------ | --------------------------------------- |
| **Translation**    | Microsoft Translator API | Real-time subtitle and word translation |
| **Dictionary**     | Free Dictionary API      | Word definitions and phonetic data      |
| **Text-to-Speech** | Native OS Integration    | Word pronunciation                      |
| **Subtitles**      | YouTube Player Response  | Subtitle track discovery and fetching   |

### Key Components

#### Frontend Components

- **`DualSubtitleManager`**: Core subtitle rendering and synchronization
- **`WordLookupPopup`**: Interactive word translation popup
- **`VocabularyListManager`**: Vocabulary browsing and management
- **`EnhancedPlaybackControls`**: Language learning optimized video controls

#### Backend Services

- **`SubtitleDiscoveryService`**: YouTube subtitle track detection and parsing
- **`TranslationApiService`**: Microsoft Translator API integration
- **`VocabularyManager`**: Local vocabulary storage and retrieval
- **`PlayerInteractionService`**: YouTube video player integration

#### Utilities

- **`StorageService`**: Chrome storage abstraction layer
- **`Logger`**: Comprehensive logging and error tracking
- **`ConfigService`**: Extension settings and configuration management

## 🚀 Installation & Setup

### Prerequisites

- Node.js >= 14
- Chrome browser with Developer Mode enabled
- Microsoft Translator API key (for translation features)

### Development Setup

1. **Clone and Install**

   ```bash
   git clone <repository-url>
   cd lingua-tube
   npm install
   ```

2. **Configure Translation API**
   Create a `.env` file in the project root:

   ```bash
   TRANSLATION_API_KEY=your_microsoft_translator_api_key
   ```

3. **Development Build**

   ```bash
   npm run dev
   ```

4. **Load Extension in Chrome**
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `lingua-tube/build` folder

### Production Build

```bash
npm run build
```

The `build` folder will contain the extension ready for Chrome Web Store submission.

## 🎬 How It Works

### YouTube Integration

1. **Automatic Detection**: Extension activates only on YouTube video pages (`*.youtube.com/watch*`)
2. **Player Readiness**: Waits for YouTube player to fully load before initialization
3. **Subtitle Discovery**: Parses YouTube's internal player response to find available subtitle tracks
4. **Non-Intrusive Injection**: Overlays custom UI without interfering with YouTube's native functionality

### Translation Workflow

1. **Subtitle Prioritization**: Prefers human-created subtitles over auto-generated ones
2. **Smart Translation**: Only translates when native language subtitles are unavailable
3. **Batch Processing**: Optimizes API calls through intelligent batching and caching
4. **Error Handling**: Robust fallback mechanisms for API failures

### Vocabulary Learning

1. **Contextual Capture**: Words are saved with their full sentence context
2. **Visual Memory**: Previously learned words are highlighted in new videos
3. **Progressive Learning**: Track learning progress through visual indicators
4. **Export Capability**: Vocabulary data can be exported for external study tools

### Performance Optimizations

- **Lazy Loading**: Components initialize only when needed
- **Memory Management**: Efficient cleanup of resources when navigating between videos
- **Caching Strategy**: Smart caching of translations and pronunciation data
- **Background Processing**: Heavy operations handled in background service worker

## 🔧 Configuration

### Extension Settings

Access settings through the extension popup:

- **Language Preferences**: Set target and native languages
- **Subtitle Appearance**: Customize fonts, colors, and positioning
- **Translation Services**: Configure API keys and preferences
- **Vocabulary Options**: Set highlight colors and learning preferences
 - **Developer Flags**: Enable hybrid Thai segmenter and optional segmentation overlay for debugging

### API Configuration

The extension requires a Microsoft Translator API key for translation features:

1. Sign up for Azure Cognitive Services
2. Create a Translator resource
3. Add your API key to the extension settings

## 🛠️ Development

### Project Structure

```
src/
├── background/          # Background service worker
├── contentScript/       # Main content script entry point
├── subtitles/          # Subtitle discovery and parsing
├── translation/        # Translation API integration
├── ui/                # React UI components
├── vocabulary/         # Vocabulary management
├── youtube/           # YouTube player integration
├── storage/           # Chrome storage abstraction
└── logging/           # Logging and error tracking
```

### Key Design Principles

- **Modular Architecture**: Clear separation of concerns between components
- **Type Safety**: Comprehensive TypeScript coverage for reliability
- **Error Resilience**: Graceful degradation when APIs are unavailable
- **Performance First**: Minimal impact on YouTube's native performance
- **User Privacy**: All data stored locally, no external tracking

### Testing & Debugging

- **Console Logging**: Comprehensive logging for debugging
- **Error Tracking**: Detailed error reporting with stack traces
- **Performance Monitoring**: Built-in performance measurement tools
- **Development Mode**: Hot reloading for rapid development iteration

## 📈 Future Roadmap

### Planned Features

- **Multiple Language Support**: Support for more language pairs
- **Advanced Analytics**: Learning progress tracking and statistics
- **Community Features**: Shared vocabulary lists and learning groups
- **Mobile Support**: Extension for mobile browsers
- **Offline Mode**: Local translation capabilities for offline learning

### API Expansions

- **Multiple Translation Providers**: Support for Google Translate, DeepL, etc.
- **Advanced Dictionary Services**: More comprehensive word definitions
- **Learning Management**: Integration with spaced repetition systems

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

---

**LinguaTube** - Transform your YouTube experience into a powerful language learning journey.
