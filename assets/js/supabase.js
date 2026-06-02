// Supabase client configuration
// Replace with your actual Supabase URL and anon key

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://urbknpraebzcsadjskop.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyYmtucHJhZWJ6Y3NhZGpza29wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMDMwNjgsImV4cCI6MjA5NTg3OTA2OH0.tx5roEGaVJEQvV1GDjpLbvF1KqGFHmmpPa41Z2Geelw';


export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);