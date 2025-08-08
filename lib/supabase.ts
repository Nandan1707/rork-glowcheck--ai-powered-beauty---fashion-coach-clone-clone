import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

// Get environment variables with fallbacks for development
const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || 
  process.env.EXPO_PUBLIC_SUPABASE_URL || 
  'https://uimtqaqgsdqiytyqfyyzj.supabase.co';
  
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey || 
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpbXRxYXFnc2RxaXl0eXFmeXl6aiIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzUyMzI3MTAxLCJleHAiOjIwNjc5MDMxMDF9.Gc5IlgEzndGmWjl8C3F8CZYYB52qrUmaqGnMSmWZpKk';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase configuration. Using fallback values for development.');
}

console.log('Supabase URL:', supabaseUrl);
console.log('Supabase Key exists:', !!supabaseAnonKey);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      'Content-Type': 'application/json',
    },
    fetch: (url, options = {}) => {
      console.log('Supabase fetch:', url);
      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'User-Agent': 'GlowCheck/1.0.0',
        },
      }).catch(error => {
        console.error('Supabase fetch error:', error);
        throw error;
      });
    },
  },
});

export async function signUp(email: string, password: string, metadata?: { name?: string }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: metadata || {},
    },
  });
  return { data, error };
}

export async function signIn(email: string, password: string) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    if (error) {
      console.error('Supabase sign in error:', error);
      
      // Handle specific error types
      if (error.message.includes('Invalid login credentials')) {
        return { data: null, error: { ...error, message: 'Invalid email or password' } };
      }
      
      if (error.message.includes('Email not confirmed')) {
        return { data: null, error: { ...error, message: 'Please check your email and confirm your account' } };
      }
      
      // Network or other errors
      return { data: null, error: { ...error, message: 'Network error, please try again later' } };
    }
    
    return { data, error: null };
  } catch (err) {
    console.error('Network error during sign in:', err);
    return { 
      data: null, 
      error: { 
        message: 'Network error, please try again later',
        details: err 
      } 
    };
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  return { error };
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function updateUserProfile(userId: string, updates: {
  name?: string;
  avatar_url?: string;
  skin_type?: string;
  goals?: string[];
  onboarding_completed?: boolean;
  last_scan_date?: string;
}) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      updated_at: new Date().toISOString(),
      ...updates,
    })
    .select()
    .single();
  
  return { data, error };
}

export async function getUserProfile(userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  return { data, error };
}

export async function resetPassword(email: string) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://your-app.com/reset-password',
  });
  return { data, error };
}

export async function updatePassword(newPassword: string) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  return { data, error };
}

export async function signInWithGoogle() {
  try {
    // For web, use OAuth redirect flow
    // For mobile in production, you would use deep linking
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined' 
          ? `${window.location.origin}/auth/callback`
          : 'exp://localhost:8081/--/auth/callback',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    return { data, error };
  } catch (err) {
    console.error('Google sign in error:', err);
    return { 
      data: null, 
      error: { 
        message: 'Google sign in is not fully configured yet. Please use email/password login.',
        details: err 
      } 
    };
  }
}

export async function refreshSession() {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    return { data, error };
  } catch (err) {
    console.error('Session refresh error:', err);
    return { 
      data: null, 
      error: { 
        message: 'Session refresh failed',
        details: err 
      } 
    };
  }
}

export async function getSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    return { data, error };
  } catch (err) {
    console.error('Get session error:', err);
    return { 
      data: null, 
      error: { 
        message: 'Failed to get session',
        details: err 
      } 
    };
  }
}

// Test function to verify Supabase connection
export async function testSupabaseConnection() {
  try {
    console.log('Testing Supabase connection...');
    const { data, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('Supabase connection test failed:', error);
      return { success: false, error: error.message };
    }
    
    console.log('Supabase connection test successful');
    return { success: true, session: data.session };
  } catch (err) {
    console.error('Supabase connection test error:', err);
    return { success: false, error: 'Connection failed' };
  }
}

// Helper function to create demo user for testing
export async function createDemoUser() {
  const demoEmail = 'demo@glowcheck.com';
  const demoPassword = 'demo123456';
  const demoName = 'Demo User';
  
  try {
    console.log('Creating demo user...');
    const { data, error } = await signUp(demoEmail, demoPassword, { name: demoName });
    
    if (error) {
      // If user already exists, try to sign in instead
      if (error.message.includes('already registered')) {
        console.log('Demo user already exists, signing in...');
        return await signIn(demoEmail, demoPassword);
      }
      throw error;
    }
    
    console.log('Demo user created successfully');
    return { data, error: null };
  } catch (err) {
    console.error('Demo user creation failed:', err);
    return { data: null, error: err };
  }
}