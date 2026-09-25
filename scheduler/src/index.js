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
      throw new Error("Scheduler is missing APP_URL or CRON_SECRET");
    }

    let successfulPasses=0;
    let lastError=null;

    for(let pass=0;pass<6;pass++){
      try{
        const body=await tick(env);
        successfulPasses++;
        console.log(`Campaign scheduler pass ${pass+1}/6 OK`,body);
      }catch(e){
        lastError=e;
        console.error(`Campaign scheduler pass ${pass+1}/6 failed`,e);
      }
      if(pass<5) await scheduler.wait(10000);
    }

    if(successfulPasses===0&&lastError) throw lastError;
  }
};
