import { getUser, json } from "../../_auth.js";
export async function onRequestPost({request,env,params}){
 try{
  const {sb,user}=await getUser(request,env);
  const {error}=await sb.from("prospects").update({status:"archived"}).eq("user_id",user.id).eq("list_id",params.id).eq("status","sent");
  if(error) throw error;
  const [{count:active},{count:archived},{count:total}]=await Promise.all([
    sb.from("prospects").select("*",{count:"exact",head:true}).eq("list_id",params.id).eq("status","ready"),
    sb.from("prospects").select("*",{count:"exact",head:true}).eq("list_id",params.id).eq("status","archived"),
    sb.from("prospects").select("*",{count:"exact",head:true}).eq("list_id",params.id)
  ]);
  await sb.from("prospect_lists").update({total_count:total||0,active_count:active||0,archived_count:archived||0}).eq("id",params.id).eq("user_id",user.id);
  return json(200,{ok:true});
 }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}