// src/components/UpdatePrompt.tsx
// A new deploy going live used to force-reload the page the instant the
// service worker noticed it — including mid-interaction, silently losing
// anything unsaved (e.g. a yard obstacle being drawn). This instead surfaces
// a small, dismissible banner and lets the person choose when to reload.

import { useTranslation } from 'react-i18next';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: (error) => console.error('Service worker registration failed:', error),
  });

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex justify-center p-4">
      <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-xl">
        <p className="text-sm text-gray-700">
          {t('updatePrompt.message')}
        </p>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          <RefreshCw size={12} /> {t('updatePrompt.reload')}
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          aria-label={t('updatePrompt.dismiss')}
          className="shrink-0 text-gray-400 hover:text-gray-600"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
