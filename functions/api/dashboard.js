import { getUser, json } from "./_auth.js";

export async function onRequestGet({request,env}) {
  try {
    const {sb,user}=await getUser(request,env);

    const [s,l,c]=await Promise.all([
      sb.from("sender_accounts").select("id,email,status,daily_limit,sent_today,sent_today_date,last_sent_at").eq("user_id",user.id).order("created_at"),
      sb.from("prospect_lists").select("*").eq("user_id",user.id).order("created_at",{ascending:false}),
      sb.from("campaigns").select("*").eq("user_id",user.id).order("created_at",{ascending:false})
    ]);
    if(s.error||l.error||c.error) throw new Error((s.error||l.error||c.error).message);

    const campaigns=c.data||[];
    const ids=campaigns.map(x=>x.id);

    let links=[],activity=[];
    if(ids.length){
      const [{data:linkData,error:linkError},{data:activityData,error:activityError}]=await Promise.all([
        sb.from("campaign_senders").select("campaign_id,sender_id,sender_order,sender_accounts(email)").in("campaign_id",ids).order("sender_order"),
        sb.from("send_events").select("id,status,created_at,error,sender_accounts(email),prospects(email),campaigns(name)").eq("user_id",user.id).order("created_at",{ascending:false}).limit(25)
      ]);
      if(linkError) throw linkError;
      if(activityError) throw activityError;
      links=linkData||[];
      activity=(activityData||[]).map(x=>({
        id:x.id,status:x.status,created_at:x.created_at,error:x.error,
        sender_email:x.sender_accounts?.email||"Unknown sender",
        prospect_email:x.prospects?.email||"Unknown prospect",
        campaign_name:x.campaigns?.name||"Unknown campaign"
      }));
    }

    const senderMap=new Map();
    for(const link of links){
      const item=senderMap.get(link.campaign_id)||{count:0,emails:[],orders:[]};
      item.count++;
      if(link.sender_accounts?.email) item.emails.push(link.sender_accounts.email);
      item.orders.push({order:Number(link.sender_order||0),email:link.sender_accounts?.email||"Unknown sender"});
      senderMap.set(link.campaign_id,item);
    }

    const enriched=campaigns.map(x=>({
      ...x,
      sender_count:senderMap.get(x.id)?.count||0,
      sender_emails:senderMap.get(x.id)?.emails||[],
      sender_rotation:(senderMap.get(x.id)?.orders||[]).sort((a,b)=>a.order-b.order),
      next_sender_email:(()=>{const m=senderMap.get(x.id);if(!m?.orders?.length)return null;const orders=[...m.orders].sort((a,b)=>a.order-b.order);return orders[(Number(x.next_sender_index)||0)%orders.length]?.email||null;})()
    }));

    return json(200,{senders:s.data||[],lists:l.data||[],campaigns:enriched,activity});
  } catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}
