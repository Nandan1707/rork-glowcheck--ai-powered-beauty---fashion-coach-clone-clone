import { Platform } from 'react-native';
import React from 'react';

// Platform-specific module loader to avoid web bundling issues
export const loadStripeModule = () => {
  if (Platform.OS === 'web') {
    // Return mock implementations for web
    return {
      initStripe: async () => {
        console.log('Mock Stripe init on web');
      },
      useStripe: () => ({
        confirmPayment: async () => ({ error: null }),
      }),
      StripeProvider: ({ children }: { children: React.ReactNode }) => 
        React.createElement(React.Fragment, null, children),
    };
  }

  try {
    // Use dynamic import for native platforms
    const StripeRN = require('@stripe/stripe-react-native');
    return {
      initStripe: StripeRN.initStripe,
      useStripe: StripeRN.useStripe,
      StripeProvider: StripeRN.StripeProvider,
    };
  } catch (error) {
    console.warn('Stripe React Native not available, using mock implementations', error);
    // Return mock implementations as fallback
    return {
      initStripe: async () => {
        console.log('Mock Stripe init (fallback)');
      },
      useStripe: () => ({
        confirmPayment: async () => ({ error: null }),
      }),
      StripeProvider: ({ children }: { children: React.ReactNode }) => 
        React.createElement(React.Fragment, null, children),
    };
  }
};

// Cache the loaded module to avoid multiple requires
let stripeModule: ReturnType<typeof loadStripeModule> | null = null;

export const getStripeModule = () => {
  if (!stripeModule) {
    stripeModule = loadStripeModule();
  }
  return stripeModule;
};