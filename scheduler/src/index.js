const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

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

    // Run sequential passes so a due campaign does not have to wait
    // for the next one-minute cron boundary. Each pass processes campaigns
    // one job at a time; this does not send campaigns concurrently.
    for(let pass=0;pass<3;pass++){
      try{
        await tick(env);
        console.log(`Campaign scheduler pass ${pass+1} OK`);
      }catch(e){
        console.error(`Campaign scheduler pass ${pass+1} failed`,e);
      }
      if(pass<2) await wait(20000);
    }
  }
};
