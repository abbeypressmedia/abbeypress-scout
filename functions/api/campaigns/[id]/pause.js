import { getUser, json } from "../../_auth.js";
export async function onRequestPost({request,env,params}){
 try{
  const {sb,user}=await getUser(request,env);
  const {error}=await sb.from("campaigns").update({status:"paused",updated_at:new Date().toISOString()}).eq("id",params.id).eq("user_id",user.id);
  if(error) throw error;
  return json(200,{ok:true});
 }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}