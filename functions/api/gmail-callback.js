import { createClient } from "@supabase/supabase-js";
import { html, verifyState } from "./_auth.js";

async function tokenRequest(env,code){
  const body=new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:env.GOOGLE_REDIRECT_URI,grant_type:"authorization_code"});
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error_description||data.error||"Google token exchange failed");
  return data;
}

async function userInfoRequest(accessToken){
  const r=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{
    headers:{Authorization:`Bearer ${accessToken}`}
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error_description||data.error||"Could not read Google account profile");
  return data;
}

export async function onRequestGet({request,env}){
  try{
    const u=new URL(request.url), code=u.searchParams.get("code"), state=u.searchParams.get("state");
    if(!code||!state) return html(400,"<p>Missing OAuth response.</p>");

    const {uid}=await verifyState(state,env.GOOGLE_CLIENT_SECRET);
    const tokens=await tokenRequest(env,code);
    if(!tokens.refresh_token) return html(400,"<p>Google did not return a refresh token. Reauthorize this account.</p>");

    const profile=await userInfoRequest(tokens.access_token);
    if(!profile.email || !profile.sub) throw new Error("Could not read Google account identity");

    const sb=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
    const {error}=await sb.from("sender_accounts").upsert({
      user_id:uid,
      email:profile.email,
      google_subject:profile.sub,
      refresh_token:tokens.refresh_token,
      status:"connected",
      updated_at:new Date().toISOString()
    },{onConflict:"user_id,google_subject"});
    if(error) throw error;

    const target=env.APP_URL||new URL(request.url).origin;
    return html(200,`<html><body><script>window.opener?window.opener.postMessage("Gmail connected","*"):null;setTimeout(()=>window.location.href=${JSON.stringify(target)},700);</script><p>Gmail connected. This window will close.</p></body></html>`);
  }catch(e){
    return html(400,`<p>Connection failed: ${String(e.message).replace(/[<>&]/g,m=>({"<":"&lt;",">":"&gt;","&":"&amp;"}[m]))}</p>`);
  }
}
