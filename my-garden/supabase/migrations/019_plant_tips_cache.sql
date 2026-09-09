-- 019_plant_tips_cache.sql
-- Plant Tips (propagation method/season, pruning season, ideal temp range)
-- are general species knowledge — the same answer for every plant of a
-- given species regardless of whose garden it's in. Cached here by a
-- normalized species key so a repeat lookup (a common houseplant asked
-- about across many users, or the same plant reopened many times) costs
-- one Mistral call total, not one per lookup.
--
-- The client never reads or writes this table directly — only the
-- plant-tips Edge Function does, via its own service-role key. RLS is on
-- with no policies at all, so it's unreachable from the browser; per the
-- service-role grant gap this project has hit twice already (billing_customers,
-- care_items), the explicit grant below is what actually makes the
-- service-role key's reads/writes work, not RLS bypass alone.

create table if not exists plant_tips_cache (
  species_key text primary key,
  propagation_method text not null,
  propagation_season text not null,
  pruning_season text not null,
  ideal_temp_range text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table plant_tips_cache enable row level security;

grant select, insert on plant_tips_cache to service_role;
