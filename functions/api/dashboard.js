import { getUser, json } from "./_auth.js";
export async function onRequestGet({request,env}) {
  try {
    const {sb,user}=await getUser(request,env);
    const [s,l,c]=await Promise.all([
      sb.from("sender_accounts").select("id,email,status,daily_limit,sent_today,last_sent_at").eq("user_id",user.id).order("created_at"),
      sb.from("prospect_lists").select("*").eq("user_id",user.id).order("created_at",{ascending:false}),
      sb.from("campaigns").select("*").eq("user_id",user.id).order("created_at",{ascending:false})
    ]);
    if(s.error||l.error||c.error) throw new Error((s.error||l.error||c.error).message);
    return json(200,{senders:s.data||[],lists:l.data||[],campaigns:c.data||[]});
  } catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}