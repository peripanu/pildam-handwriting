import { createHandler } from './handler.mjs';
const env = Object.fromEntries(['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GOOGLE_VISION_API_KEY','CLASS_CODE','TEACHER_CODE','SESSION_SECRET','APP_ORIGIN'].map(key=>[key,Deno.env.get(key)||'']));
let keys: Record<string,string> = {};
try { keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); } catch { /* legacy compatibility */ }
env.SUPABASE_SERVICE_ROLE_KEY = keys.default || env.SUPABASE_SERVICE_ROLE_KEY;
Deno.serve(createHandler(env));
