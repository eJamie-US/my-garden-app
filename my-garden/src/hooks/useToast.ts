// src/hooks/useToast.ts
// A minimal, generic toast queue — not care-specific, just the small piece
// of app-wide infrastructure this app didn't have yet. Each toast auto-
// dismisses on its own timer; dismissing early (or the action firing) just
// clears that timer. Deliberately not a library: this is the entire need.

import { create } from 'zustand';

export interface ToastEntry {
  id: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastState {
  toasts: ToastEntry[];
  show: (toast: { message: string; actionLabel?: string; onAction?: () => void; duration?: number }) => string;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION_MS = 6000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],

  show: ({ message, actionLabel, onAction, duration = DEFAULT_DURATION_MS }) => {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, message, actionLabel, onAction }] });
    timers.set(
      id,
      setTimeout(() => get().dismiss(id), duration),
    );
    return id;
  },

  dismiss: (id: string) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
