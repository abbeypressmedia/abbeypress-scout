import { getUser, json } from "../../_auth.js";
import { processCampaign } from "../../_engine.js";

export async function onRequestPost({request,env,params}){
  try{
    const {sb,user}=await getUser(request,env);
    const {data:c,error:ce}=await sb.from("campaigns").select("id,list_id,status").eq("id",params.id).eq("user_id",user.id).single();
    if(ce||!c) return json(404,{error:"Campaign not found"});
    if(c.status==="stopped"||c.status==="completed") return json(400,{error:"This campaign cannot be resumed. Create a new campaign for the list."});

    const [{data:senders,error:se},{data:list,error:le},{data:messages,error:me}]=await Promise.all([
      sb.from("campaign_senders").select("sender_id").eq("campaign_id",params.id),
      sb.from("prospects").select("id").eq("list_id",c.list_id).in("status",["ready","queued"]).limit(1),
      sb.from("campaign_messages").select("id").eq("campaign_id",params.id).eq("active",true).limit(1)
    ]);
    if(se) throw se;if(le) throw le;if(me) throw me;
    if(!senders?.length) return json(400,{error:"Campaign has no selected senders"});
    if(!list?.length) return json(400,{error:"Prospect list has no ready prospects"});
    if(!messages?.length) return json(400,{error:"Campaign has no active message variations"});

    const {error}=await sb.from("campaigns").update({
      status:"running",next_send_at:null,last_error:null,updated_at:new Date().toISOString()
    }).eq("id",params.id).eq("user_id",user.id);
    if(error) throw error;

    const first=await processCampaign(sb,env,params.id,user.id);
    return json(200,{ok:true,first});
  }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}
