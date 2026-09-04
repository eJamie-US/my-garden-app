// src/hooks/useAuth.ts

import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { AuthState, User } from '../types';

interface AuthStore extends AuthState {
  /** True while the current session came from a password-reset email link
   *  rather than a normal sign-in — the app shows "choose a new password"
   *  instead of the regular UI until updatePassword resolves it. */
  passwordRecovery: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  /** Emails a reset link. Always resolves without revealing whether the
   *  address has an account — Supabase itself stays silent on that too. */
  requestPasswordReset: (email: string) => Promise<void>;
  /** Sets a new password for the recovery session opened by that email
   *  link, then clears passwordRecovery so the app proceeds normally. */
  updatePassword: (newPassword: string) => Promise<void>;
  /** Wires up the one listener that detects a password-recovery link —
   *  call once, e.g. from App's top-level mount effect. */
  listenForPasswordRecovery: () => () => void;
}

export const useAuth = create<AuthStore>((set) => ({
  user: null,
  loading: true,
  error: null,
  passwordRecovery: false,

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

  // These two deliberately don't touch `loading` — that flag also gates
  // the whole app's top-level render (App.tsx: `if (loading) return
  // <spinner>`), so setting it here would unmount the very form showing
  // the result, wiping out the "check your email" confirmation before it
  // could ever be seen. Callers track their own submitting state instead.
  requestPasswordReset: async (email: string) => {
    set({ error: null });
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not send that reset link' });
      throw err;
    }
  },

  updatePassword: async (newPassword: string) => {
    set({ error: null });
    try {
      const { data, error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      set({
        user: data.user
          ? { id: data.user.id, email: data.user.email || '', createdAt: data.user.created_at }
          : null,
        passwordRecovery: false,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not update your password' });
      throw err;
    }
  },

  listenForPasswordRecovery: () => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') set({ passwordRecovery: true });
      if (event === 'SIGNED_OUT') set({ passwordRecovery: false });
    });
    return () => subscription.subscription.unsubscribe();
  },
}));