// supabase/functions/_shared/mistralThrottle.ts
// Mistral's free/default tier allows only 1 request per second — an
// account-wide limit that plant-tips, ai-seed-plan, and ai-plant-diagnosis
// can each independently trip, since they're three separate Edge Functions
// (separate Deno isolates, no shared memory). mistral_rate_limiter
// (migration 033) is a single-row table used as a shared "next available
// slot" ticket dispenser: reserve_mistral_slot atomically claims the next
// spaced-out slot, and this waits out whatever's left of it before letting
// the caller actually hit Mistral.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// A hair over Mistral's raw 1000ms boundary, for clock-skew safety margin.
const MIN_INTERVAL_MS = 1100;
// A slot further out than this means a real backlog, not just this one
// call arriving a beat too soon — waiting that long would hang the
// request for no good reason, so the caller bails out and returns its own
// rate-limited response instead of actually calling Mistral.
const MAX_WAIT_MS = 8000;

/** Waits until it's this call's turn to hit Mistral. Returns false when
 *  the queue is backed up too far to reasonably wait for — the caller
 *  should return its own rate-limited response in that case rather than
 *  calling Mistral at all. */
export async function waitForMistralSlot(): Promise<boolean> {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: slot, error } = await admin.rpc('reserve_mistral_slot', {
    min_interval_ms: MIN_INTERVAL_MS,
  });

  if (error) {
    // The throttle itself failing shouldn't block the actual feature —
    // fall through and let Mistral's own rate limit be the backstop.
    console.error('Mistral throttle reservation failed', error);
    return true;
  }

  const waitMs = new Date(slot as string).getTime() - Date.now();
  if (waitMs > MAX_WAIT_MS) return false;
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  return true;
}
