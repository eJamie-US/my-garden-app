// src/components/GrantAccessModal.tsx
// Owner-only tool (enforced server-side by supabase/functions/grant-access
// via the OWNER_EMAIL secret) for comping a friend's account to Premium or
// Lifetime so they can try the app without a Stripe checkout.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, UserPlus, X } from 'lucide-react';
import { billingService, type Plan } from '../services/supabase/billing';

interface GrantAccessModalProps {
  onClose: () => void;
}

export function GrantAccessModal({ onClose }: GrantAccessModalProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<Plan>('lifetime');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const planLabel: Record<Plan, string> = {
    lifetime: t('grantAccessModal.planLifetime'),
    premium: t('grantAccessModal.planPremium'),
    free: t('grantAccessModal.planFreeRevoke'),
  };

  const grant = async () => {
    if (!email.trim()) return;
    setSaving(true);
    setError('');
    setDone('');
    try {
      await billingService.grantAccess(email.trim(), plan);
      setDone(t('grantAccessModal.done', { email: email.trim(), plan: planLabel[plan] }));
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('grantAccessModal.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-sm flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <UserPlus size={18} className="text-emerald-600" /> {t('grantAccessModal.title')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label={t('grantAccessModal.close')}
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-sm text-gray-600">
            {t('grantAccessModal.description')}
          </p>

          {error && (
            <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
              {error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">
              <Check size={15} className="shrink-0" /> {done}
            </div>
          )}

          <div>
            <label htmlFor="grant-email" className="mb-1 block text-sm font-medium text-gray-700">
              {t('grantAccessModal.emailLabel')}
            </label>
            <input
              id="grant-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('grantAccessModal.emailPlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label htmlFor="grant-plan" className="mb-1 block text-sm font-medium text-gray-700">
              {t('grantAccessModal.planLabel')}
            </label>
            <select
              id="grant-plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value as Plan)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
            >
              <option value="lifetime">{planLabel.lifetime}</option>
              <option value="premium">{planLabel.premium}</option>
              <option value="free">{planLabel.free}</option>
            </select>
          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t p-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t('grantAccessModal.closeButton')}
          </button>
          <button
            type="button"
            onClick={grant}
            disabled={!email.trim() || saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-500 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:bg-gray-400"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t('grantAccessModal.grant')}
          </button>
        </div>
      </div>
    </div>
  );
}
