import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseConfigurationError =
  Boolean(supabaseUrl) !== Boolean(publishableKey)
    ? "Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable Supabase authentication."
    : null;

export const supabaseClient =
  supabaseUrl && publishableKey
    ? createClient(supabaseUrl, publishableKey)
    : null;
