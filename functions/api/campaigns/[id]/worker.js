import { getUser, json } from "../../../_auth.js";
import { processCampaign } from "../../../_engine.js";

export async function onRequestPost({request,env,params}){
  try{
    const {sb,user}=await getUser(request,env);
    return json(200,await processCampaign(sb,env,params.id,user.id));
  }catch(e){
    return json(e.message==="Unauthorized"?401:500,{error:e.message});
  }
}
