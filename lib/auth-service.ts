import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  subscription_tier: 'free' | 'premium';
  profile?: UserProfile;
}

export interface UserProfile {
  id: string;
  name?: string;
  avatar_url?: string;
  skin_type?: string;
  goals?: string[];
  onboarding_completed?: boolean;
  last_scan_date?: string;
  created_at: string;
  updated_at: string;
}

export interface AuthError {
  message: string;
  details?: any;
}

export interface AuthResponse {
  data: { user: User } | null;
  error: AuthError | null;
}

const STORAGE_KEYS = {
  USER: 'auth_user',
  SESSION: 'auth_session',
  PROFILES: 'user_profiles',
  USERS: 'users_db',
} as const;

// Simple in-memory database simulation
let usersDB: Record<string, User> = {};
let profilesDB: Record<string, UserProfile> = {};

// Initialize databases from storage
const initializeDatabases = async () => {
  try {
    const [usersData, profilesData] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.USERS),
      AsyncStorage.getItem(STORAGE_KEYS.PROFILES),
    ]);
    
    if (usersData) {
      usersDB = JSON.parse(usersData);
    }
    
    if (profilesData) {
      profilesDB = JSON.parse(profilesData);
    }
  } catch (error) {
    console.error('Error initializing databases:', error);
  }
};

// Save databases to storage
const saveDatabases = async () => {
  try {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(usersDB)),
      AsyncStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(profilesDB)),
    ]);
  } catch (error) {
    console.error('Error saving databases:', error);
  }
};

// Generate a simple UUID
const generateId = (): string => {
  return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};

// Hash password (simple implementation for demo)
const hashPassword = (password: string): string => {
  // In a real app, use proper password hashing like bcrypt
  return btoa(password + 'salt_key_demo');
};

// Verify password
const verifyPassword = (password: string, hashedPassword: string): boolean => {
  return hashPassword(password) === hashedPassword;
};

// Initialize on module load
initializeDatabases();

export async function signUp(email: string, password: string, metadata?: { name?: string }): Promise<AuthResponse> {
  try {
    console.log('Signing up user:', email);
    
    // Check if user already exists
    const existingUser = Object.values(usersDB).find(user => user.email === email);
    if (existingUser) {
      return {
        data: null,
        error: { message: 'User already exists with this email' }
      };
    }
    
    // Create new user
    const userId = generateId();
    const hashedPassword = hashPassword(password);
    
    const newUser: User = {
      id: userId,
      email,
      name: metadata?.name || email.split('@')[0],
      subscription_tier: 'free',
    };
    
    // Store user with hashed password
    usersDB[userId] = { ...newUser, password: hashedPassword } as any;
    
    // Create user profile
    const profile: UserProfile = {
      id: userId,
      name: metadata?.name || email.split('@')[0],
      onboarding_completed: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    profilesDB[userId] = profile;
    
    // Save to storage
    await saveDatabases();
    
    console.log('User created successfully:', userId);
    
    return {
      data: { user: { ...newUser, profile } },
      error: null
    };
  } catch (error) {
    console.error('Sign up error:', error);
    return {
      data: null,
      error: { message: 'Failed to create account', details: error }
    };
  }
}

export async function signIn(email: string, password: string): Promise<AuthResponse> {
  try {
    console.log('Signing in user:', email);
    
    // Find user by email
    const user = Object.values(usersDB).find(user => user.email === email) as any;
    if (!user) {
      return {
        data: null,
        error: { message: 'Invalid email or password' }
      };
    }
    
    // Verify password
    if (!verifyPassword(password, user.password)) {
      return {
        data: null,
        error: { message: 'Invalid email or password' }
      };
    }
    
    // Get user profile
    const profile = profilesDB[user.id];
    
    // Create clean user object (without password)
    const cleanUser: User = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
      subscription_tier: user.subscription_tier,
      profile,
    };
    
    // Store session
    await AsyncStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({
      user: cleanUser,
      timestamp: Date.now(),
    }));
    
    console.log('User signed in successfully:', user.id);
    
    return {
      data: { user: cleanUser },
      error: null
    };
  } catch (error) {
    console.error('Sign in error:', error);
    return {
      data: null,
      error: { message: 'Failed to sign in', details: error }
    };
  }
}

export async function signOut(): Promise<{ error: AuthError | null }> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.SESSION);
    console.log('User signed out successfully');
    return { error: null };
  } catch (error) {
    console.error('Sign out error:', error);
    return { error: { message: 'Failed to sign out', details: error } };
  }
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const sessionData = await AsyncStorage.getItem(STORAGE_KEYS.SESSION);
    if (!sessionData) return null;
    
    const session = JSON.parse(sessionData);
    
    // Check if session is still valid (24 hours)
    const isExpired = Date.now() - session.timestamp > 24 * 60 * 60 * 1000;
    if (isExpired) {
      await AsyncStorage.removeItem(STORAGE_KEYS.SESSION);
      return null;
    }
    
    return session.user;
  } catch (error) {
    console.error('Get current user error:', error);
    return null;
  }
}

export async function getUserProfile(userId: string): Promise<{ data: UserProfile | null; error: AuthError | null }> {
  try {
    const profile = profilesDB[userId] || null;
    return { data: profile, error: null };
  } catch (error) {
    console.error('Get user profile error:', error);
    return { data: null, error: { message: 'Failed to get profile', details: error } };
  }
}

export async function updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<{ data: UserProfile | null; error: AuthError | null }> {
  try {
    const existingProfile = profilesDB[userId];
    if (!existingProfile) {
      return { data: null, error: { message: 'Profile not found' } };
    }
    
    const updatedProfile: UserProfile = {
      ...existingProfile,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    
    profilesDB[userId] = updatedProfile;
    
    // Also update user name if provided
    if (updates.name && usersDB[userId]) {
      (usersDB[userId] as any).name = updates.name;
    }
    
    await saveDatabases();
    
    return { data: updatedProfile, error: null };
  } catch (error) {
    console.error('Update user profile error:', error);
    return { data: null, error: { message: 'Failed to update profile', details: error } };
  }
}

export async function resetPassword(email: string): Promise<{ data: any; error: AuthError | null }> {
  try {
    // Find user by email
    const user = Object.values(usersDB).find(user => user.email === email);
    if (!user) {
      return { data: null, error: { message: 'No user found with this email' } };
    }
    
    // In a real app, you would send an email with a reset link
    // For demo purposes, we'll just log a message
    console.log('Password reset requested for:', email);
    
    return {
      data: { message: 'Password reset instructions sent to your email' },
      error: null
    };
  } catch (error) {
    console.error('Reset password error:', error);
    return { data: null, error: { message: 'Failed to reset password', details: error } };
  }
}

export async function updatePassword(newPassword: string): Promise<{ data: any; error: AuthError | null }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { data: null, error: { message: 'User not authenticated' } };
    }
    
    const hashedPassword = hashPassword(newPassword);
    (usersDB[currentUser.id] as any).password = hashedPassword;
    
    await saveDatabases();
    
    return { data: { message: 'Password updated successfully' }, error: null };
  } catch (error) {
    console.error('Update password error:', error);
    return { data: null, error: { message: 'Failed to update password', details: error } };
  }
}

// Google Sign In (mock implementation)
export async function signInWithGoogle(): Promise<AuthResponse> {
  try {
    // Mock Google sign in - in a real app you'd use proper OAuth
    if (Platform.OS === 'web') {
      // For web, you could integrate with Google OAuth
      return {
        data: null,
        error: { message: 'Google Sign-In not configured for web. Please use email/password.' }
      };
    } else {
      // For mobile, you'd use expo-auth-session or similar
      return {
        data: null,
        error: { message: 'Google Sign-In not configured for mobile. Please use email/password.' }
      };
    }
  } catch (error) {
    console.error('Google sign in error:', error);
    return {
      data: null,
      error: { message: 'Google Sign-In failed', details: error }
    };
  }
}

// Session management
export async function refreshSession(): Promise<{ data: any; error: AuthError | null }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return { data: null, error: { message: 'No active session' } };
    }
    
    // Update session timestamp
    await AsyncStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({
      user: currentUser,
      timestamp: Date.now(),
    }));
    
    return { data: { user: currentUser }, error: null };
  } catch (error) {
    console.error('Refresh session error:', error);
    return { data: null, error: { message: 'Failed to refresh session', details: error } };
  }
}

export async function getSession(): Promise<{ data: any; error: AuthError | null }> {
  try {
    const currentUser = await getCurrentUser();
    return { data: { session: currentUser ? { user: currentUser } : null }, error: null };
  } catch (error) {
    console.error('Get session error:', error);
    return { data: null, error: { message: 'Failed to get session', details: error } };
  }
}

// Test connection (always succeeds for local auth)
export async function testAuthConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('Testing local auth connection...');
    await AsyncStorage.getItem(STORAGE_KEYS.SESSION);
    console.log('Local auth connection test successful');
    return { success: true };
  } catch (error) {
    console.error('Local auth connection test error:', error);
    return { success: false, error: 'Connection failed' };
  }
}

// Create demo user for testing
export async function createDemoUser(): Promise<AuthResponse> {
  const demoEmail = 'demo@glowcheck.com';
  const demoPassword = 'demo123456';
  const demoName = 'Demo User';
  
  try {
    console.log('Creating demo user...');
    
    // Check if demo user already exists
    const existingUser = Object.values(usersDB).find(user => user.email === demoEmail);
    if (existingUser) {
      console.log('Demo user already exists, signing in...');
      return await signIn(demoEmail, demoPassword);
    }
    
    const result = await signUp(demoEmail, demoPassword, { name: demoName });
    console.log('Demo user created successfully');
    return result;
  } catch (error) {
    console.error('Demo user creation failed:', error);
    return { data: null, error: { message: 'Failed to create demo user', details: error } };
  }
}

// Auth state change listener (mock implementation)
type AuthStateChangeCallback = (event: string, session: any) => void;

let authListeners: AuthStateChangeCallback[] = [];

export const auth = {
  onAuthStateChange: (callback: AuthStateChangeCallback) => {
    authListeners.push(callback);
    
    // Return unsubscribe function
    return {
      subscription: {
        unsubscribe: () => {
          authListeners = authListeners.filter(listener => listener !== callback);
        }
      }
    };
  }
};

// Trigger auth state change events
const triggerAuthStateChange = async (event: string, user?: User | null) => {
  const session = user ? { user } : null;
  authListeners.forEach(callback => {
    try {
      callback(event, session);
    } catch (error) {
      console.error('Auth state change callback error:', error);
    }
  });
};

// Override sign in to trigger state change
const originalSignIn = signIn;
export const signInWithStateChange = async (email: string, password: string): Promise<AuthResponse> => {
  const result = await originalSignIn(email, password);
  if (result.data?.user) {
    await triggerAuthStateChange('SIGNED_IN', result.data.user);
  }
  return result;
};

// Override sign out to trigger state change
const originalSignOut = signOut;
export const signOutWithStateChange = async (): Promise<{ error: AuthError | null }> => {
  const result = await originalSignOut();
  if (!result.error) {
    await triggerAuthStateChange('SIGNED_OUT', null);
  }
  return result;
};

// Export the auth object with state change methods
export const authService = {
  signUp,
  signIn: signInWithStateChange,
  signOut: signOutWithStateChange,
  getCurrentUser,
  getUserProfile,
  updateUserProfile,
  resetPassword,
  updatePassword,
  signInWithGoogle,
  refreshSession,
  getSession,
  testAuthConnection,
  createDemoUser,
  auth,
};