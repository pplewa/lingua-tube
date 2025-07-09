/**
 * LinguaTube Background Service Worker
 * Handles extension lifecycle events and cross-context messaging
 */

import { storageService } from '../storage';
import { ConfigService } from '../translation/ConfigService';

console.log('[LinguaTube] Background service worker starting...');

// Initialize storage service and translation API on startup
(async () => {
  try {
    await storageService.initialize();
    console.log('[LinguaTube] Storage service initialized successfully');
    
    // Initialize Microsoft Translator API
    await initializeTranslationService();
    
    // Log current settings and storage usage
    const [settingsResult, usageResult] = await Promise.all([
      storageService.getSettings(),
      storageService.getStorageUsage()
    ]);
    
    if (settingsResult.success) {
      console.log('[LinguaTube] Current settings:', settingsResult.data);
    }
    
    if (usageResult.success) {
      console.log('[LinguaTube] Storage usage:', usageResult.data);
    }
  } catch (error) {
    console.error('[LinguaTube] Failed to initialize storage service:', error);
  }
})();

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[LinguaTube] Received message:', request);
  
  switch (request.type) {
    case 'GET_SETTINGS':
      handleGetSettings(sendResponse);
      break;
    case 'SAVE_SETTINGS':
      handleSaveSettings(request.settings, sendResponse);
      break;
    case 'SAVE_WORD':
      handleSaveWord(request.word, sendResponse);
      break;
    case 'GET_VOCABULARY':
      handleGetVocabulary(sendResponse);
      break;
    default:
      sendResponse({ error: 'Unknown message type' });
  }
  
  // Return true to indicate we will send a response asynchronously
  return true;
});

// Handle extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[LinguaTube] Extension installed/updated:', details.reason);
  
  try {
    await storageService.initialize();
    
    if (details.reason === 'install') {
      console.log('[LinguaTube] First time installation - setting up defaults');
      // Initialize translation service on first install
      await initializeTranslationService();
    } else if (details.reason === 'update') {
      console.log('[LinguaTube] Extension updated from version:', details.previousVersion);
      // Re-initialize translation service on update to ensure API key is still valid
      await initializeTranslationService();
    }
  } catch (error) {
    console.error('[LinguaTube] Installation setup failed:', error);
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('[LinguaTube] Extension starting up');
  try {
    await storageService.initialize();
    await initializeTranslationService();
  } catch (error) {
    console.error('[LinguaTube] Startup initialization failed:', error);
  }
});

// ========================================
// Message Handlers
// ========================================

async function handleGetSettings(sendResponse: (response: any) => void) {
  try {
    const result = await storageService.getSettings();
    sendResponse(result);
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to get settings', details: error } 
    });
  }
}

async function handleSaveSettings(settings: any, sendResponse: (response: any) => void) {
  try {
    const result = await storageService.saveSettings(settings);
    sendResponse(result);
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to save settings', details: error } 
    });
  }
}

async function handleSaveWord(wordData: any, sendResponse: (response: any) => void) {
  try {
    const result = await storageService.saveWord(wordData);
    sendResponse(result);
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to save word', details: error } 
    });
  }
}

async function handleGetVocabulary(sendResponse: (response: any) => void) {
  try {
    const result = await storageService.getVocabulary();
    sendResponse(result);
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to get vocabulary', details: error } 
    });
  }
}

// ========================================
// Translation Service Initialization
// ========================================

async function initializeTranslationService(): Promise<void> {
  try {
    console.log('[LinguaTube] Initializing Microsoft Translator API...');
    
    const configService = new ConfigService();
    
    // Get API key from environment variable
    const apiKey = import.meta.env.VITE_TRANSLATION_API_KEY;
    
    if (!apiKey) {
      console.error('[LinguaTube] ❌ VITE_TRANSLATION_API_KEY not found in environment variables');
      console.error('[LinguaTube] Please add VITE_TRANSLATION_API_KEY=your_api_key to your .env file');
      throw new Error('Translation API key not configured in environment variables');
    }
    
    // Check if API key is already configured
    try {
      const currentKey = await configService.getApiKey();
      if (currentKey === apiKey) {
        console.log('[LinguaTube] Microsoft Translator API key already configured');
        const config = await configService.getConfig();
        console.log('[LinguaTube] Translation service ready with endpoint:', config.endpoint);
        return;
      }
    } catch (error) {
      // API key not found, will set it below
      console.log('[LinguaTube] No existing API key found, setting up new one...');
    }
    
    // Set the API key
    await configService.setApiKey(apiKey);
    console.log('[LinguaTube] ✅ Microsoft Translator API key configured successfully');
    
    // Verify configuration
    const config = await configService.getConfig();
    const isConfigured = await configService.isConfigured();
    
    console.log('[LinguaTube] ✅ Translation service configured:', {
      endpoint: config.endpoint,
      region: config.region || 'global',
      version: config.apiVersion,
      cacheEnabled: config.cacheConfig.enabled,
      rateLimitTracking: config.rateLimitConfig.trackingEnabled,
      batchEnabled: config.batchConfig.enabled,
      isReady: isConfigured
    });
    
  } catch (error) {
    console.error('[LinguaTube] ❌ Failed to initialize translation service:', error);
    throw error;
  }
}
