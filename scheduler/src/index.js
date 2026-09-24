export default {
  async scheduled(controller, env) {
    if (!env.APP_URL || !env.CRON_SECRET) {
      console.error("Scheduler is missing APP_URL or CRON_SECRET");
      return;
    }
    const response = await fetch(`${env.APP_URL}/api/internal/cron-tick`, {
      method: "POST",
      headers: { "X-Cron-Secret": env.CRON_SECRET }
    });
    if (!response.ok) {
      console.error("Campaign scheduler failed", response.status, await response.text());
    }
  }
};
