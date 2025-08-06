/**
 * LinguaTube Background Service Worker
 * Handles extension lifecycle events, cross-context messaging, and state management
 */

import { storageService } from '../storage';
import { ConfigService } from '../translation/ConfigService';
import { Logger, ComponentType } from '../logging';

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
  errors: [],
};

const logger = Logger.getInstance();
logger?.info('Background service worker starting...', {
  component: ComponentType.BACKGROUND,
});

// Initialize storage service and translation API on startup
(async () => {
  try {
    await storageService.initialize();
    logger?.info('Storage service initialized successfully', {
      component: ComponentType.BACKGROUND,
    });

    // Initialize Microsoft Translator API
    await initializeTranslationService();

    // Log current settings and storage usage
    const [settingsResult, usageResult] = await Promise.all([
      storageService.getSettings(),
      storageService.getStorageUsage(),
    ]);

    if (settingsResult.success) {
      logger?.info('Current settings', {
        component: ComponentType.BACKGROUND,
        metadata: settingsResult.data,
      });
    }

    if (usageResult.success) {
      logger?.info('Storage usage', {
        component: ComponentType.BACKGROUND,
        metadata: usageResult.data,
      });
    }
  } catch (error) {
    logger?.error('Failed to initialize storage service', {
      component: ComponentType.BACKGROUND,
    }, error as Error);
  }
})();

// extract and store Proof of Origin (PO) Token from YouTube API requests
chrome.webRequest.onBeforeRequest.addListener(
  function (details) {
    const url = new URL(details.url);
    const pot = url.searchParams.get('pot');
    logger?.debug('Proof of Origin token captured', {
      component: ComponentType.BACKGROUND,
      metadata: { pot }
    });
    chrome.storage.local.set({ pot }).then(() => {
      logger?.info('PO token stored', { component: ComponentType.BACKGROUND });
    });
    return { cancel: false };
  },
  { urls: ['*://*.youtube.com/api/timedtext*DESKTOP*'] },
  ['extraHeaders'],
);

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const baseContext = { component: ComponentType.BACKGROUND, metadata: { request } } as const;
  // Only log received messages in debug mode to reduce log volume
  try {
    if (logger?.isDebugModeEnabled && logger.isDebugModeEnabled()) {
      logger.debug('Received message', baseContext);
    }
  } catch {}

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
  logger?.info('Extension installed/updated', {
    component: ComponentType.BACKGROUND,
    metadata: { reason: details.reason },
  });

  try {
    await storageService.initialize();

    if (details.reason === 'install') {
      logger?.info('First time installation - setting up defaults', {
        component: ComponentType.BACKGROUND,
      });
      // Initialize translation service on first install
      await initializeTranslationService();

      // Show welcome notification
      showNotification(
        'LinguaTube Installed!',
        'Start watching YouTube videos to translate subtitles and build your vocabulary.',
      );
    } else if (details.reason === 'update') {
      logger?.info('Extension updated', {
        component: ComponentType.BACKGROUND,
        metadata: { previousVersion: details.previousVersion },
      });
      // Re-initialize translation service on update to ensure API key is still valid
      await initializeTranslationService();

      // Show update notification
      showNotification('LinguaTube Updated!', 'New features and improvements are now available.');
    }

    // Create context menu items
    createContextMenus();
  } catch (error) {
    logger?.error('Installation setup failed', {
      component: ComponentType.BACKGROUND,
    }, error as Error);
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(async () => {
  logger?.info('Extension starting up', { component: ComponentType.BACKGROUND });
  try {
    await storageService.initialize();
    await initializeTranslationService();
  } catch (error) {
    logger?.error('Startup initialization failed', {
      component: ComponentType.BACKGROUND,
    }, error as Error);
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
      error: { message: 'Failed to get settings', details: error },
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
      error: { message: 'Failed to save settings', details: error },
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
      error: { message: 'Failed to save word', details: error },
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
      error: { message: 'Failed to get vocabulary', details: error },
    });
  }
}

async function handleCheckActivation(
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void,
) {
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
      extensionState: extensionState,
    });
  } catch (error) {
    sendResponse({
      success: false,
      error: { message: 'Failed to check activation', details: error },
    });
  }
}

async function handleUpdateState(
  state: Partial<ExtensionState>,
  sendResponse: (response: any) => void,
) {
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
      extensionState: extensionState,
    });
  } catch (error) {
    sendResponse({
      success: false,
      error: { message: 'Failed to update state', details: error },
    });
  }
}

async function handleReportError(
  error: Partial<ErrorReport>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void,
) {
  try {
    const errorReport: ErrorReport = {
      timestamp: Date.now(),
      message: error.message || 'Unknown error',
      stack: error.stack,
      context: error.context || 'unknown',
      videoId: error.videoId || extensionState.currentVideoId || undefined,
    };

    // Add to error list (keep only last 50 errors)
    extensionState.errors.push(errorReport);
    if (extensionState.errors.length > 50) {
      extensionState.errors = extensionState.errors.slice(-50);
    }

    // Log error for debugging
    logger?.error('Error reported', {
      component: ComponentType.BACKGROUND,
      metadata: errorReport,
    });

    // Show notification for critical errors
    if (error.context === 'critical') {
      showNotification('LinguaTube Error', error.message || 'A critical error occurred');
    }

    sendResponse({ success: true });
  } catch (err) {
    sendResponse({
      success: false,
      error: { message: 'Failed to report error', details: err },
    });
  }
}

async function handleTrackEvent(
  event: Partial<AnalyticsEvent>,
  sendResponse: (response: any) => void,
) {
  try {
    // Check if analytics are enabled
    const settingsResult = await storageService.getSettings();
    const analyticsEnabled =
      settingsResult.success && settingsResult.data?.privacy?.collectAnalytics !== false;

    if (!analyticsEnabled) {
      sendResponse({ success: true, tracked: false });
      return;
    }

    const analyticsEvent: AnalyticsEvent = {
      event: event.event || 'unknown',
      timestamp: Date.now(),
      data: event.data,
      videoId: event.videoId || extensionState.currentVideoId || undefined,
    };

    // Store analytics event (privacy-focused, local only)
    await storeAnalyticsEvent(analyticsEvent);

    sendResponse({ success: true, tracked: true });
  } catch (error) {
    sendResponse({
      success: false,
      error: { message: 'Failed to track event', details: error },
    });
  }
}

async function handleGetExtensionState(sendResponse: (response: any) => void) {
  try {
    sendResponse({
      success: true,
      extensionState: extensionState,
    });
  } catch (error) {
    sendResponse({
      success: false,
      error: { message: 'Failed to get extension state', details: error },
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
    await handleTrackEvent(
      {
        event: 'translation_completed',
        data: {
          fromLanguage: data.fromLanguage,
          toLanguage: data.toLanguage,
          textLength: data.text?.length || 0,
        },
      },
      () => {},
    );

    sendResponse({ success: true });
  } catch (error) {
    sendResponse({
      success: false,
      error: { message: 'Failed to handle translation completion', details: error },
    });
  }
}

async function handleSetApiKey(apiKey: string, sendResponse: (response: any) => void) {
  try {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      sendResponse({
        success: false,
        error: { message: 'Invalid API key provided' },
      });
      return;
    }

    const configService = new ConfigService();
    await configService.setApiKey(apiKey.trim());

    logger?.info('✅ API key updated manually via message', {
      component: ComponentType.BACKGROUND,
    });

    // Test the configuration
    try {
      const config = await configService.getConfig();
      logger?.info('Translation service re-configured with new key', {
        component: ComponentType.BACKGROUND,
        metadata: { endpoint: config.endpoint },
      });

      sendResponse({
        success: true,
        message: 'API key configured successfully',
        config: {
          endpoint: config.endpoint,
          region: config.region || 'global',
          isReady: true,
        },
      });
    } catch (configError) {
      sendResponse({
        success: false,
        error: { message: 'API key saved but configuration test failed', details: configError },
      });
    }
  } catch (error) {
    sendResponse({
      success: false,
      error: { message: 'Failed to set API key', details: error },
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
      lastError: null as string | null,
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
      status,
    });
  } catch (error) {
    sendResponse({
      success: false,
      error: { message: 'Failed to get translation status', details: error },
    });
  }
}

// ========================================
// Utility Functions
// ========================================

function updateBadge(tabId?: number) {
  if (!tabId) return;

  try {
    const badgeText = extensionState.isActive
      ? extensionState.translationCount > 0
        ? extensionState.translationCount.toString()
        : ''
      : '';

    // chrome.action.setBadgeText({ text: badgeText, tabId })
    // chrome.action.setBadgeBackgroundColor({
    //   color: extensionState.isActive ? '#4CAF50' : '#9E9E9E',
    //   tabId,
    // })
  } catch (error) {
    logger?.error('Failed to update badge', { component: ComponentType.BACKGROUND }, error as Error);
  }
}

function showNotification(title: string, message: string) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'img/logo-48.png',
      title,
      message,
    });
  } catch (error) {
    logger?.error('Failed to show notification', { component: ComponentType.BACKGROUND }, error as Error);
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
    logger?.error('Failed to store analytics event', { component: ComponentType.BACKGROUND }, error as Error);
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
      await handleTrackEvent(
        {
          event: 'video_changed',
          data: { videoId, url: tab.url },
        },
        () => {},
      );
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
      documentUrlPatterns: ['*://*.youtube.com/watch*'],
    });

    chrome.contextMenus.create({
      id: 'linguatube-vocabulary',
      title: 'Add to Vocabulary',
      contexts: ['selection'],
      documentUrlPatterns: ['*://*.youtube.com/watch*'],
    });
  } catch (error) {
    logger?.error('Failed to create context menus', { component: ComponentType.BACKGROUND }, error as Error);
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
          text: info.selectionText,
        });
        break;
      case 'linguatube-vocabulary':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'ADD_TO_VOCABULARY',
          text: info.selectionText,
        });
        break;
    }
  } catch (error) {
    logger?.error('Context menu action failed', { component: ComponentType.BACKGROUND }, error as Error);
  }
});

// ========================================
// Translation Service Initialization
// ========================================

async function initializeTranslationService(): Promise<void> {
  try {
    logger?.info('Initializing Microsoft Translator API...', {
      component: ComponentType.BACKGROUND,
    });

    const configService = new ConfigService();

    // First, check if there's already an API key stored in Chrome storage
    try {
      const existingKey = await configService.getApiKey();
      if (existingKey) {
        logger?.info('✅ Found existing API key in Chrome storage', {
          component: ComponentType.BACKGROUND,
        });
        const config = await configService.getConfig();
        logger?.info('Translation service ready with stored key', {
          component: ComponentType.BACKGROUND,
          metadata: { endpoint: config.endpoint },
        });
        return;
      }
    } catch (error) {
      logger?.info('No existing API key found in storage, checking environment...', {
        component: ComponentType.BACKGROUND,
      });
    }

    // Get API key and region from environment variables
    const apiKey = import.meta.env.VITE_TRANSLATION_API_KEY;
    const region = import.meta.env.VITE_TRANSLATION_API_REGION;

    logger?.debug('Environment variable check', {
      component: ComponentType.BACKGROUND,
      metadata: {
        hasApiKey: !!apiKey,
        apiKeyLength: apiKey ? apiKey.length : 0,
        region: region || 'global',
      },
    });

    if (!apiKey) {
      logger?.warn('VITE_TRANSLATION_API_KEY not found in environment variables', {
        component: ComponentType.BACKGROUND,
      });
      logger?.warn('This usually means the .env file was not properly loaded during build.', {
        component: ComponentType.BACKGROUND,
      });
      logger?.warn('Manual API key configuration will be required.', {
        component: ComponentType.BACKGROUND,
      });
      // Exit early without configuring a fallback key
      return;
    }

    // Set the API key and region from environment
    await configService.setApiKey(apiKey);

    // Set the region if provided
    if (region) {
      await configService.updateConfig({ region });
      logger?.info('✅ Microsoft Translator API key and region configured successfully', {
        component: ComponentType.BACKGROUND,
      });
    } else {
      logger?.info('✅ Microsoft Translator API key configured successfully (using default region)', {
        component: ComponentType.BACKGROUND,
      });
    }

    // Verify configuration
    const config = await configService.getConfig();
    const isConfigured = await configService.isConfigured();

    logger?.info('✅ Translation service configured', {
      component: ComponentType.BACKGROUND,
      metadata: {
        endpoint: config.endpoint,
        region: config.region || 'global',
        version: config.apiVersion,
        cacheEnabled: config.cacheConfig.enabled,
        rateLimitTracking: config.rateLimitConfig.trackingEnabled,
        batchEnabled: config.batchConfig.enabled,
        isReady: isConfigured,
      },
    });
  } catch (error) {
    logger?.error('❌ Failed to initialize translation service', {
      component: ComponentType.BACKGROUND,
    }, error as Error);
    // Don't re-throw the error, just log it - let extension work without translation
    logger?.warn('Extension will continue without translation features', {
      component: ComponentType.BACKGROUND,
    });
  }
}
