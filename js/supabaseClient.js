// supabaseClient.js — single shared Supabase client for the whole app.
// URL/anon key are safe to expose publicly: access control is enforced by
// Row Level Security policies tied to the authenticated user, not by secrecy of these values.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export const SUPABASE_URL = 'https://qetzbuflpewphainmvxj.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_nLZJBK6j0OwCoN186XVjqg_clsfXo99';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
