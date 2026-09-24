export function onRequestGet(context) {
  const supabaseUrl = context.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = context.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json(
      { error: "Supabase runtime secrets are not configured." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  return Response.json(
    { supabaseUrl, supabaseAnonKey },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
