import { getUser, json } from "../../_auth.js";

export async function onRequestPost({request,env,params}){
  try{
    const {sb,user}=await getUser(request,env);
    const {data:c,error:ce}=await sb.from("campaigns").select("id,list_id").eq("id",params.id).eq("user_id",user.id).single();
    if(ce||!c) return json(404,{error:"Campaign not found"});

    const {error}=await sb.from("campaigns").update({
      status:"stopped",next_send_at:null,last_error:null,updated_at:new Date().toISOString()
    }).eq("id",c.id).eq("user_id",user.id);

    if(error) throw error;
    const {data:links}=await sb.from("campaign_senders").select("sender_id").eq("campaign_id",c.id);
    const senderIds=(links||[]).map(x=>x.sender_id);
    if(senderIds.length){
      await sb.from("sender_accounts").update({lease_until:null,updated_at:new Date().toISOString()}).in("id",senderIds);
    }

    return json(200,{ok:true});
  }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}
