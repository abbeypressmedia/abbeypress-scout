import { json } from "../_auth.js";
import { makeServiceClient, processCampaign } from "../_engine.js";

export async function onRequestPost({request,env}){
  const expected=env.CRON_SECRET;
  const supplied=request.headers.get("X-Cron-Secret")||"";
  if(!expected||!supplied||expected!==supplied) return json(401,{error:"Unauthorized"});

  try{
    const sb=await makeServiceClient(env);
    const today=new Date().toISOString().slice(0,10);

    await sb.from("sender_accounts")
      .update({sent_today:0,sent_today_date:today,lease_until:null,updated_at:new Date().toISOString()})
      .lt("sent_today_date",today);

    const {data:campaigns,error}=await sb.from("campaigns")
      .select("id,user_id")
      .eq("status","running")
      .order("updated_at",{ascending:true})
      .limit(100);

    if(error) throw error;

    const results=[];
    for(const c of campaigns||[]){
      try{
        results.push(await processCampaign(sb,env,c.id,c.user_id));
      }catch(e){
        results.push({status:"error",campaignId:c.id,error:e.message});
      }
    }

    return json(200,{ok:true,processed:results.length,results});
  }catch(e){
    return json(500,{error:e.message});
  }
}
