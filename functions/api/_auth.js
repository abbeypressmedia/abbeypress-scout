import { createClient } from "@supabase/supabase-js";

const enc = new TextEncoder();

function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function unb64url(value) {
  const s = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const bin = atob(s);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}
export async function signState(uid, secret) {
  const payload = b64url(enc.encode(JSON.stringify({uid,exp:Date.now()+10*60*1000,nonce:crypto.randomUUID()})));
  return payload+"."+b64url(await hmac(secret,payload));
}
export async function verifyState(state, secret) {
  const [payload,sig] = String(state||"").split(".");
  if (!payload || !sig) throw new Error("Invalid OAuth state");
  const expected = await hmac(secret,payload);
  const got = unb64url(sig);
  if (got.length!==expected.length) throw new Error("Invalid OAuth state");
  let diff=0;
  for(let i=0;i<got.length;i++) diff|=got[i]^expected[i];
  if(diff) throw new Error("Invalid OAuth state");
  const data=JSON.parse(new TextDecoder().decode(unb64url(payload)));
  if (!data.uid || !data.exp || data.exp<Date.now()) throw new Error("OAuth state expired");
  return data;
}
export async function getUser(request, env) {
  const auth=request.headers.get("Authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):null;
  if(!token) throw new Error("Unauthorized");
  const sb=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY);
  const {data,error}=await sb.auth.getUser(token);
  if(error||!data.user) throw new Error("Unauthorized");
  return {sb,user:data.user};
}
export const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
export const html=(status,body)=>new Response(body,{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
export const method=(request,name)=>request.method===name;