import cron from "node-cron";
import { db, log } from "./db.js";
import { generatePost } from "./content.js";
import { publishPost } from "./facebook.js";

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

      const generated = await generatePost();
      const content = generated.content;

      const result = db
        .prepare(
          `
        INSERT INTO posts (
          content,
          image,
          scheduled_at,
          status
        )
        VALUES (?, ?, ?, ?)
      `,
        )
        .run(content, generated.imagePath ?? null, now.toISOString(), "publishing");

      const postId = result.lastInsertRowid;

      try {
        await publishPost(content, generated.imagePath);

        db.prepare(
          `
          UPDATE posts
          SET
            status = 'published',
            published_at = ?
          WHERE id = ?
        `,
        ).run(new Date().toISOString(), postId);

        log("INFO", `Post ${postId} published successfully`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        db.prepare(
          `
          UPDATE posts
          SET
            status = 'failed',
            error = ?
          WHERE id = ?
        `,
        ).run(message, postId);

        log("ERROR", `Post ${postId} failed: ${message}`);
      }
    } finally {
      running = false;
    }
  });

  log("INFO", "Scheduler started");
}
