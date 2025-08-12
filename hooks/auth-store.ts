import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { useState, useEffect } from 'react';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import { signInWithStateChange as signIn, signUp, signOutWithStateChange as signOut, getCurrentUser, updateUserProfile, auth } from '@/lib/auth-service';
import { subscriptionService, SubscriptionStatus } from '@/lib/subscription-service';
import { User, UserProfile } from '@/types';

export const [AuthContext, useAuth] = createContextHook(() => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus>({ isActive: false });
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const queryClient = useQueryClient();

  // Check for existing session and subscription status on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const currentUser = await getCurrentUser();
        if (currentUser) {
          setUser(currentUser);
          
          // Check subscription status
          const subStatus = await subscriptionService.getSubscriptionStatus();
          setSubscriptionStatus(subStatus);
        }
      } catch (error) {
        console.error('Error checking session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkSession();

    // Listen for auth state changes
    const authListener = auth.onAuthStateChange(
      async (event: string, session: any) => {
        console.log('Auth state changed:', event, !!session?.user);
        
        if (event === 'SIGNED_IN' && session?.user) {
          const user = session.user;
          setUser(user);
          
          // Check subscription status
          const subStatus = await subscriptionService.getSubscriptionStatus();
          setSubscriptionStatus(subStatus);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setSubscriptionStatus({ isActive: false });
          // Clear any cached data
          await AsyncStorage.multiRemove(['userProfile', 'lastScanData', 'glowPlanProgress']);
        } else if (event === 'TOKEN_REFRESHED') {
          console.log('Token refreshed successfully');
        }
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, []);

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const { data, error } = await signIn(email, password);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      router.replace('/(tabs)');
    },
  });

  const registerMutation = useMutation({
    mutationFn: async ({ email, password, name }: { email: string; password: string; name: string }) => {
      const { data, error } = await signUp(email, password, { name });
      if (error) throw error;
      
      // User profile is automatically created in the auth service
      
      return data;
    },
    onSuccess: (data) => {
      // User is automatically signed up and can proceed
      if (data?.user) {
        router.replace('/(tabs)');
      }
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const { error } = await signOut();
      if (error) throw error;
      return null;
    },
    onSuccess: async () => {
      setUser(null);
      setSubscriptionStatus({ isActive: false });
      queryClient.clear();
      
      // Clear all stored data
      try {
        await AsyncStorage.multiRemove([
          'userProfile',
          'lastScanData', 
          'glowPlanProgress',
          'userSettings',
          'cachedAnalyses'
        ]);
      } catch (error) {
        console.warn('Error clearing storage on logout:', error);
      }
      
      router.replace('/onboarding');
    },
  });

  const startFreeTrial = async (): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Please log in to start your free trial.' };
    }
    
    setSubscriptionLoading(true);
    
    try {
      const result = await subscriptionService.startFreeTrial();
      
      if (result.success) {
        // Update subscription status
        const newStatus = await subscriptionService.getSubscriptionStatus();
        setSubscriptionStatus(newStatus);
        
        // Update user subscription tier (in a real app, this would be handled by the subscription service)
          
        setUser({ ...user, subscription_tier: 'premium' });
      }
      
      return result;
    } catch (error) {
      console.error('Error starting free trial:', error);
      return { success: false, error: 'Failed to start free trial. Please try again.' };
    } finally {
      setSubscriptionLoading(false);
    }
  };
  
  const subscribeToPlan = async (planId: string): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Please log in to subscribe.' };
    }
    
    setSubscriptionLoading(true);
    
    try {
      const result = await subscriptionService.subscribeToPlan(planId);
      
      if (result.success) {
        // Update subscription status
        const newStatus = await subscriptionService.getSubscriptionStatus();
        setSubscriptionStatus(newStatus);
        
        // Update user subscription tier (in a real app, this would be handled by the subscription service)
          
        setUser({ ...user, subscription_tier: 'premium' });
      }
      
      return result;
    } catch (error) {
      console.error('Error subscribing to plan:', error);
      return { success: false, error: 'Subscription failed. Please try again.' };
    } finally {
      setSubscriptionLoading(false);
    }
  };
  
  const upgradeToPremium = async () => {
    Alert.alert('Demo Mode', 'Premium is unlocked for demo.');
  };
  
  const updateProfile = async (updates: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'User not authenticated' };
    }
    
    try {
      const { data, error } = await updateUserProfile(user.id, updates);
      if (error) throw error;
      
      // Update local user state
      setUser({
        ...user,
        name: updates.name || user.name,
        avatar_url: updates.avatar_url || user.avatar_url,
        profile: { ...user.profile, ...data } as UserProfile,
      });
      
      return { success: true };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { success: false, error: 'Failed to update profile' };
    }
  };
  
  const hasCompletedScan = (): boolean => {
    return !!user?.profile?.last_scan_date;
  };
  
  const requiresOnboarding = (): boolean => {
    return !user?.profile?.onboarding_completed;
  };
  
  const checkPremiumAccess = (_feature: string, _allowDemo: boolean = false): boolean => {
    return true;
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    isPremium: true,
    subscriptionStatus,
    subscriptionLoading,
    login: loginMutation.mutate,
    register: registerMutation.mutate,
    logout: logoutMutation.mutate,
    updateProfile,
    hasCompletedScan,
    requiresOnboarding,
    startFreeTrial,
    subscribeToPlan,
    upgradeToPremium,
    checkPremiumAccess,
    loginError: loginMutation.error,
    registerError: registerMutation.error,
    isLoginLoading: loginMutation.isPending,
    isRegisterLoading: registerMutation.isPending,
    isLogoutLoading: logoutMutation.isPending,
  };
});