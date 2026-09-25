import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import "./styles.css";

let supabase=null;

async function loadSupabase(){
  const res=await fetch("/api/config",{cache:"no-store"});
  const body=await res.json().catch(()=>({}));
  if(!res.ok||!body.supabaseUrl||!body.supabaseAnonKey) throw new Error(body.error||"Supabase runtime configuration is unavailable.");
  supabase=createClient(body.supabaseUrl,body.supabaseAnonKey);
  window.__MAILFLOW_BUILD__=body.buildVersion||"unknown";
}

const api=async(path,options={})=>{
  if(!supabase) throw new Error("Supabase is not configured.");
  const {data:{session}}=await supabase.auth.getSession();
  const res=await fetch(`/api/${path}`,{
    ...options,
    headers:{
      "Content-Type":"application/json",
      ...(options.headers||{}),
      ...(session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{})
    }
  });
  const body=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(body.error||"Request failed");
  return body;
};

function App(){
  const [ready,setReady]=useState(false),[configError,setConfigError]=useState("");
  useEffect(()=>{loadSupabase().then(()=>setReady(true)).catch(e=>setConfigError(e.message));},[]);
  if(configError) return <ConfigError message={configError}/>;
  if(!ready) return <div className="auth"><div className="auth-card"><h1>Loading MailFlow…</h1><p>Connecting to the workspace.</p></div></div>;
  return <MailFlowApp/>;
}

function ConfigError({message}){
  return <div className="auth"><div className="auth-card"><div className="brand center"><div className="logo">M</div><div><b>MailFlow</b><small>Rotation</small></div></div><h1>Configuration required</h1><p>The site is deployed, but its Supabase runtime configuration is unavailable.</p><div className="alert">{message}</div></div></div>;
}

function MailFlowApp(){
  const [session,setSession]=useState(null),[tab,setTab]=useState("dashboard"),[data,setData]=useState({senders:[],lists:[],campaigns:[],activity:[]}),[loading,setLoading]=useState(true);
  const [buildVersion]=useState(()=>window.__MAILFLOW_BUILD__||"unknown");
  const [authMode,setAuthMode]=useState("login"),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState("");

  const refresh=async(silent=false)=>{
    if(!session) return;
    if(!silent) setLoading(true);
    try{setData(await api("dashboard"));setError("");}
    catch(e){setError(e.message);}
    finally{if(!silent)setLoading(false);}
  };

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const {data:listener}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    return ()=>listener.subscription.unsubscribe();
  },[]);
  useEffect(()=>{refresh();},[session]);
  useEffect(()=>{
    if(!session) return undefined;
    const timer=setInterval(()=>refresh(true),10000);
    return ()=>clearInterval(timer);
  },[session]);

  if(!session) return <Auth mode={authMode} setMode={setAuthMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} error={error} setError={setError}/>;

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="logo">M</div><div><b>MailFlow</b><small>Rotation</small></div></div>
      <nav>{[["dashboard","Dashboard"],["senders","Gmail Senders"],["prospects","Prospects"],["campaigns","Campaigns"]].map(([id,label])=><button className={tab===id?"active":""} onClick={()=>setTab(id)} key={id}>{label}</button>)}</nav>
      <div className="side-bottom"><small className="build-badge">Build {buildVersion}</small><button onClick={()=>supabase.auth.signOut()}>Sign out</button></div>
    </aside>
    <main className="main">
      <header><div><span className="eyebrow">Workspace</span><h1>{tab[0].toUpperCase()+tab.slice(1)}</h1></div><button className="primary" onClick={async()=>{try{const x=await api("gmail-start");location.href=x.url}catch(e){setError(e.message)}}}>+ Connect Gmail</button></header>
      {error&&<div className="alert">{error}</div>}
      {loading?<div className="loading">Loading workspace…</div>:<>
        {tab==="dashboard"&&<Dashboard data={data}/>}
        {tab==="senders"&&<Senders data={data} refresh={refresh}/>}
        {tab==="prospects"&&<Prospects data={data} refresh={refresh}/>}
        {tab==="campaigns"&&<Campaigns data={data} refresh={refresh}/>}
      </>}
    </main>
  </div>;
}

function Auth({mode,setMode,email,setEmail,password,setPassword,error,setError}){
  const submit=async e=>{
    e.preventDefault();setError("");
    const fn=mode==="login"?supabase.auth.signInWithPassword({email,password}):supabase.auth.signUp({email,password});
    const {error}=await fn;if(error)setError(error.message);
  };
  return <div className="auth"><div className="auth-card"><div className="brand center"><div className="logo">M</div><div><b>MailFlow</b><small>Rotation</small></div></div><h1>{mode==="login"?"Welcome back":"Create your workspace"}</h1><p>Manage Gmail senders, prospect lists and campaigns from one queue.</p><form onSubmit={submit}><input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required minLength="8"/>{error&&<div className="alert">{error}</div>}<button className="primary full">{mode==="login"?"Sign in":"Create account"}</button></form><button className="link" onClick={()=>setMode(mode==="login"?"signup":"login")}>{mode==="login"?"Create an account":"I already have an account"}</button></div></div>;
}

function Dashboard({data}){
  const totalSent=data.senders.reduce((a,s)=>a+(s.sent_today||0),0);
  const capacity=data.senders.reduce((a,s)=>a+Math.max(0,(s.daily_limit||0)-(s.sent_today||0)),0);
  const running=data.campaigns.filter(c=>c.status==="running").length;
  return <section>
    <div className="stats"><Stat label="Connected Gmail" value={data.senders.length}/><Stat label="Sent today" value={totalSent}/><Stat label="Running campaigns" value={running}/><Stat label="Available capacity" value={capacity}/></div>
    <div className="grid2">
      <Panel title="Sender pool"><p className="muted">Only senders selected for a campaign are used. Exhausted or disconnected accounts are skipped automatically.</p>{data.senders.slice(0,10).map(s=><div className="row" key={s.id}><span><b>{s.email}</b><small>{s.status}</small></span><span>{s.sent_today}/{s.daily_limit}</span></div>)}</Panel>
      <Panel title="Campaign progress">{data.campaigns.slice(0,8).map(c=><CampaignProgress key={c.id} campaign={c}/>)}</Panel>
    </div>
    <Panel title="Recent activity"><Activity items={data.activity}/></Panel>
  </section>;
}

const Stat=({label,value})=><div className="stat"><span>{label}</span><strong>{value}</strong></div>;
const Panel=({title,children,actions})=><div className="panel"><div className="panel-title"><h2>{title}</h2>{actions}</div>{children}</div>;

function CampaignProgress({campaign:c}){
  const total=Number(c.prospect_count||0),done=Number(c.sent_count||0)+Number(c.failed_count||0),pct=total?Math.min(100,Math.round(done/total*100)):0;
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(c.status!=="running")return undefined;const t=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(t)},[c.status]);
  const nextAt=c.next_send_at?new Date(c.next_send_at).getTime():0;
  const seconds=Math.max(0,Math.ceil((nextAt-now)/1000));
  const rotation=c.sender_rotation||[];
  return <div className="campaign-progress">
    <div className="row"><span><b>{c.name}</b><small>{c.sender_count||0} senders · {c.sender_limit}/sender</small></span><span className={`pill ${c.status}`}>{c.status}</span></div>
    <div className="progress-line"><div style={{width:`${pct}%`}}/></div>
    <div className="campaign-meta"><span>{done}/{total||"—"} processed · {c.sent_count||0} sent · {c.failed_count||0} failed</span>{c.status==="running"&&nextAt&&<span>{seconds>0?"Next send in "+seconds+"s":"Worker processing…"}</span>}</div>
    {rotation.length>0&&<div className="rotation-line"><span><b>Rotation:</b> {rotation.map((x,i)=><React.Fragment key={x.email}>{i>0&&" → "}{x.email}</React.Fragment>)}</span>{c.status==="running"&&c.next_sender_email&&<span><b>Next:</b> {c.next_sender_email}</span>}</div>}
    {c.status==="completed"&&<div className="campaign-state success">Campaign completed</div>}
    {c.status==="paused"&&<div className="campaign-state">Campaign paused — resume when ready.</div>}
    {c.status==="stopped"&&<div className="campaign-state">Campaign stopped.</div>}
  </div>;
}

function Senders({data,refresh}){
  const [saving,setSaving]=useState(null);
  const save=async(id,limit)=>{setSaving(id);try{await api(`senders/${id}`,{method:"PATCH",body:JSON.stringify({dailyLimit:Number(limit)})});await refresh(true)}catch(e){alert(e.message)}finally{setSaving(null)}};
  const disconnect=async id=>{if(!confirm("Disconnect this Gmail account? Existing send history will be kept."))return;try{await api(`senders/${id}`,{method:"DELETE"});await refresh()}catch(e){alert(e.message)}};
  return <section><Panel title="Connected Gmail accounts"><p className="muted">Connections stay in your workspace until you disconnect them. Disconnecting keeps campaign history intact.</p>{data.senders.length===0&&<div className="empty">No Gmail accounts connected yet.</div>}{data.senders.map(s=><SenderCard key={s.id} sender={s} saving={saving===s.id} save={save} disconnect={disconnect}/>)}</Panel></section>;
}

function SenderCard({sender:s,saving,save,disconnect}){
  const [limit,setLimit]=useState(s.daily_limit);
  const pct=Math.min(100,s.daily_limit?s.sent_today/s.daily_limit*100:0);
  return <div className="sender-card"><div><b>{s.email}</b><span className={`muted status-${s.status}`}>{s.status}</span></div><div className="meter"><div style={{width:`${pct}%`}}/></div><div><b>{s.sent_today}/{s.daily_limit}</b><small>sent today</small></div><div className="sender-actions"><label className="limit-input">Daily cap<input type="number" min="1" max="500" value={limit} onChange={e=>setLimit(e.target.value)}/></label><button className="ghost small" disabled={saving} onClick={()=>save(s.id,limit)}>{saving?"Saving…":"Save"}</button><button className="danger ghost small" onClick={()=>disconnect(s.id)}>Disconnect</button></div></div>;
}

function Prospects({data,refresh}){
  const [file,setFile]=useState(null),[name,setName]=useState(""),[busy,setBusy]=useState(false);
  const upload=()=>{
    if(!file||!name)return;
    setBusy(true);
    Papa.parse(file,{header:true,skipEmptyLines:true,complete:async r=>{
      try{const result=await api("prospects/import",{method:"POST",body:JSON.stringify({name,rows:r.data})});alert(`${result.count} prospects imported.`);setFile(null);setName("");await refresh();}
      catch(e){alert(e.message)}
      finally{setBusy(false)}
    }});
  };
  return <section><div className="grid2"><Panel title="Import prospect list"><input value={name} onChange={e=>setName(e.target.value)} placeholder="List name"/><input type="file" accept=".csv" onChange={e=>setFile(e.target.files?.[0]||null)}/><button className="primary" disabled={busy||!file||!name} onClick={upload}>{busy?"Importing…":"Import CSV"}</button><p className="muted">Expected columns: email, first_name, last_name, company, website. Duplicate emails are ignored.</p></Panel><Panel title="Your lists">{data.lists.map(l=><div className="row" key={l.id}><span><b>{l.name}</b><small>{l.total_count} total · {l.active_count} ready</small></span><span>{l.archived_count} archived</span><button className="ghost" onClick={async()=>{try{await api(`lists/${l.id}/archive-used`,{method:"POST"});await refresh()}catch(e){alert(e.message)}}}>Archive used</button></div>)}</Panel></div></section>;
}

function Campaigns({data,refresh}){
  const [name,setName]=useState(""),[listId,setListId]=useState(""),[limit,setLimit]=useState(200),[minDelay,setMinDelay]=useState(30),[maxDelay,setMaxDelay]=useState(45),[shuffle,setShuffle]=useState(true),[selected,setSelected]=useState([]),[messages,setMessages]=useState([{subject:"Quick question",body:"Hi {{first_name}},\n\nI was looking at {{company}} and wanted to ask a quick question."}]),[busy,setBusy]=useState(false);
  useEffect(()=>{if(selected.length===0&&data.senders.length)setSelected(data.senders.map(s=>s.id));},[data.senders.length]);
  const activeList=data.lists.find(l=>l.id===listId);
  const toggle=id=>setSelected(x=>x.includes(id)?x.filter(v=>v!==id):[...x,id]);
  const updateMessage=(i,key,value)=>setMessages(x=>x.map((m,n)=>n===i?{...m,[key]:value}:m));
  const create=async()=>{
    setBusy(true);
    try{
      if(!name||!listId||!selected.length)throw new Error("Choose a campaign name, prospect list, and at least one sender.");
      if(!messages.some(m=>m.subject.trim()&&m.body.trim()))throw new Error("Add at least one complete message variation.");
      await api("campaigns",{method:"POST",body:JSON.stringify({name,listId,senderLimit:Number(limit),minDelaySeconds:Number(minDelay),maxDelaySeconds:Number(maxDelay),shuffleMessages:shuffle,senderIds:selected,messages})});
      setName("");setListId("");setMessages([{subject:"",body:""}]);await refresh();
    }catch(e){alert(e.message)}
    finally{setBusy(false)}
  };
  const [working,setWorking]=useState(null);
  const action=async(id,type)=>{
    setWorking(`${id}:${type}`);
    try{
      const result=await api(`campaigns/${id}/${type}`,{method:"POST"});
      await refresh(true);
      if(type==="worker"&&result?.status==="waiting") alert(`The campaign is paced. Next send is due at ${new Date(result.nextSendAt).toLocaleTimeString()}.`);
    }catch(e){alert(e.message)}
    finally{setWorking(null)}
  };
  return <section><div className="grid2"><Panel title="Create campaign">
    <input placeholder="Campaign name" value={name} onChange={e=>setName(e.target.value)}/>
    <select value={listId} onChange={e=>setListId(e.target.value)}><option value="">Select prospect list</option>{data.lists.filter(l=>l.active_count>0).map(l=><option value={l.id} key={l.id}>{l.name} ({l.active_count} ready)</option>)}</select>
    <div className="form-grid"><label>Per-sender cap<input type="number" value={limit} min="1" max="500" onChange={e=>setLimit(e.target.value)}/></label><label>Min delay (sec)<input type="number" value={minDelay} min="30" max="3600" onChange={e=>setMinDelay(e.target.value)}/></label><label>Max delay (sec)<input type="number" value={maxDelay} min={minDelay} max="3600" onChange={e=>setMaxDelay(e.target.value)}/></label></div>
    <label className="check"><input type="checkbox" checked={shuffle} onChange={e=>setShuffle(e.target.checked)}/> Shuffle message variations</label>
    <h3>Send with these Gmail accounts</h3><div className="sender-picker">{data.senders.map(s=><label className="sender-option" key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={()=>toggle(s.id)} disabled={s.status!=="connected"}/><span>{s.email}<small>{s.sent_today}/{s.daily_limit} today · {s.status}</small></span></label>)}</div>
    <h3>Message variations</h3>{messages.map((m,i)=><div className="message-box" key={i}><div className="row-title"><b>Variation {i+1}</b>{messages.length>1&&<button className="link danger-link" onClick={()=>setMessages(x=>x.filter((_,n)=>n!==i))}>Remove</button>}</div><input placeholder={`Subject ${i+1}`} value={m.subject} onChange={e=>updateMessage(i,"subject",e.target.value)}/><textarea placeholder="Message body" value={m.body} onChange={e=>updateMessage(i,"body",e.target.value)}/><div className="muted">{"Placeholders: {{first_name}}, {{last_name}}, {{company}}, {{website}}, {{email}}"}</div></div>)}
    <button className="ghost" onClick={()=>setMessages(x=>[...x,{subject:"",body:""}])}>+ Add message variation</button>
    {activeList&&<div className="preview-note">This campaign will start with <b>{activeList.active_count}</b> ready prospects and <b>{selected.length}</b> selected senders.</div>}
    <div className="delay-note">Gmail pacing is intentionally conservative. Live sending starts at 30 seconds minimum; use shorter intervals only in a non-sending test/simulation environment.</div>
    <button className="primary full" disabled={busy} onClick={create}>{busy?"Creating…":"Create campaign"}</button>
  </Panel><Panel title="Existing campaigns">{data.campaigns.length===0&&<div className="empty">No campaigns yet.</div>}{data.campaigns.map(c=><div className="campaign-card" key={c.id}><CampaignProgress campaign={c}/><div className="campaign-actions">{c.status==="draft"&&<button className="primary small" onClick={()=>action(c.id,"start")}>Start sending</button>}{c.status==="running"&&<><button className="ghost small" disabled={working===`${c.id}:worker`} onClick={()=>action(c.id,"worker")}>{working===`${c.id}:worker`?"Sending…":"Run worker now"}</button><button className="ghost small" disabled={working===`${c.id}:pause`} onClick={()=>action(c.id,"pause")}>Pause</button><button className="danger ghost small" disabled={working===`${c.id}:stop`} onClick={()=>action(c.id,"stop")}>Stop</button></>}{c.status==="paused"&&<><button className="primary small" disabled={working===`${c.id}:start`} onClick={()=>action(c.id,"start")}>Resume</button><button className="danger ghost small" disabled={working===`${c.id}:stop`} onClick={()=>action(c.id,"stop")}>Stop</button></>}{c.status==="stopped"&&<span className="muted">Stopped</span>}</div>{c.last_error&&<div className="campaign-error">{c.last_error}</div>}</div>)}</Panel></div></section>;
}

function Activity({items}){
  if(!items?.length)return <div className="empty">No sends yet.</div>;
  return <div className="activity">{items.map(x=><div className="activity-row" key={x.id}><span className={`dot ${x.status}`}/><span><b>{x.sender_email}</b> → {x.prospect_email}<small>{x.campaign_name} · {new Date(x.created_at).toLocaleString()}</small></span><span className={`pill ${x.status}`}>{x.status}</span></div>)}</div>;
}

createRoot(document.getElementById("root")).render(<App/>);
