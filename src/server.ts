import "./env.js";
import express from "express";
import cors from "cors";
import { db } from "./db.js";
import {
  getActiveProfileId,
  isBrowserRunning,
  startBrowser,
  stopBrowser,
} from "./browser.js";
import { publishPost } from "./facebook.js";
import { generatePost } from "./content.js";
import { listProfiles, listRunningProfiles } from "./genlogin.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json({
    running: true,
    browserRunning: isBrowserRunning(),
    profileId: getActiveProfileId(),
  });
});

app.get("/api/genlogin/profiles", async (_req, res) => {
  try {
    const result = await listProfiles();

    res.json({
      ...result,
      activeProfileId: getActiveProfileId(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.get("/api/genlogin/running", async (_req, res) => {
  try {
    res.json(await listRunningProfiles());
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

app.post("/api/browser/start", async (req, res) => {
  try {
    const profileId = req.body?.profileId;

    await startBrowser(profileId ? String(profileId) : undefined);

    res.json({
      success: true,
      profileId: getActiveProfileId(),
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

app.post("/api/generate", async (req, res) => {
  try {
    const content = await generatePost();

    res.json({
      content,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/api/test-publish", async (req, res) => {
  try {
    let content = req.body?.content;

    if (!content) {
      content = await generatePost();
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
