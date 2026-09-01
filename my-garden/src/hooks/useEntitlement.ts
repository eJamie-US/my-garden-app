// src/hooks/useEntitlement.ts
import { create } from 'zustand';
import { billingService, isActive, type Entitlement } from '../services/supabase/billing';

/** Plants a free-plan account can have before Add Plant asks for an upgrade. */
export const FREE_PLANT_LIMIT = 10;

interface EntitlementState {
  entitlement: Entitlement;
  loading: boolean;
  fetchForUser: (userId: string) => Promise<void>;
}

export const useEntitlement = create<EntitlementState>((set) => ({
  entitlement: { plan: 'free', status: null, currentPeriodEnd: null },
  loading: false,

  fetchForUser: async (userId: string) => {
    set({ loading: true });
    try {
      const entitlement = await billingService.getEntitlement(userId);
      set({ entitlement, loading: false });
    } catch (err) {
      console.error('Could not load billing status:', err);
      set({ loading: false });
    }
  },
}));

export function useIsPremium(): boolean {
  return useEntitlement((s) => isActive(s.entitlement));
}
