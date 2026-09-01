// src/hooks/useAuth.ts

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { AuthState, User } from '../types';

interface AuthStore extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuth = create<AuthStore>((set) => ({
  user: null,
  loading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      if (data.user) {
        set({
          user: {
            id: data.user.id,
            email: data.user.email || '',
            createdAt: data.user.created_at,
          },
          loading: false,
        });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Login failed',
        loading: false,
      });
      throw err;
    }
  },

  signup: async (email: string, password: string) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) throw error;
      if (data.user) {
        set({
          user: {
            id: data.user.id,
            email: data.user.email || '',
            createdAt: data.user.created_at,
          },
          loading: false,
        });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Signup failed',
        loading: false,
      });
      throw err;
    }
  },

  logout: async () => {
    set({ loading: true, error: null });
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      set({ user: null, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Logout failed',
        loading: false,
      });
      throw err;
    }
  },

  checkAuth: async () => {
    set({ loading: true });
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (data.session?.user) {
        set({
          user: {
            id: data.session.user.id,
            email: data.session.user.email || '',
            createdAt: data.session.user.created_at,
          },
          loading: false,
        });
      } else {
        set({ user: null, loading: false });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Auth check failed',
        loading: false,
      });
    }
  },
}));