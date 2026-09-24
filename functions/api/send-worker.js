import { getUser, json } from "./_auth.js";

const render=(s,p)=>s.replace(/\{\{\s*first_name\s*\}\}/gi,p.first_name||"").replace(/\{\{\s*last_name\s*\}\}/gi,p.last_name||"").replace(/\{\{\s*company\s*\}\}/gi,p.company||"").replace(/\{\{\s*website\s*\}\}/gi,p.website||"").replace(/\{\{\s*email\s*\}\}/gi,p.email||"");
const raw=(to,subject,body)=>btoa(unescape(encodeURIComponent(`To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");

async function accessToken(env,refreshToken){
  const body=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:refreshToken,grant_type:"refresh_token"});
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error_description||data.error||"Google token refresh failed");
  return data.access_token;
}
async function sendGmail(env,sender,to,subject,body){
  const token=await accessToken(env,sender.refresh_token);
  const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({raw:raw(to,subject,body)})});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error?.message||"Gmail send failed");
  return data;
}
export async function onRequestPost({request,env}){
 try{
  const {sb,user}=await getUser(request,env);
  const {campaignId}=await request.json();
  if(!campaignId) return json(400,{error:"campaignId required"});
  const {data:c}=await sb.from("campaigns").select("*").eq("id",campaignId).eq("user_id",user.id).single();
  if(!c||c.status!=="running") return json(400,{error:"Campaign is not running"});
  const {data:links}=await sb.from("campaign_senders").select("sender_id,sender_order,sender_accounts(*)").eq("campaign_id",campaignId).order("sender_order");
  const all=(links||[]).map(x=>x.sender_accounts).filter(Boolean);
  const eligible=all.filter(s=>s.status==="connected"&&s.sent_today<c.sender_limit&&s.sent_today<s.daily_limit);
  if(!eligible.length){await sb.from("campaigns").update({status:"completed"}).eq("id",campaignId);return json(200,{status:"completed"});}
  const {data:prospects}=await sb.from("prospects").select("*").eq("user_id",user.id).eq("list_id",c.list_id).eq("status","ready").order("id").limit(1);
  const p=prospects?.[0];
  if(!p){await sb.from("campaigns").update({status:"completed"}).eq("id",campaignId);return json(200,{status:"completed"});}
  const {data:msgs}=await sb.from("campaign_messages").select("*").eq("campaign_id",campaignId).eq("active",true).order("variant_order");
  if(!msgs?.length) return json(500,{error:"Campaign has no active messages"});
  const start=c.next_sender_index||0;
  let chosen=null,chosenIndex=-1;
  for(let i=0;i<all.length;i++){const idx=(start+i)%all.length;if(eligible.some(s=>s.id===all[idx].id)){chosen=all[idx];chosenIndex=idx;break;}}
  if(!chosen) return json(500,{error:"No eligible sender"});
  const msg=msgs[(c.next_message_index||0)%msgs.length];
  let result=null,status="sent",err=null;
  try{result=await sendGmail(env,chosen,p.email,render(msg.subject,p),render(msg.body,p));}
  catch(e){status="failed";err=e.message;}
  await sb.from("send_events").insert({user_id:user.id,campaign_id:campaignId,prospect_id:p.id,sender_id:chosen.id,message_id:msg.id,status,provider_message_id:result?.id||null,error:err});
  if(status==="sent"){
    await sb.from("prospects").update({status:"sent",contacted_at:new Date().toISOString(),last_campaign_id:campaignId}).eq("id",p.id).eq("user_id",user.id);
    await sb.from("sender_accounts").update({sent_today:chosen.sent_today+1,last_sent_at:new Date().toISOString()}).eq("id",chosen.id).eq("user_id",user.id);
  }else{
    await sb.from("prospects").update({status:"failed"}).eq("id",p.id).eq("user_id",user.id);
  }
  await sb.from("campaigns").update({next_sender_index:(chosenIndex+1)%Math.max(1,all.length),next_message_index:(c.next_message_index+1)%Math.max(1,msgs.length),updated_at:new Date().toISOString()}).eq("id",campaignId).eq("user_id",user.id);
  return json(200,{status,sender:chosen.email,prospect:p.email,error:err});
 }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}