// One file. Every page imports this.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key'
);