/**
 * LinguaTube Background Service Worker
 * Handles extension lifecycle events and cross-context messaging
 */

import { storageService } from '../storage';

console.log('[LinguaTube] Background service worker starting...');

// Initialize storage service on startup
(async () => {
  try {
    await storageService.initialize();
    console.log('[LinguaTube] Storage service initialized successfully');
    
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
    } else if (details.reason === 'update') {
      console.log('[LinguaTube] Extension updated from version:', details.previousVersion);
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
