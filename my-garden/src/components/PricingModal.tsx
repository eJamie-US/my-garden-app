// src/components/PricingModal.tsx
// Upgrade prompt: three plan cards, each a Stripe Checkout redirect.
// Prices shown here are DISPLAY TEXT ONLY — the amount actually charged
// comes from the Stripe Price object behind STRIPE_PRICE_* (see
// supabase/functions/_shared/plans.ts). Update both together if pricing
// changes in the Stripe dashboard.

import { useState } from 'react';
import { Check, Loader2, Sparkles, X } from 'lucide-react';
import { billingService, type PlanId } from '../services/supabase/billing';

interface PlanCard {
  id: PlanId;
  name: string;
  price: string;
  cadence: string;
  blurb?: string;
}

const PLANS: PlanCard[] = [
  { id: 'premium-monthly', name: 'Premium', price: '$4.99', cadence: '/month' },
  {
    id: 'premium-yearly',
    name: 'Premium',
    price: '$39.99',
    cadence: '/year',
    blurb: 'Best value — about $3.33/month',
  },
  { id: 'lifetime', name: 'Lifetime', price: '$99', cadence: 'once' },
];

const PREMIUM_FEATURES = [
  'Unlimited plants (free plan is capped)',
  'AI species ID from a photo',
  'AI sowing plans for seeds',
];

interface PricingModalProps {
  reason?: string;
  onClose: () => void;
}

export function PricingModal({ reason, onClose }: PricingModalProps) {
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState('');

  const choose = async (plan: PlanId) => {
    setBusy(plan);
    setError('');
    try {
      await billingService.startCheckout(plan);
      // Browser is navigating away to Stripe — nothing else to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b p-4">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <Sparkles size={18} className="text-emerald-600" /> Upgrade to Premium
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Close upgrade options"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {reason && (
            <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              {reason}
            </p>
          )}

          <ul className="space-y-1.5">
            {PREMIUM_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                {f}
              </li>
            ))}
          </ul>

          {error && (
            <div className="rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
              {error}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            {PLANS.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => choose(plan.id)}
                disabled={busy !== null}
                className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 p-3 text-center hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-60"
              >
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {plan.name}
                </span>
                <span className="text-xl font-bold text-gray-900">{plan.price}</span>
                <span className="text-xs text-gray-500">{plan.cadence}</span>
                {plan.blurb && <span className="text-[11px] text-emerald-700">{plan.blurb}</span>}
                <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  {busy === plan.id && <Loader2 size={12} className="animate-spin" />}
                  Choose
                </span>
              </button>
            ))}
          </div>

          <p className="text-center text-xs text-gray-400">
            Have a promo code? There&apos;s a spot for it on the checkout page.
          </p>
        </div>
      </div>
    </div>
  );
}
