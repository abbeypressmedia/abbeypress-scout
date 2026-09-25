import { getUser, json } from "../_auth.js";

const MODEL="gpt-5.6-luna";

const SYSTEM=`You are MailFlow Copy Assistant. You are stateless: do not retain or infer memory beyond the current request.
Your job is to help create relevant, honest, permission-aware outreach copy and review drafts for spam-risk and compliance issues.
Never suggest tricks to bypass spam filters, fake identities, deceptive claims, hidden links, misleading subjects, or artificial urgency.
Prefer concise, specific, human-sounding language, truthful claims, clear relevance to the recipient, and a simple opt-out line when appropriate.
Return valid JSON with keys: subject, body, risk_level, issues, improvements.
risk_level must be one of: low, medium, high.
issues and improvements must be arrays of short strings.`;

async function callModel(env,payload){
  if(!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const r=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{
      Authorization:`Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:MODEL,
      input:[
        {role:"system",content:SYSTEM},
        {role:"user",content:JSON.stringify(payload)}
      ],
      text:{format:{type:"json_object"}}
    })
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error?.message||"AI copy request failed.");
  const text=data.output_text||"";
  try{return JSON.parse(text)}catch{throw new Error("AI returned invalid copy data.");}
}

export async function onRequestPost({request,env}){
  try{
    const {user}=await getUser(request,env);
    const body=await request.json();
    const mode=body.mode==="review"?"review":"generate";
    const idea=String(body.idea||"").trim();
    const subject=String(body.subject||"").trim();
    const draft=String(body.draft||"").trim();
    if(mode==="generate"&&!idea) return json(400,{error:"Enter an outreach idea."});
    if(mode==="review"&&!draft) return json(400,{error:"Enter a draft to review."});
    const result=await callModel(env,{
      mode,
      idea:mode==="generate"?idea:null,
      subject:mode==="review"?subject:null,
      draft:mode==="review"?draft:null,
      placeholders:["{{first_name}}","{{last_name}}","{{company}}","{{website}}","{{email}}"]
    });
    return json(200,{ok:true,result});
  }catch(e){
    return json(e.message==="Unauthorized"?401:400,{error:e.message});
  }
}
