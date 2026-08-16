import cron from "node-cron";
import { db, log } from "./db.js";
import { runPublishFlow } from "./job.js";

let running = false;

export function startScheduler() {
  cron.schedule("* * * * *", async () => {
    if (running) {
      return;
    }

    const now = new Date();
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    const currentTime = `${hour}:${minute}`;

    const schedule = db
      .prepare(
        `
      SELECT *
      FROM schedules
      WHERE time = ?
        AND enabled = 1
    `,
      )
      .get(currentTime) as
      | {
          id: number;
          time: string;
          enabled: number;
        }
      | undefined;

    if (!schedule) {
      return;
    }

    running = true;

    try {
      log("INFO", `Schedule triggered: ${currentTime}`);
      await runPublishFlow();
    } catch {
      // runPublishFlow already logs and records the failure
    } finally {
      running = false;
    }
  });

  log("INFO", "Scheduler started");
}
