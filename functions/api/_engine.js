import { createClient } from "@supabase/supabase-js";

export const render=(s,p)=>String(s??"")
  .replace(/\{\{\s*first_name\s*\}\}/gi,p.first_name||"")
  .replace(/\{\{\s*last_name\s*\}\}/gi,p.last_name||"")
  .replace(/\{\{\s*company\s*\}\}/gi,p.company||"")
  .replace(/\{\{\s*website\s*\}\}/gi,p.website||"")
  .replace(/\{\{\s*email\s*\}\}/gi,p.email||"");

function encodeBase64Url(value){
  const bytes=new TextEncoder().encode(value);
  let binary="";
  for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

const raw=(to,subject,body)=>{
  const safeTo=String(to||"").replace(/[\r\n]/g,"");
  const safeSubject=String(subject||"").replace(/[\r\n]/g," ").trim();
  const message=[
    `To: ${safeTo}`,
    `Subject: ${safeSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    String(body??"").replace(/\r?\n/g,"\r\n")
  ].join("\r\n");
  return encodeBase64Url(message);
};

function errorWithMeta(message,status,code){const e=new Error(message);e.status=status;e.code=code;return e;}

async function accessToken(env,refreshToken){
  if(!refreshToken) throw errorWithMeta("Sender has no stored refresh token. Reconnect this Gmail account.",401,"missing_refresh_token");
  const body=new URLSearchParams({
    client_id:env.GOOGLE_CLIENT_ID,
    client_secret:env.GOOGLE_CLIENT_SECRET,
    refresh_token:refreshToken,
    grant_type:"refresh_token"
  });
  const r=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw errorWithMeta(data.error_description||data.error||"Google token refresh failed",r.status,data.error);
  if(!data.access_token) throw errorWithMeta("Google did not return an access token",502,"missing_access_token");
  return data.access_token;
}

async function sendGmail(env,refreshToken,to,subject,body){
  const token=await accessToken(env,refreshToken);
  const r=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
    body:JSON.stringify({raw:raw(to,subject,body)})
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok){
    const reason=data.error?.errors?.[0]?.reason||data.error?.status||"gmail_error";
    throw errorWithMeta(data.error?.message||"Gmail send failed",r.status,reason);
  }
  if(!data.id) throw errorWithMeta("Gmail accepted the request without returning a message id",502,"missing_message_id");
  return data;
}

const isAuthFailure=e=>e?.status===401||e?.code==="invalid_grant"||e?.code==="missing_refresh_token"||/invalid_grant|invalid authentication|invalid credentials|refresh token/i.test(e?.message||"");
const isRetryable=e=>[403,429,500,502,503,504].includes(e?.status)||!e?.status;
const isPermanent=e=>e?.status===400||e?.status===404;

function delaySeconds(c){
  const min=Math.max(30,Number(c.min_delay_seconds??30));
  const max=Math.max(min,Number(c.max_delay_seconds??45));
  return max===min?min:Math.floor(min+Math.random()*(max-min+1));
}

export async function makeServiceClient(env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase server configuration is missing");
  return createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function finalize(sb,args){
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
    const {data,error}=await sb.rpc("finalize_campaign_job",args);
    if(!error) return data;
    lastError=error;
    if(attempt===0) await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw lastError;
}

export async function processCampaign(sb,env,campaignId,userId){
  const {data:campaign,error:campaignError}=await sb.from("campaigns")
    .select("id,min_delay_seconds,max_delay_seconds,status,next_send_at")
    .eq("id",campaignId).eq("user_id",userId).single();
  if(campaignError) throw campaignError;
  if(!campaign||campaign.status!=="running") return {status:"idle",campaignId};
  if(campaign.next_send_at&&new Date(campaign.next_send_at).getTime()>Date.now()){
    return {status:"waiting",campaignId,nextSendAt:campaign.next_send_at};
  }

  const {data:job,error:claimError}=await sb.rpc("claim_campaign_job",{p_campaign_id:campaignId,p_user_id:userId});
  if(claimError) throw claimError;
  if(!job) return {status:"idle",campaignId};

  let result;
  try{
    result=await sendGmail(env,job.refresh_token,job.prospect_email,render(job.subject,job),render(job.body,job));
  }catch(e){
    const authFailure=isAuthFailure(e),retryable=isRetryable(e),permanent=isPermanent(e);
    const retrySeconds=authFailure?0:(retryable?Math.min(300,60):120);
    const finalized=await finalize(sb,{
      p_claim_token:job.claim_token,
      p_user_id:userId,
      p_sender_id:job.sender_id,
      p_message_id:job.message_id,
      p_status:"failed",
      p_provider_message_id:null,
      p_error:`${job.sender_email}: ${e.message}`,
      p_next_send_at:new Date(Date.now()+retrySeconds*1000).toISOString(),
      p_permanent:permanent,
      p_auth_failure:authFailure
    });
    return {
      status:finalized?.status||"failed",
      sender:job.sender_email,
      prospect:job.prospect_email,
      error:e.message,
      authFailure,
      retryable,
      permanent
    };
  }

  const finalized=await finalize(sb,{
    p_claim_token:job.claim_token,
    p_user_id:userId,
    p_sender_id:job.sender_id,
    p_message_id:job.message_id,
    p_status:"sent",
    p_provider_message_id:result.id,
    p_error:null,
    p_next_send_at:new Date(Date.now()+delaySeconds(campaign)*1000).toISOString(),
    p_permanent:false,
    p_auth_failure:false
  });

  return {
    status:finalized?.status||"sent",
    sender:job.sender_email,
    prospect:job.prospect_email,
    messageId:result.id,
    nextSendAt:finalized?.next_send_at||null
  };
}
