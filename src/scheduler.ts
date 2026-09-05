import cron from "node-cron";
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
  cron.schedule(
    "0 */5 * * *",
    () => {
      void runScheduledPublish("Cron: posting for all accounts (every 5 hours)");
    },
    {
      timezone: "Asia/Ho_Chi_Minh",
    },
  );

  log("INFO", "Scheduler started: every 5 hours at minute 0 (Asia/Ho_Chi_Minh)");
}
