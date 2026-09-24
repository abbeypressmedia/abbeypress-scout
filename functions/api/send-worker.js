import { getUser, json } from "./_auth.js";
import { processCampaign } from "./_engine.js";

export async function onRequestPost({request,env}){
  try{
    const {sb,user}=await getUser(request,env);
    const {campaignId}=await request.json();
    if(!campaignId) return json(400,{error:"campaignId required"});
    const result=await processCampaign(sb,env,campaignId,user.id);
    return json(200,result);
  }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}
