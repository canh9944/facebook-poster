import fs from "node:fs";
import path from "node:path";
import { db, log } from "./db.js";
import { generatePost, prepareImageForFacebook, stripAiMentions } from "./content.js";
import { publishPost } from "./facebook.js";
import {
  loadAccounts,
  resolveAccountProfileId,
  type AccountConfig,
} from "./accounts.js";

function recentPostsForAccount(accountName: string) {
  const rows = db
    .prepare(
      `
      SELECT content
      FROM posts
      WHERE account = ?
      ORDER BY id DESC
      LIMIT 8
    `,
    )
    .all(accountName) as Array<{ content: string }>;

  return rows.map((row) => row.content);
}

function hoursSinceLastPublish(accountName: string) {
  const row = db
    .prepare(
      `
      SELECT published_at
      FROM posts
      WHERE account = ?
        AND status = 'published'
        AND published_at IS NOT NULL
      ORDER BY id DESC
      LIMIT 1
    `,
    )
    .get(accountName) as { published_at: string } | undefined;

  if (!row?.published_at) {
    return Number.POSITIVE_INFINITY;
  }

  const then = Date.parse(row.published_at);

  if (Number.isNaN(then)) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - then) / (60 * 60 * 1000);
}

function shouldSkipScheduledPost(account: AccountConfig) {
  const intervalHours = account.intervalHours && account.intervalHours > 0
    ? account.intervalHours
    : 1;
  const elapsed = hoursSinceLastPublish(account.name);

  if (elapsed >= intervalHours) {
    return false;
  }

  log(
    "INFO",
    `Skipping ${account.name}: last post ${elapsed.toFixed(1)}h ago (every ${intervalHours}h)`,
  );
  return true;
}

function resolveAccountAvatar(account: AccountConfig) {
  const safe = account.name.replace(/[<>:"/\\|?*]/g, "_").trim();
  const candidates = [
    account.avatar,
    path.resolve("data/avatars", `${safe}.jpg`),
    path.resolve("data/avatars", `${safe}.jpeg`),
    path.resolve("data/avatars", `${safe}.png`),
    path.resolve("accounts", `${account.name}.jpg`),
    path.resolve("accounts", `${account.name}.png`),
  ].filter(Boolean) as string[];

  return candidates.find((file) => fs.existsSync(file));
}

export async function runPublishFlow(account: AccountConfig) {
  const profileId = await resolveAccountProfileId(account);

  log("INFO", `Generating a ${account.topic} post for ${account.name}`);

  const referenceImagePath = resolveAccountAvatar(account);

  if (referenceImagePath) {
    log("INFO", `${account.name} using face: ${referenceImagePath}`);
  }

  const generated = await generatePost({
    forceImage: true,
    topic: account.topic,
    previousPosts: recentPostsForAccount(account.name),
    imageStyle: account.imageStyle,
    accountName: account.name,
    source: account.source,
    pageDna: account.pageDna,
    pillars: account.pillars,
    emotions: account.emotions,
    referenceImagePath,
  });

  if (!generated.imagePath) {
    throw new Error(`Image generation failed for ${account.name}`);
  }

  const imagePath = await prepareImageForFacebook(generated.imagePath);
  const content = stripAiMentions(generated.content);
  const comment = generated.comment
    ? stripAiMentions(generated.comment)
    : generated.comment;

  const result = db
    .prepare(
      `
      INSERT INTO posts (
        content,
        image,
        account,
        scheduled_at,
        status
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(
      content,
      imagePath ?? null,
      account.name,
      new Date().toISOString(),
      "publishing",
    );

  const postId = result.lastInsertRowid;

  try {
    await publishPost(content, imagePath, profileId, comment);

    db.prepare(
      `
      UPDATE posts
      SET
        status = 'published',
        published_at = ?
      WHERE id = ?
    `,
    ).run(new Date().toISOString(), postId);

    log("INFO", `Post ${postId} published for ${account.name}`);
    return generated;
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

    log("ERROR", `Post ${postId} failed for ${account.name}: ${message}`);
    throw error;
  }
}

export async function runAllAccounts() {
  const accounts = loadAccounts();

  if (!accounts.length) {
    throw new Error("No enabled accounts found in the accounts folder.");
  }

  for (const [index, account] of accounts.entries()) {
    let posted = false;

    try {
      if (shouldSkipScheduledPost(account)) {
        continue;
      }

      log("INFO", `Starting ${account.name} (${account.topic})`);
      await runPublishFlow(account);
      posted = true;
    } catch (error) {
      log(
        "ERROR",
        `${account.name} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (posted && index < accounts.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}
