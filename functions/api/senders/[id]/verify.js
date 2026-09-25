import { getUser, json } from "../_auth.js";
import { makeServiceClient, verifySenderConnection } from "../_engine.js";

export async function onRequestPost({request,env,params}){
  try{
    const {sb,user}=await getUser(request,env);
    const {data:sender,error}=await sb.from("sender_accounts")
      .select("id,email,status,refresh_token")
      .eq("id",params.id).eq("user_id",user.id).single();
    if(error||!sender) return json(404,{error:"Sender not found"});
    if(!sender.refresh_token) return json(400,{error:"This sender needs to be reconnected to Google."});
    const profile=await verifySenderConnection(env,sender.refresh_token);
    await sb.from("sender_accounts").update({
      status:"connected",
      updated_at:new Date().toISOString()
    }).eq("id",sender.id).eq("user_id",user.id);
    return json(200,{ok:true,email:profile.email});
  }catch(e){
    return json(e.message==="Unauthorized"?401:400,{error:e.message});
  }
}
