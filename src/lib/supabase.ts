import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

/**
 * Service-role client. This bypasses RLS, which is correct for a trusted backend
 * and is why silent insert failures stop happening once you move off the publishable key.
 * Never ship this key to the browser.
 */
export const db = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});
