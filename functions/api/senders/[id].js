import { getUser, json } from "../_auth.js";

export async function onRequestPatch({request,env,params}){
  try{
    const {sb,user}=await getUser(request,env);
    const {dailyLimit}=await request.json();
    const value=Number(dailyLimit);
    if(!Number.isInteger(value)||value<1||value>500) return json(400,{error:"Daily cap must be between 1 and 500"});
    const {data,error}=await sb.from("sender_accounts").update({
      daily_limit:value,updated_at:new Date().toISOString()
    }).eq("id",params.id).eq("user_id",user.id).select("id,email,daily_limit,sent_today,status").single();
    if(error) throw error;
    return json(200,{sender:data});
  }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}

export async function onRequestDelete({request,env,params}){
  try{
    const {sb,user}=await getUser(request,env);
    const {data,error}=await sb.from("sender_accounts").update({
      status:"disconnected",lease_until:null,updated_at:new Date().toISOString()
    }).eq("id",params.id).eq("user_id",user.id).select("id,email,status").single();
    if(error) throw error;
    return json(200,{ok:true,sender:data});
  }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}
