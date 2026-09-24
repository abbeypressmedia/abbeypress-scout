import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import "./styles.css";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || "",
  import.meta.env.VITE_SUPABASE_ANON_KEY || ""
);

const api = async (path, options = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
    }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
};

function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [data, setData] = useState({ senders: [], lists: [], campaigns: [] });
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    if (!session) return;
    setLoading(true);
    try { setData(await api("dashboard")); } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { refresh(); }, [session]);

  if (!session) return <Auth mode={authMode} setMode={setAuthMode} email={email} setEmail={setEmail} password={password} setPassword={setPassword} error={error} setError={setError} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><div className="logo">M</div><div><b>MailFlow</b><small>Rotation</small></div></div>
        <nav>
          {[["dashboard","Dashboard"],["senders","Gmail Senders"],["prospects","Prospects"],["campaigns","Campaigns"]].map(([id,label]) =>
            <button className={tab===id?"active":""} onClick={()=>setTab(id)} key={id}>{label}</button>
          )}
        </nav>
        <div className="side-bottom"><button onClick={()=>supabase.auth.signOut()}>Sign out</button></div>
      </aside>
      <main className="main">
        <header><div><span className="eyebrow">Workspace</span><h1>{tab[0].toUpperCase()+tab.slice(1)}</h1></div><button className="primary" onClick={async()=>{try{const x=await api("gmail-start");location.href=x.url}catch(e){setError(e.message)}}}>+ Connect Gmail</button></header>
        {error && <div className="alert">{error}</div>}
        {loading ? <div className="loading">Loading workspace…</div> : <>
          {tab==="dashboard" && <Dashboard data={data}/>}
          {tab==="senders" && <Senders data={data} refresh={refresh}/>}
          {tab==="prospects" && <Prospects data={data} refresh={refresh}/>}
          {tab==="campaigns" && <Campaigns data={data} refresh={refresh}/>}
        </>}
      </main>
    </div>
  );
}

function Auth({mode,setMode,email,setEmail,password,setPassword,error,setError}) {
  const submit = async e => {
    e.preventDefault(); setError("");
    const fn = mode==="login" ? supabase.auth.signInWithPassword({email,password}) : supabase.auth.signUp({email,password});
    const { error } = await fn; if (error) setError(error.message);
  };
  return <div className="auth"><div className="auth-card"><div className="brand center"><div className="logo">M</div><div><b>MailFlow</b><small>Rotation</small></div></div><h1>{mode==="login"?"Welcome back":"Create your workspace"}</h1><p>Manage Gmail senders, prospect lists and campaigns from one queue.</p><form onSubmit={submit}><input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required/><input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required minLength="8"/>{error&&<div className="alert">{error}</div>}<button className="primary full">{mode==="login"?"Sign in":"Create account"}</button></form><button className="link" onClick={()=>setMode(mode==="login"?"signup":"login")}>{mode==="login"?"Create an account":"I already have an account"}</button></div></div>
}

function Dashboard({data}) {
  const totalSent = data.senders.reduce((a,s)=>a+s.sent_today,0);
  const capacity = data.senders.reduce((a,s)=>a+Math.max(0,s.daily_limit-s.sent_today),0);
  return <section><div className="stats"><Stat label="Connected Gmail" value={data.senders.length}/><Stat label="Sent today" value={totalSent}/><Stat label="Capacity remaining" value={capacity}/><Stat label="Campaigns" value={data.campaigns.length}/></div><div className="grid2"><Panel title="Sender pool"><p className="muted">Eligible accounts rotate in order. Exhausted or disconnected accounts are skipped.</p>{data.senders.slice(0,8).map(s=><div className="row" key={s.id}><span>{s.email}</span><span>{s.sent_today}/{s.daily_limit}</span></div>)}</Panel><Panel title="Campaigns"><p className="muted">Create one campaign with multiple message variants.</p>{data.campaigns.slice(0,6).map(c=><div className="row" key={c.id}><span>{c.name}</span><span className={`pill ${c.status}`}>{c.status}</span></div>)}</Panel></div></section>
}
const Stat=({label,value})=><div className="stat"><span>{label}</span><strong>{value}</strong></div>;
const Panel=({title,children})=><div className="panel"><div className="panel-title"><h2>{title}</h2></div>{children}</div>;

function Senders({data,refresh}) {
  return <section><Panel title="Connected Gmail accounts"><p className="muted">Each Gmail account is authorized separately through Google OAuth. The connection stays associated with your workspace until you disconnect it.</p>{data.senders.length===0&&<div className="empty">No Gmail accounts connected yet.</div>}{data.senders.map(s=><div className="sender-card" key={s.id}><div><b>{s.email}</b><span className="muted">{s.status}</span></div><div className="meter"><div style={{width:`${Math.min(100,s.sent_today/s.daily_limit*100)}%`}}/></div><span>{s.sent_today}/{s.daily_limit}</span><button className="danger ghost" onClick={async()=>{await api(`senders/${s.id}`,{method:"DELETE"});refresh()}}>Disconnect</button></div>)}</Panel></section>
}

function Prospects({data,refresh}) {
  const [file,setFile]=useState(null), [name,setName]=useState("");
  const upload=()=>{ if(!file||!name)return; Papa.parse(file,{header:true,skipEmptyLines:true,complete:async r=>{try{await api("prospects/import",{method:"POST",body:JSON.stringify({name,rows:r.data})});setFile(null);setName("");refresh()}catch(e){alert(e.message)}}})};
  return <section><div className="grid2"><Panel title="Import prospect list"><input value={name} onChange={e=>setName(e.target.value)} placeholder="List name"/><input type="file" accept=".csv" onChange={e=>setFile(e.target.files?.[0])}/><button className="primary" onClick={upload}>Import CSV</button><p className="muted">Expected columns: email, first_name, last_name, company, website. Duplicate emails are ignored.</p></Panel><Panel title="Your lists">{data.lists.map(l=><div className="row" key={l.id}><span>{l.name}</span><span>{l.active_count} active · {l.archived_count} archived</span><button className="ghost" onClick={async()=>{await api(`lists/${l.id}/archive-used`,{method:"POST"});refresh()}}>Archive used</button></div>)}</Panel></div></section>
}

function Campaigns({data,refresh}) {
  const [name,setName]=useState(""),[listId,setListId]=useState(""),[limit,setLimit]=useState(200),[messages,setMessages]=useState([{subject:"Quick question",body:"Hi {{first_name}},\n\nI was looking at {{company}} and wanted to ask a quick question."}]);
  const add=()=>setMessages([...messages,{subject:"",body:""}]);
  const create=async()=>{await api("campaigns",{method:"POST",body:JSON.stringify({name,listId,senderLimit:Number(limit),messages})});setName("");refresh()};
  return <section><div className="grid2"><Panel title="Create campaign"><input placeholder="Campaign name" value={name} onChange={e=>setName(e.target.value)}/><select value={listId} onChange={e=>setListId(e.target.value)}><option value="">Select prospect list</option>{data.lists.map(l=><option value={l.id} key={l.id}>{l.name} ({l.active_count})</option>)}</select><label>Per-sender campaign limit<input type="number" value={limit} min="1" onChange={e=>setLimit(e.target.value)}/></label><h3>Message variations</h3>{messages.map((m,i)=><div className="message-box" key={i}><input placeholder={`Subject ${i+1}`} value={m.subject} onChange={e=>{let x=[...messages];x[i].subject=e.target.value;setMessages(x)}}/><textarea placeholder="Message body" value={m.body} onChange={e=>{let x=[...messages];x[i].body=e.target.value;setMessages(x)}}/></div>)}<button className="ghost" onClick={add}>+ Add message variation</button><button className="primary" onClick={create}>Create campaign</button></Panel><Panel title="Existing campaigns">{data.campaigns.map(c=><div className="row" key={c.id}><span><b>{c.name}</b><small>{c.status}</small></span><span>{c.sender_limit}/sender</span>{c.status==="draft"&&<button className="primary small" onClick={async()=>{await api(`campaigns/${c.id}/start`,{method:"POST"});refresh()}}>Start</button>}{c.status==="running"&&<button className="ghost small" onClick={async()=>{await api(`campaigns/${c.id}/pause`,{method:"POST"});refresh()}}>Pause</button>}</div>)}</Panel></div></section>
}

createRoot(document.getElementById("root")).render(<App/>);