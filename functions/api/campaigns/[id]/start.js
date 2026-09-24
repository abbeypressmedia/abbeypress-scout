import { getUser, json } from "../../_auth.js";
export async function onRequestPost({request,env,params}){
 try{
  const {sb,user}=await getUser(request,env);
  const {data:c,error:ce}=await sb.from("campaigns").select("id,list_id").eq("id",params.id).eq("user_id",user.id).single();
  if(ce||!c) return json(404,{error:"Campaign not found"});
  const [{data:senders},{data:list}]=await Promise.all([
    sb.from("campaign_senders").select("sender_id").eq("campaign_id",params.id),
    sb.from("prospects").select("id").eq("list_id",c.list_id).eq("status","ready").limit(1)
  ]);
  if(!senders?.length) return json(400,{error:"Campaign has no senders"});
  if(!list?.length) return json(400,{error:"Prospect list has no ready prospects"});
  const {error}=await sb.from("campaigns").update({status:"running",updated_at:new Date().toISOString()}).eq("id",params.id).eq("user_id",user.id);
  if(error) throw error;
  return json(200,{ok:true});
 }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}