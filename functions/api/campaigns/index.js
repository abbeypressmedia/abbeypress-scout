import { getUser, json } from "../_auth.js";
export async function onRequestPost({request,env}){
 try{
  const {sb,user}=await getUser(request,env);
  const {name,listId,senderLimit,messages=[]}=await request.json();
  if(!name||!listId||!messages.some(m=>m.subject&&m.body)) return json(400,{error:"Campaign name, list and at least one message are required"});
  const {data:list,error:le}=await sb.from("prospect_lists").select("id").eq("id",listId).eq("user_id",user.id).single();
  if(le||!list) return json(400,{error:"Invalid prospect list"});
  const {data:senders,error:se}=await sb.from("sender_accounts").select("id").eq("user_id",user.id).eq("status","connected").order("created_at");
  if(se) throw se;
  if(!senders?.length) return json(400,{error:"Connect at least one Gmail sender before creating a campaign"});
  const {data:c,error:ce}=await sb.from("campaigns").insert({user_id:user.id,name,list_id:listId,sender_limit:senderLimit||200}).select().single();
  if(ce) throw ce;
  const {error:sndErr}=await sb.from("campaign_senders").insert(senders.map((s,i)=>({campaign_id:c.id,sender_id:s.id,sender_order:i})));
  if(sndErr) throw sndErr;
  const {error:msgErr}=await sb.from("campaign_messages").insert(messages.filter(m=>m.subject&&m.body).map((m,i)=>({campaign_id:c.id,subject:m.subject,body:m.body,variant_order:i})));
  if(msgErr) throw msgErr;
  return json(200,{campaign:c});
 }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}