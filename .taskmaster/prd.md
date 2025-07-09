# **Technical Product Requirements Document: LinguaTube (MVP)**

This document outlines the technical specifications for the Minimum Viable Product (MVP) of the LinguaTube Chrome Extension. The goal is to create a client-side extension that enhances the YouTube video player with language-learning tools.

## **1\. Core Architecture**

* **Platform:** Google Chrome Extension (Manifest V3).  
* **Architecture:** Entirely client-side for the MVP. No backend server or database is required.  
* **Data Storage:** All user data (saved vocabulary, settings) will be stored locally using the chrome.storage.local API.  
* **Primary Data Flow:**  
  1. **Injection:** A content script is injected into the YouTube video page DOM on load.  
  2. **Subtitle Discovery:** The script accesses the page's global ytInitialPlayerResponse JavaScript object to find all available subtitle tracks. 1  
  3. **Data Fetching:** The script uses fetch to retrieve the target language subtitle file.  
  4. **Translation:** If a native language subtitle file is not available, the target language track is sent to the Translation API.  
  5. **Rendering:** A custom UI component is injected to display dual subtitles over the video player.  
  6. **Interaction:** User clicks on words trigger API calls for translation, definition, and pronunciation.  
  7. **Persistence:** Saved words are written to chrome.storage.local.

## **2\. Key Implementation Details**

### **2.1 Subtitle Retrieval**

* **Method:** The primary method for retrieving subtitles is to parse the ytInitialPlayerResponse global variable present on the YouTube video page. 1 This avoids CORS issues as the request originates from the  
  youtube.com domain.  
* **Constraint:** The official YouTube Data API (captions:download) must **not** be used for subtitle retrieval due to its prohibitive quota cost (200 units/call), which is not financially viable for this product. 3  
* **Risk Mitigation:** The scraping method is dependent on YouTube's front-end structure. The code responsible for parsing this object must be isolated in a dedicated, modular component to allow for rapid updates if YouTube changes its front-end.

### **2.2 YouTube Player Interaction**

* **Method:** All playback controls (play, pause, seek, speed change) must be implemented by getting a direct reference to the HTML5 \<video\> element on the page and manipulating it via the standard HTMLMediaElement API (e.g., video.play(), video.pause(), video.currentTime). 5  
* **Constraint:** Do not rely on simulating clicks on YouTube's proprietary UI buttons (e.g., .ytp-button-play), as their class names and DOM structure are subject to frequent changes. 5

## **3\. API Stack (MVP)**

An abstraction layer should be created for each API type to allow for future flexibility (e.g., swapping providers, tiering access).

| Service | Selected API | Rationale & Implementation Notes |  |
| :---- | :---- | :---- | :---- |
| **Translation** | **Microsoft Translator API** 6 | Provides a generous free tier of 2 million characters/month. 6 Use the | @azure-rest/ai-translation-text npm package for integration. 7 |
| **Text-to-Speech (TTS)** | **Native OS integration** 8 | It's free |
| **Dictionary** | **Free Dictionary API (dictionaryapi.dev)** | Chosen for the MVP because it is free and does not require an API key, simplifying initial development. 13 Provides necessary data points: definitions, phonetic transcriptions (IPA), and audio pronunciation URLs (as a fallback for the TTS API). 13 |  |

## **4\. MVP Feature Specifications**

### **4.1 Dual Subtitle Engine**

* **Functionality:** Injects a custom subtitle renderer over the YouTube player.  
* **Subtitle Logic:**  
  * Prioritize subtitle sources: 1\) Official human-created tracks, 2\) Official auto-generated (ASR) tracks. 3  
  * If native-language subtitles are not provided by YouTube, translate the target-language track using the selected Translation API.  
* **UI Controls:** Implement a settings panel with controls for:  
  * Toggling visibility of each subtitle track independently.  
  * Adjusting font size and color for each track.  
  * Adjusting the vertical position of the subtitle block.

### **4.2 Interactive Word Lookup**

* **Functionality:** When a user clicks on a word in the target-language subtitle, a popup overlay appears.  
* **Implementation:**  
  * Wrap each word in the subtitle text in a \<span\> with a click event listener.  
  * The popup must asynchronously fetch and display:  
    1. **Translation:** From Microsoft Translator API.  
    2. **Definition & Phonetics:** From Free Dictionary API.  
    3. **"Save Word" Button.**  
    4. **"Pronounce" (TTS) Button.**

### **4.3 On-Demand Pronunciation (TTS)**

* **Functionality:** A speaker icon in the word lookup popup plays the pronunciation of the selected word.  
* **Implementation:**  
  * On click, trigger system call to pronounce.  
  * Cache audio responses for common words in local storage to reduce latency and API costs.

### **4.4 Basic Vocabulary Capture**

* **Functionality:** A system to save and review new words.  
* **Implementation:**  
  * The "Save Word" button stores an object containing the word, its translation, and the full source sentence (for context) into chrome.storage.local.  
  * The extension's main popup window will have a tab that displays a simple list of all saved vocabulary items from local storage.  
  * When subtitles are rendered, any word that exists in the user's local vocabulary list should be visually highlighted (e.g., with a distinct underline).

### **4.5 Enhanced Playback Controls**

* **Functionality:** Provide learner-focused playback controls.  
* **Implementation:**  
  * **Sentence Loop:** A button that, when clicked, repeatedly plays the current subtitle segment by setting video.currentTime to the segment's start time.  
  * **Precise Navigation:** Keyboard shortcuts that jump to the start time of the previous or next subtitle line.  
  * **Speed Control:** UI controls to set video.playbackRate to 0.75 and 0.9.

## **5\. Future Considerations (Post-MVP)**

The following features are out of scope for the MVP but should be considered when designing the initial architecture to ensure scalability:

* **Integrated Spaced Repetition System (SRS):** An internal review system to replace the basic vocabulary list.  
* **AI Grammar Coach:** Integration with an LLM to provide grammatical explanations.  
* **User Accounts & Cloud Sync:** A backend system will be required to sync user data across devices.
