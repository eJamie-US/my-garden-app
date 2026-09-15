// supabase/functions/_shared/mistralThrottle.ts
// Confirmed live on the account's own Limits page (console.mistral.ai):
// mistral-small — used by both plant-tips and ai-seed-plan — is capped at
// 1 request/second AND 20,000 tokens/minute on this free-tier key. The
// request-rate number alone is generous enough to be a non-issue; the
// token number is the one that actually bites: plant-tips' structured
// response (propagation method/season, pruning season, temp range, notes,
// plus a full seasonal-tasks array with a note per task) plausibly costs
// 1,000+ tokens a call, which caps real throughput at roughly 15-20
// calls/minute — nowhere near 60. Pacing by request-rate alone (the
// original version of this file) still let requests through fast enough
// to blow through the token ceiling, which is exactly what a live 429 on
// a single, cleanly-spaced request (confirmed via the function logs)
// turned out to mean.
//
// This still isn't real token-bucket accounting (that would need to read
// each response's actual usage.total_tokens and track a rolling window —
// more machinery than a hobby app's traffic needs) — just a fixed spacing
// wide enough to comfortably clear the known per-minute ceiling for a
// worst-case-sized call. plant-tips, ai-seed-plan, and ai-plant-diagnosis
// share this one queue (separate Edge Functions, no shared memory, so a
// shared external gate is required) via mistral_rate_limiter (migration
// 033) — reserve_mistral_slot atomically claims the next spaced-out slot,
// and this waits out whatever's left of it before letting the caller
// actually hit Mistral.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// 20,000 tokens/minute ÷ ~1,300 tokens (a generous per-call estimate for
// plant-tips' richest possible response) ≈ 15 calls/minute ≈ one every 4s.
const MIN_INTERVAL_MS = 4000;
// A slot further out than this means a real backlog, not just this one
// call arriving a beat too soon — waiting that long would hang the
// request for no good reason, so the caller bails out and returns its own
// rate-limited response instead of actually calling Mistral. Sized with
// headroom above useSeasonalTasks.ts's own client-side batching (which
// keeps any single burst small regardless of yard size) — this is a
// backstop for everything else sharing the same queue at the same moment,
// not the primary defense against a large burst.
const MAX_WAIT_MS = 15000;

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
