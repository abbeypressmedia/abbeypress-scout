import { getUser, json, signState } from "./_auth.js";
export async function onRequestGet({request,env}) {
  try {
    const {user}=await getUser(request,env);
    const state=await signState(user.id,env.GOOGLE_CLIENT_SECRET);
    const u=new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id",env.GOOGLE_CLIENT_ID);
    u.searchParams.set("redirect_uri",env.GOOGLE_REDIRECT_URI);
    u.searchParams.set("response_type","code");
    u.searchParams.set("access_type","offline");
    u.searchParams.set("prompt","consent");
    u.searchParams.set("state",state);
    u.searchParams.set("scope","https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email openid");
    return json(200,{url:u.toString()});
  } catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}