const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const supabaseUrl = process.env.SUPABASE_URL;
// Use the service_role key on the backend so RLS policies don't block server-side reads/writes.
// This key must never be shipped to a frontend/browser build.
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(
    supabaseUrl,
    supabaseKey,
    {
        realtime: {
            transport: WebSocket
        }
    }
);

module.exports = supabase;