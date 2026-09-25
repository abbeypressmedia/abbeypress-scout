async function tick(env){
  const response=await fetch(`${env.APP_URL}/api/internal/cron-tick`,{
    method:"POST",
    headers:{"X-Cron-Secret":env.CRON_SECRET}
  });
  const body=await response.text();
  if(!response.ok) throw new Error(`cron-tick ${response.status}: ${body}`);
  return body;
}

export default {
  async scheduled(controller,env){
    if(!env.APP_URL||!env.CRON_SECRET){
      console.error("Scheduler is missing APP_URL or CRON_SECRET");
      return;
    }

    // Keep one scheduled invocation alive for the minute and re-check
    // due campaigns every 10 seconds. Database claim/lease locking keeps
    // each individual send sequential and idempotent.
    for(let pass=0;pass<6;pass++){
      try{
        await tick(env);
        console.log(`Campaign scheduler pass ${pass+1}/6 OK`);
      }catch(e){
        console.error(`Campaign scheduler pass ${pass+1}/6 failed`,e);
      }
      if(pass<5) await scheduler.wait(10000);
    }
  }
};
