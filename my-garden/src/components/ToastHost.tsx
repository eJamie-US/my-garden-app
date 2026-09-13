// src/components/ToastHost.tsx
// Mounted once at the app root (see App.tsx), same "always-mounted, reads
// its own global state" shape as UpdatePrompt — renders whatever's
// currently in useToast's queue, each with an optional action button (used
// today for "Undo" right after completing a care task).

import { useToast } from '../hooks/useToast';

export function ToastHost() {
  const { toasts, dismiss } = useToast();

  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[90] flex flex-col items-center gap-2 p-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-xl"
        >
          <p className="text-sm text-gray-700">{toast.message}</p>
          {toast.onAction && (
            <button
              type="button"
              onClick={() => {
                toast.onAction?.();
                dismiss(toast.id);
              }}
              className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
