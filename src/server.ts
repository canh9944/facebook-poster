import express from "express";
import cors from "cors";
import { db } from "./db.js";
import { startBrowser, stopBrowser } from "./browser.js";
import { publishPost } from "./facebook.js";
import { generatePost } from "./content.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json({
    running: true,
  });
});

app.get("/api/schedules", (_req, res) => {
  const schedules = db
    .prepare(
      `
    SELECT *
    FROM schedules
    ORDER BY time
  `,
    )
    .all();

  res.json(schedules);
});

app.post("/api/schedules", (req, res) => {
  const { time } = req.body;

  if (!/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({
      error: "Invalid time",
    });
  }

  const result = db
    .prepare(
      `
    INSERT INTO schedules (time, enabled)
    VALUES (?, 1)
  `,
    )
    .run(time);

  res.json({
    id: result.lastInsertRowid,
    time,
  });
});

app.delete("/api/schedules/:id", (req, res) => {
  db.prepare(
    `
    DELETE FROM schedules
    WHERE id = ?
  `,
  ).run(req.params.id);

  res.json({
    success: true,
  });
});

app.get("/api/posts", (_req, res) => {
  const posts = db
    .prepare(
      `
    SELECT *
    FROM posts
    ORDER BY id DESC
    LIMIT 50
  `,
    )
    .all();

  res.json(posts);
});

app.get("/api/logs", (_req, res) => {
  const logs = db
    .prepare(
      `
    SELECT *
    FROM logs
    ORDER BY id DESC
    LIMIT 100
  `,
    )
    .all();

  res.json(logs);
});

app.post("/api/browser/start", async (_req, res) => {
  try {
    await startBrowser();

    res.json({
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/api/browser/stop", async (_req, res) => {
  await stopBrowser();

  res.json({
    success: true,
  });
});

app.post("/api/generate", (req, res) => {
  const topic = req.body.topic || "AI và công nghệ";

  const content = generatePost(topic);

  res.json({
    content,
  });
});

app.post("/api/test-publish", async (req, res) => {
  try {
    const content = req.body?.content;

    if (!content) {
      return res.status(400).json({
        error: "Content is required",
        body: req.body,
      });
    }

    await publishPost(content);

    return res.json({
      success: true,
    });
  } catch (error) {
    console.error("Publish error:", error);

    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(3000, () => {
  console.log("API running at http://localhost:3000");
});
