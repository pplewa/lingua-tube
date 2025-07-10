# LinguaTube Translation API Debug Guide

If you're experiencing 401 errors when clicking words for translation, follow these debugging steps:

## 1. Check Extension Console Logs

1. Open Chrome DevTools (F12)
2. Go to **Console** tab  
3. Filter by "LinguaTube" to see extension-specific logs
4. Look for messages about API key loading and translation service initialization

Expected messages:
- `[LinguaTube] Microsoft Translator API key configured successfully` ✅
- `[LinguaTube] Translation service ready with endpoint: https://api.cognitive.microsofttranslator.com` ✅

Error messages to look for:
- `VITE_TRANSLATION_API_KEY not found in environment variables` ❌
- `Failed to initialize translation service` ❌

## 2. Check if Environment Variable is Loaded

Run this in the browser console on any YouTube video page:

```javascript
// Check if the API key was properly loaded during build
chrome.runtime.sendMessage({ type: 'GET_TRANSLATION_STATUS' }, (response) => {
  console.log('Translation Status:', response);
  if (response.success) {
    if (response.status.configured) {
      console.log('✅ Translation API is properly configured');
    } else if (response.status.hasApiKey) {
      console.log('⚠️ API key found but configuration failed:', response.status.lastError);
    } else {
      console.log('❌ No API key configured');
    }
  } else {
    console.log('❌ Failed to check status:', response.error);
  }
});
```

## 3. Manually Set API Key (If Environment Variable Failed)

If the `.env` file isn't working, you can manually configure the API key:

```javascript
// Replace 'YOUR_API_KEY_HERE' with your actual Microsoft Translator API key
const apiKey = 'YOUR_API_KEY_HERE';

chrome.runtime.sendMessage({ 
  type: 'SET_API_KEY', 
  apiKey: apiKey 
}, (response) => {
  console.log('API Key Update Result:', response);
  if (response.success) {
    console.log('✅ API key configured successfully!');
    console.log('Translation service endpoint:', response.config.endpoint);
  } else {
    console.log('❌ Failed to configure API key:', response.error);
  }
});
```

## 4. Test Word Translation

After configuring the API key, test word translation:

```javascript
// Click on any word in subtitles and check console for error messages
// You should see successful translation messages instead of 401 errors
```

## 5. Environment Variable Setup (Preferred Method)

The proper way to configure the API key is through environment variables:

1. Create or edit `.env` file in project root:
```bash
VITE_TRANSLATION_API_KEY=your_microsoft_translator_api_key_here
```

2. Rebuild the extension:
```bash
npm run build
```

3. Reload the extension in Chrome

## 6. Get Microsoft Translator API Key

If you don't have an API key:

1. Go to [Azure Portal](https://portal.azure.com)
2. Create a "Translator" resource
3. Go to "Keys and Endpoint" section
4. Copy "Key 1" or "Key 2"
5. Add it to your `.env` file or use the manual configuration method above

## 7. Verify the Fix

After configuration, when you click on words in subtitles:
- ✅ Should see translations appear instead of the original word
- ✅ Console should show translation success messages
- ❌ Should NOT see 401 Unauthorized errors

If you still see errors like `[Translation Error: API key needed]` or `[No API key configured]`, the configuration wasn't successful and you should repeat the steps above. 