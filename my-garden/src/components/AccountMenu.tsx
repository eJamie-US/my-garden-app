// src/components/AccountMenu.tsx
// A compact overlay for the banner corner: an avatar + email that expands
// into "set location" / "log out" on click, instead of a permanent header
// bar competing with the yard for space.

import { useState } from 'react';
import { CreditCard, LogOut, MapPin, Sparkles, UserCircle } from 'lucide-react';
import type { Plan } from '../services/supabase/billing';

interface AccountMenuProps {
  email: string;
  displayName?: string;
  avatarIcon?: string;
  locationLabel?: string;
  plan: Plan;
  onSetLocation: () => void;
  onEditProfile: () => void;
  /** Free plan: opens the pricing modal. Paying plan: opens Stripe's billing portal. */
  onBilling: () => void;
  onLogout: () => void;
}

const PLAN_LABEL: Record<Plan, string> = {
  free: 'Free plan',
  premium: 'Premium',
  lifetime: 'Lifetime',
};

export function AccountMenu({
  email,
  displayName,
  avatarIcon,
  locationLabel,
  plan,
  onSetLocation,
  onEditProfile,
  onBilling,
  onLogout,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const initial = (displayName || email).trim().charAt(0).toUpperCase() || '?';
  const name = displayName || email;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full bg-black/35 py-1 pl-1 pr-3 text-white shadow backdrop-blur-sm transition hover:bg-black/45"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold">
          {avatarIcon || initial}
        </span>
        <span className="max-w-[9rem] truncate text-xs font-semibold">{name}</span>
      </button>

      {open && (
        <>
          {/* Click-away catcher */}
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-1.5 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="border-b border-gray-100 px-3 py-2">
              {displayName && (
                <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
              )}
              <p className="truncate text-xs text-gray-500">{email}</p>
              <span
                className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  plan === 'free' ? 'bg-gray-100 text-gray-500' : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {PLAN_LABEL[plan]}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onEditProfile();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <UserCircle size={14} className="shrink-0 text-emerald-600" />
              Edit profile
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onBilling();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              {plan === 'free' ? (
                <Sparkles size={14} className="shrink-0 text-emerald-600" />
              ) : (
                <CreditCard size={14} className="shrink-0 text-emerald-600" />
              )}
              {plan === 'free' ? 'Upgrade' : 'Manage billing'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onSetLocation();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              <MapPin size={14} className="shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate">{locationLabel ?? 'Set garden location'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
            >
              <LogOut size={14} />
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
