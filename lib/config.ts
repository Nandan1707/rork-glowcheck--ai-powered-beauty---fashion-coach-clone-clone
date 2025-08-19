import Constants from 'expo-constants';

const fromEnv = (name: string): string => {
  try {
    const anyGlobal = globalThis as any;
    const val = anyGlobal?.process?.env?.[name];
    return typeof val === 'string' ? val : '';
  } catch {
    return '';
  }
};

// Production-ready configuration management
export const CONFIG = {
  // Supabase Configuration (disabled)
  SUPABASE: {
    URL: '',
    ANON_KEY: '',
  },
  
  // AI Service Configuration
  AI: {
    OPENAI_API_KEY: Constants.expoConfig?.extra?.openaiApiKey || fromEnv('EXPO_PUBLIC_OPENAI_API_KEY') || '',
    GOOGLE_VISION_API_KEY:
      Constants.expoConfig?.extra?.googleVisionApiKey ||
      fromEnv('EXPO_PUBLIC_GOOGLE_VISION_API_KEY') ||
      'AIzaSyBkJnjHv-ZREiwOmHjX9Umc2erPMy47wS4',
    GOOGLE_GEMINI_API_KEY:
      Constants.expoConfig?.extra?.googleGeminiApiKey ||
      fromEnv('EXPO_PUBLIC_GOOGLE_GEMINI_API_KEY') ||
      'AIzaSyBkJnjHv-ZREiwOmHjX9Umc2erPMy47wS4',
    RORK_AI_BASE_URL: 'https://toolkit.rork.com',
  },
  
  // AWS Configuration
  AWS: {
    REGION: Constants.expoConfig?.extra?.awsRegion || fromEnv('EXPO_PUBLIC_AWS_REGION') || 'eu-north-1',
    S3_BUCKET_NAME: Constants.expoConfig?.extra?.awsS3BucketName || fromEnv('EXPO_PUBLIC_AWS_S3_BUCKET_NAME') || '',
    ACCESS_KEY_ID: Constants.expoConfig?.extra?.awsAccessKeyId || fromEnv('EXPO_PUBLIC_AWS_ACCESS_KEY_ID') || '',
    SECRET_ACCESS_KEY: Constants.expoConfig?.extra?.awsSecretAccessKey || fromEnv('EXPO_PUBLIC_AWS_SECRET_ACCESS_KEY') || '',
  },
  
  // App Configuration
  APP: {
    NAME: 'GlowCheck',
    VERSION: Constants.expoConfig?.version || '1.0.0',
    IS_DEV: __DEV__,
    IS_PRODUCTION: !__DEV__,
    BUILD_NUMBER: Constants.expoConfig?.ios?.buildNumber || Constants.expoConfig?.android?.versionCode || '1',
    BUNDLE_ID: Constants.expoConfig?.ios?.bundleIdentifier || Constants.expoConfig?.android?.package || 'com.glowcheck.app',
  },
  
  // Feature Flags
  FEATURES: {
    ENABLE_ANALYTICS: !__DEV__,
    ENABLE_CRASH_REPORTING: !__DEV__,
    ENABLE_PERFORMANCE_MONITORING: !__DEV__,
    USE_MOCK_DATA: false,
    ENABLE_OFFLINE_MODE: true,
    ENABLE_BIOMETRIC_AUTH: true,
    ENABLE_PUSH_NOTIFICATIONS: true,
  },
  
  // API Configuration
  API: {
    TIMEOUT: 30000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY: 1000,
  },
  
  // Storage Configuration
  STORAGE: {
    MAX_CACHE_SIZE: 100 * 1024 * 1024,
    MAX_IMAGE_SIZE: 10 * 1024 * 1024,
    CACHE_EXPIRY: 7 * 24 * 60 * 60 * 1000,
  },
  
  // Stripe Configuration
  STRIPE: {
    PUBLISHABLE_KEY: Constants.expoConfig?.extra?.stripePublishableKey || 
                    fromEnv('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY') || 
                    'pk_test_51RtKrxGlpRLAAEJIUmlklhyogEhqPhlvpIBKmfC35zOR3cPCLnnXzQ3lV2esYSZqd5LvOi1OCG5AFv9FkDUUkLMj00vX09QNT5',
  },
};

// Validation function to check required configuration
export const validateConfig = () => {
  const errors: string[] = [];
  
  if (!CONFIG.AI.GOOGLE_GEMINI_API_KEY && !CONFIG.FEATURES.USE_MOCK_DATA) {
    errors.push('EXPO_PUBLIC_GOOGLE_GEMINI_API_KEY is required for production');
  }
  
  if (!CONFIG.AWS.S3_BUCKET_NAME && !CONFIG.FEATURES.USE_MOCK_DATA) {
    // Optional in client-only mode; do not error
  }
  
  if (errors.length > 0 && CONFIG.APP.IS_PRODUCTION) {
    throw new Error('Configuration errors: ' + errors.join(', '));
  }
  
  if (errors.length > 0 && CONFIG.APP.IS_DEV) {
    console.warn('Configuration warnings:', errors.join(', '));
  }
  
  return errors.length === 0;
};

// Debug configuration loading
console.log('CONFIG DEBUG:', {
  hasGoogleVisionKey: !!CONFIG.AI.GOOGLE_VISION_API_KEY,
  hasGeminiKey: !!CONFIG.AI.GOOGLE_GEMINI_API_KEY,
  googleGeminiKeyLength: CONFIG.AI.GOOGLE_GEMINI_API_KEY?.length || 0,
  googleGeminiKeyStart: CONFIG.AI.GOOGLE_GEMINI_API_KEY?.substring(0, 10) || 'none',
});

// Initialize configuration validation
validateConfig();