import { getUser, json } from "../_auth.js";
const norm=v=>String(v??"").trim();
export async function onRequestPost({request,env}){
 try{
  const {sb,user}=await getUser(request,env);
  const {name,rows}=await request.json();
  if(!name||!Array.isArray(rows)) return json(400,{error:"List name and rows are required"});
  const {data:list,error:le}=await sb.from("prospect_lists").insert({user_id:user.id,name}).select().single();
  if(le) throw le;
  const seen=new Set(),records=[];
  for(const r of rows){
    const email=norm(r.email||r.Email||r["Email Address"]).toLowerCase();
    if(!email||seen.has(email)) continue;
    seen.add(email);
    records.push({user_id:user.id,list_id:list.id,email,first_name:norm(r.first_name||r.firstName||r["First Name"]),last_name:norm(r.last_name||r.lastName||r["Last Name"]),company:norm(r.company||r.Company),website:norm(r.website||r.Website),status:"ready"});
  }
  for(let i=0;i<records.length;i+=500){
    const {error}=await sb.from("prospects").upsert(records.slice(i,i+500),{onConflict:"user_id,list_id,email",ignoreDuplicates:true});
    if(error) throw error;
  }
  const {count}=await sb.from("prospects").select("*",{count:"exact",head:true}).eq("list_id",list.id).eq("status","ready");
  await sb.from("prospect_lists").update({total_count:count||0,active_count:count||0,archived_count:0}).eq("id",list.id).eq("user_id",user.id);
  return json(200,{ok:true,count:count||0});
 }catch(e){return json(e.message==="Unauthorized"?401:500,{error:e.message});}
}