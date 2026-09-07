import { log } from "./db.js";
import { runAllAccounts } from "./job.js";

let running = false;

async function runScheduledPublish(reason: string) {
  if (running) {
    log("INFO", `Skipping ${reason}; a publish run is already in progress`);
    return;
  }

  running = true;

  try {
    log("INFO", reason);
    await runAllAccounts();
  } catch (error) {
    log(
      "ERROR",
      `Scheduled publish failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    running = false;
  }
}

export function startScheduler() {
  const hourMs = 60 * 60 * 1000;

  setInterval(() => {
    void runScheduledPublish("Hourly: posting for all accounts");
  }, hourMs);

  log("INFO", "Scheduler started: first post on launch, then every 1 hour");
}
