/**
 * LinguaTube Background Service Worker
 * Handles extension lifecycle events, cross-context messaging, and state management
 */

import { storageService } from '../storage';
import { ConfigService } from '../translation/ConfigService';

// Types for messaging and state management
interface ExtensionState {
  isActive: boolean;
  currentVideoId: string | null;
  translationCount: number;
  lastActivity: number;
  errors: ErrorReport[];
}

interface ErrorReport {
  timestamp: number;
  message: string;
  stack?: string;
  context: string;
  videoId?: string;
}

interface AnalyticsEvent {
  event: string;
  timestamp: number;
  data?: any;
  videoId?: string;
}

// Global state management
let extensionState: ExtensionState = {
  isActive: false,
  currentVideoId: null,
  translationCount: 0,
  lastActivity: Date.now(),
  errors: []
};

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
  
  // Update last activity timestamp
  extensionState.lastActivity = Date.now();
  
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
    case 'CHECK_ACTIVATION':
      handleCheckActivation(sender, sendResponse);
      break;
    case 'UPDATE_STATE':
      handleUpdateState(request.state, sendResponse);
      break;
    case 'REPORT_ERROR':
      handleReportError(request.error, sender, sendResponse);
      break;
    case 'TRACK_EVENT':
      handleTrackEvent(request.event, sendResponse);
      break;
    case 'GET_EXTENSION_STATE':
      handleGetExtensionState(sendResponse);
      break;
    case 'TRANSLATION_COMPLETED':
      handleTranslationCompleted(request.data, sendResponse);
      break;
    case 'SET_API_KEY':
      handleSetApiKey(request.apiKey, sendResponse);
      break;
    case 'GET_TRANSLATION_STATUS':
      handleGetTranslationStatus(sendResponse);
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
      
      // Show welcome notification
      showNotification(
        'LinguaTube Installed!', 
        'Start watching YouTube videos to translate subtitles and build your vocabulary.'
      );
    } else if (details.reason === 'update') {
      console.log('[LinguaTube] Extension updated from version:', details.previousVersion);
      // Re-initialize translation service on update to ensure API key is still valid
      await initializeTranslationService();
      
      // Show update notification
      showNotification(
        'LinguaTube Updated!', 
        'New features and improvements are now available.'
      );
    }
    
    // Create context menu items
    createContextMenus();
    
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

async function handleCheckActivation(sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
  try {
    // Check if the extension should be active on the current tab
    const shouldActivate = sender.tab?.url?.includes('youtube.com/watch') || false;
    
    if (shouldActivate) {
      extensionState.isActive = true;
      updateBadge(sender.tab?.id);
    }
    
    sendResponse({ 
      success: true, 
      shouldActivate,
      extensionState: extensionState
    });
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to check activation', details: error } 
    });
  }
}

async function handleUpdateState(state: Partial<ExtensionState>, sendResponse: (response: any) => void) {
  try {
    // Update extension state
    extensionState = { ...extensionState, ...state };
    
    // Update badge if video ID changed
    if (state.currentVideoId) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        updateBadge(tabs[0].id);
      }
    }
    
    sendResponse({ 
      success: true, 
      extensionState: extensionState
    });
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to update state', details: error } 
    });
  }
}

async function handleReportError(error: Partial<ErrorReport>, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void) {
  try {
    const errorReport: ErrorReport = {
      timestamp: Date.now(),
      message: error.message || 'Unknown error',
      stack: error.stack,
      context: error.context || 'unknown',
      videoId: error.videoId || extensionState.currentVideoId || undefined
    };
    
    // Add to error list (keep only last 50 errors)
    extensionState.errors.push(errorReport);
    if (extensionState.errors.length > 50) {
      extensionState.errors = extensionState.errors.slice(-50);
    }
    
    // Log error for debugging
    console.error('[LinguaTube] Error reported:', errorReport);
    
    // Show notification for critical errors
    if (error.context === 'critical') {
      showNotification('LinguaTube Error', error.message || 'A critical error occurred');
    }
    
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to report error', details: err } 
    });
  }
}

async function handleTrackEvent(event: Partial<AnalyticsEvent>, sendResponse: (response: any) => void) {
  try {
    // Check if analytics are enabled
    const settingsResult = await storageService.getSettings();
    const analyticsEnabled = settingsResult.success && 
      settingsResult.data?.privacy?.collectAnalytics !== false;
    
    if (!analyticsEnabled) {
      sendResponse({ success: true, tracked: false });
      return;
    }
    
    const analyticsEvent: AnalyticsEvent = {
      event: event.event || 'unknown',
      timestamp: Date.now(),
      data: event.data,
      videoId: event.videoId || extensionState.currentVideoId || undefined
    };
    
    // Store analytics event (privacy-focused, local only)
    await storeAnalyticsEvent(analyticsEvent);
    
    sendResponse({ success: true, tracked: true });
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to track event', details: error } 
    });
  }
}

async function handleGetExtensionState(sendResponse: (response: any) => void) {
  try {
    sendResponse({ 
      success: true, 
      extensionState: extensionState
    });
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to get extension state', details: error } 
    });
  }
}

async function handleTranslationCompleted(data: any, sendResponse: (response: any) => void) {
  try {
    extensionState.translationCount++;
    
    // Update badge with translation count
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      updateBadge(tabs[0].id);
    }
    
    // Track translation event
    await handleTrackEvent({
      event: 'translation_completed',
      data: {
        fromLanguage: data.fromLanguage,
        toLanguage: data.toLanguage,
        textLength: data.text?.length || 0
      }
    }, () => {});
    
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to handle translation completion', details: error } 
    });
  }
}

async function handleSetApiKey(apiKey: string, sendResponse: (response: any) => void) {
  try {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      sendResponse({ 
        success: false, 
        error: { message: 'Invalid API key provided' } 
      });
      return;
    }

    const configService = new ConfigService();
    await configService.setApiKey(apiKey.trim());
    
    console.log('[LinguaTube] ✅ API key updated manually via message');
    
    // Test the configuration
    try {
      const config = await configService.getConfig();
      console.log('[LinguaTube] Translation service re-configured with new key');
      
      sendResponse({ 
        success: true, 
        message: 'API key configured successfully',
        config: {
          endpoint: config.endpoint,
          region: config.region || 'global',
          isReady: true
        }
      });
    } catch (configError) {
      sendResponse({ 
        success: false, 
        error: { message: 'API key saved but configuration test failed', details: configError } 
      });
    }
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to set API key', details: error } 
    });
  }
}

async function handleGetTranslationStatus(sendResponse: (response: any) => void) {
  try {
    const configService = new ConfigService();
    
    let status = {
      configured: false,
      hasApiKey: false,
      endpoint: null as string | null,
      lastError: null as string | null
    };

    try {
      // Check if we have an API key
      const apiKey = await configService.getApiKey();
      status.hasApiKey = !!apiKey;
      
      if (apiKey) {
        // Try to get full config
        const config = await configService.getConfig();
        status.configured = true;
        status.endpoint = config.endpoint;
      }
    } catch (error) {
      status.lastError = error instanceof Error ? error.message : 'Unknown configuration error';
    }

    sendResponse({ 
      success: true, 
      status
    });
  } catch (error) {
    sendResponse({ 
      success: false, 
      error: { message: 'Failed to get translation status', details: error } 
    });
  }
}

// ========================================
// Utility Functions
// ========================================

function updateBadge(tabId?: number) {
  if (!tabId) return;
  
  try {
    const badgeText = extensionState.isActive ? 
      (extensionState.translationCount > 0 ? extensionState.translationCount.toString() : '') : 
      '';
    
    chrome.action.setBadgeText({ text: badgeText, tabId });
    chrome.action.setBadgeBackgroundColor({ color: extensionState.isActive ? '#4CAF50' : '#9E9E9E', tabId });
  } catch (error) {
    console.error('[LinguaTube] Failed to update badge:', error);
  }
}

function showNotification(title: string, message: string) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'img/logo-48.png',
      title,
      message
    });
  } catch (error) {
    console.error('[LinguaTube] Failed to show notification:', error);
  }
}

async function storeAnalyticsEvent(event: AnalyticsEvent) {
  try {
    // Get existing analytics data
    const result = await chrome.storage.local.get(['analytics']);
    const analytics = result.analytics || [];
    
    // Add new event
    analytics.push(event);
    
    // Keep only last 1000 events for privacy
    if (analytics.length > 1000) {
      analytics.splice(0, analytics.length - 1000);
    }
    
    // Store back
    await chrome.storage.local.set({ analytics });
  } catch (error) {
    console.error('[LinguaTube] Failed to store analytics event:', error);
  }
}

// ========================================
// Tab Management
// ========================================

// Handle tab updates to track YouTube video changes
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('youtube.com/watch')) {
    const videoId = extractVideoId(tab.url);
    
    if (videoId && videoId !== extensionState.currentVideoId) {
      extensionState.currentVideoId = videoId;
      extensionState.translationCount = 0; // Reset count for new video
      extensionState.isActive = true;
      
      updateBadge(tabId);
      
      // Track video change event
      await handleTrackEvent({
        event: 'video_changed',
        data: { videoId, url: tab.url }
      }, () => {});
    }
  }
});

function extractVideoId(url: string): string | null {
  const match = url.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}

// ========================================
// Context Menu Integration
// ========================================

function createContextMenus() {
  try {
    chrome.contextMenus.create({
      id: 'linguatube-translate',
      title: 'Translate with LinguaTube',
      contexts: ['selection'],
      documentUrlPatterns: ['*://*.youtube.com/watch*']
    });
    
    chrome.contextMenus.create({
      id: 'linguatube-vocabulary',
      title: 'Add to Vocabulary',
      contexts: ['selection'],
      documentUrlPatterns: ['*://*.youtube.com/watch*']
    });
  } catch (error) {
    console.error('[LinguaTube] Failed to create context menus:', error);
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  
  try {
    switch (info.menuItemId) {
      case 'linguatube-translate':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'TRANSLATE_SELECTION',
          text: info.selectionText
        });
        break;
      case 'linguatube-vocabulary':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'ADD_TO_VOCABULARY',
          text: info.selectionText
        });
        break;
    }
  } catch (error) {
    console.error('[LinguaTube] Context menu action failed:', error);
  }
});

// ========================================
// Translation Service Initialization
// ========================================

async function initializeTranslationService(): Promise<void> {
  try {
    console.log('[LinguaTube] Initializing Microsoft Translator API...');
    
    const configService = new ConfigService();
    
    // First, check if there's already an API key stored in Chrome storage
    try {
      const existingKey = await configService.getApiKey();
      if (existingKey) {
        console.log('[LinguaTube] ✅ Found existing API key in Chrome storage');
        const config = await configService.getConfig();
        console.log('[LinguaTube] Translation service ready with stored key, endpoint:', config.endpoint);
        return;
      }
    } catch (error) {
      console.log('[LinguaTube] No existing API key found in storage, checking environment...');
    }
    
    // Get API key and region from environment variables
    const apiKey = import.meta.env.VITE_TRANSLATION_API_KEY;
    const region = import.meta.env.VITE_TRANSLATION_API_REGION;
    
    console.log('[LinguaTube] Environment variable check:', {
      hasApiKey: !!apiKey,
      apiKeyLength: apiKey ? apiKey.length : 0,
      // Only show first/last few chars for security
      apiKeyPreview: apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'undefined',
      region: region || 'global'
    });
    
    if (!apiKey) {
      console.warn('[LinguaTube] ⚠️ VITE_TRANSLATION_API_KEY not found in environment variables');
      console.warn('[LinguaTube] This usually means the .env file was not properly loaded during build.');
      console.warn('[LinguaTube] Manual API key configuration will be required.');
      
      // Set up a temporary API key configuration using the known working key
      const fallbackApiKey = "I8H9OJS0tH3KSwBqdSWBCXlVLSafmVQ3arnjqH7aS7MAjG62X5ZjJQQJ99BGACL93NaXJ3w3AAAbACOGENHq";
      const fallbackRegion = "australiaeast";
      
      console.log('[LinguaTube] Setting up fallback API key configuration...');
      await configService.setApiKey(fallbackApiKey);
      await configService.updateConfig({ region: fallbackRegion });
      
      console.log('[LinguaTube] ✅ Fallback API key configured successfully');
      
      // Verify configuration
      const config = await configService.getConfig();
      console.log('[LinguaTube] Translation service ready with fallback key, endpoint:', config.endpoint);
      return;
    }
    
    // Set the API key and region from environment
    await configService.setApiKey(apiKey);
    
    // Set the region if provided
    if (region) {
      await configService.updateConfig({ region });
      console.log('[LinguaTube] ✅ Microsoft Translator API key and region configured successfully');
    } else {
      console.log('[LinguaTube] ✅ Microsoft Translator API key configured successfully (using default region)');
    }
    
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
    // Don't re-throw the error, just log it - let extension work without translation
    console.warn('[LinguaTube] Extension will continue without translation features');
  }
}
