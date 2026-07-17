import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseSecretKey) {
  console.warn('Supabase env vars are missing (SUPABASE_URL / SUPABASE_SECRET_KEY)');
}

export const supabase = createClient(supabaseUrl, supabaseSecretKey);
