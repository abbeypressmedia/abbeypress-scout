import { getUser, json } from "../_auth.js";

export async function onRequestPost({request,env}){
  try{
    const {sb,user}=await getUser(request,env);
    const {
      name,listId,senderLimit=200,minDelaySeconds=60,maxDelaySeconds=90,
      shuffleMessages=true,senderIds=[],messages=[]
    }=await request.json();

    const cleanName=String(name||"").trim();
    const limit=Number(senderLimit);
    const minDelay=Math.max(0,Number(minDelaySeconds));
    const maxDelay=Math.max(minDelay,Number(maxDelaySeconds));

    if(!cleanName||!listId) return json(400,{error:"Campaign name and prospect list are required"});
    if(!Number.isInteger(limit)||limit<1||limit>500) return json(400,{error:"Per-sender cap must be between 1 and 500"});
    if(minDelay>3600||maxDelay>3600) return json(400,{error:"Delay must be 0 to 3600 seconds"});
    if(!Array.isArray(senderIds)||senderIds.length===0) return json(400,{error:"Select at least one Gmail sender"});
    const cleanMessages=messages.filter(m=>String(m?.subject||"").trim()&&String(m?.body||"").trim());
    if(!cleanMessages.length) return json(400,{error:"At least one complete message variation is required"});

    const {data:list,error:le}=await sb.from("prospect_lists").select("id,active_count").eq("id",listId).eq("user_id",user.id).single();
    if(le||!list) return json(400,{error:"Invalid prospect list"});
    if(!list.active_count) return json(400,{error:"The selected prospect list has no ready prospects"});

    const {data:senders,error:se}=await sb.from("sender_accounts")
      .select("id,email,status")
      .eq("user_id",user.id)
      .in("id",senderIds);
    if(se) throw se;
    if(senders.length!==new Set(senderIds).size) return json(400,{error:"One or more selected senders are invalid"});
    if(senders.some(s=>s.status!=="connected")) return json(400,{error:"Only connected Gmail senders can be selected"});

    const {data:c,error:ce}=await sb.from("campaigns").insert({
      user_id:user.id,name:cleanName,list_id:listId,sender_limit:limit,
      min_delay_seconds:minDelay,max_delay_seconds:maxDelay,shuffle_messages:Boolean(shuffleMessages),
      prospect_count:list.active_count
    }).select().single();
    if(ce) throw ce;

    const senderRows=senders
      .sort((a,b)=>senderIds.indexOf(a.id)-senderIds.indexOf(b.id))
      .map((s,i)=>({campaign_id:c.id,sender_id:s.id,sender_order:i}));

    const {error:sndErr}=await sb.from("campaign_senders").insert(senderRows);
    if(sndErr) throw sndErr;

    const {error:msgErr}=await sb.from("campaign_messages").insert(cleanMessages.map((m,i)=>({
      campaign_id:c.id,subject:String(m.subject).trim(),body:String(m.body).trim(),variant_order:i
    })));
    if(msgErr) throw msgErr;

    return json(200,{campaign:c});
  }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}
