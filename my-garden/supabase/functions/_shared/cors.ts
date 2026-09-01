// Shared CORS headers for Edge Functions called directly from the browser.
// The functions are invoked with the caller's Supabase session (see
// supabase.functions.invoke on the client), not a public/open endpoint —
// this only handles the browser's preflight, it isn't the auth boundary.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};
