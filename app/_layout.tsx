import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { AppState, Platform } from "react-native";
import Constants from 'expo-constants';

import { AuthContext } from "@/hooks/auth-store";
import { SubscriptionContext } from "@/hooks/subscription-store";
import ErrorBoundary from "@/components/ErrorBoundary";
import { analyticsService } from "@/lib/analytics";
import { errorHandler } from "@/lib/error-handler";
import { storageService } from "@/lib/storage";
import { logger } from "@/lib/logger";
import stripeService from "@/lib/stripe-service";
import subscriptionService from "@/lib/subscription-service";

// Fallback provider component for web and error cases
const FallbackStripeProvider = ({ children }: { children: React.ReactNode }) => <>{children}</>;

// Platform-specific Stripe provider - completely avoid on web
let StripeProvider: React.ComponentType<any> = FallbackStripeProvider;

// Only try to load Stripe on native platforms to avoid web bundling issues
if (Platform.OS !== 'web') {
  try {
    // Use eval to prevent bundler from analyzing this require
    const requireStripe = eval('require');
    const StripeRN = requireStripe('@stripe/stripe-react-native');
    StripeProvider = StripeRN.StripeProvider;
    console.log('Stripe React Native provider loaded successfully');
  } catch (error) {
    console.warn('Stripe React Native not available, using fallback', error);
    // Use fallback provider for native platforms when Stripe fails to load
    StripeProvider = FallbackStripeProvider;
  }
}

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="splash" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false, gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    const initializeApp = async () => {
      try {
        logger.info('App: Initializing production services');
        
        // Initialize error handler with additional safety
        try {
          await errorHandler.initialize();
          logger.info('App: Error handler initialized');
        } catch (errorHandlerError) {
          console.warn('App: Error handler initialization failed', errorHandlerError);
        }
        
        // Initialize analytics
        try {
          await analyticsService.initialize();
          await analyticsService.appLaunched();
          logger.info('App: Analytics initialized');
        } catch (analyticsError) {
          console.warn('App: Analytics initialization failed', analyticsError);
        }
        
        // Clean up old cached data
        try {
          await storageService.cleanup();
          logger.info('App: Storage cleanup completed');
        } catch (storageError) {
          console.warn('App: Storage cleanup failed', storageError);
        }
        
        // Initialize Stripe
        try {
          await stripeService.initialize();
          logger.info('App: Stripe initialized');
        } catch (stripeError) {
          console.warn('App: Stripe initialization failed', stripeError);
        }
        
        // Sync subscription status
        try {
          await subscriptionService.syncSubscriptionStatus();
          logger.info('App: Subscription status synced');
        } catch (subscriptionError) {
          console.warn('App: Subscription sync failed', subscriptionError);
        }
        
        logger.info('App: Production services initialized successfully');
      } catch (error) {
        console.error('App: Failed to initialize services', error);
        // Don't let initialization errors crash the app
      } finally {
        // Always hide splash screen
        try {
          await SplashScreen.hideAsync();
        } catch (splashError) {
          console.warn('App: Failed to hide splash screen', splashError);
        }
      }
    };

    initializeApp();

    // Handle app state changes for analytics
    const handleAppStateChange = (nextAppState: string) => {
      try {
        if (nextAppState === 'background') {
          analyticsService.appBackgrounded();
        } else if (nextAppState === 'active') {
          analyticsService.appForegrounded();
        }
      } catch (error) {
        console.warn('App: App state change handling failed', error);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      try {
        subscription?.remove();
        analyticsService.destroy();
      } catch (error) {
        console.warn('App: Cleanup failed', error);
      }
    };
  }, []);

  // Only configure Stripe props on native platforms
  const stripeProps = Platform.OS !== 'web' ? {
    publishableKey: Constants.expoConfig?.extra?.stripePublishableKey || 
                   process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || 
                   'pk_test_51RtKrxGlpRLAAEJIUmlklhyogEhqPhlvpIBKmfC35zOR3cPCLnnXzQ3lV2esYSZqd5LvOi1OCG5AFv9FkDUUkLMj00vX09QNT5',
    merchantIdentifier: "merchant.com.glowapp",
    urlScheme: "glowapp"
  } : {};

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StripeProvider {...stripeProps}>
          <AuthContext>
            <SubscriptionContext>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <StatusBar style="dark" />
                <RootLayoutNav />
              </GestureHandlerRootView>
            </SubscriptionContext>
          </AuthContext>
        </StripeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}