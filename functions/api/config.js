const BUILD_VERSION="2026-09-25-engine-v2";

export function onRequestGet(context) {
  const supabaseUrl = context.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = context.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json(
      { error: "Supabase runtime configuration is not available.", buildVersion: BUILD_VERSION },
      { status: 500, headers: { "Cache-Control": "no-store", "X-Mailflow-Build": BUILD_VERSION } }
    );
  }

  return Response.json(
    { supabaseUrl, supabaseAnonKey, buildVersion: BUILD_VERSION },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Mailflow-Build": BUILD_VERSION
      }
    }
  );
}
