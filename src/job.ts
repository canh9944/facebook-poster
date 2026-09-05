import { db, log } from "./db.js";
import { generatePost } from "./content.js";
import { publishPost } from "./facebook.js";
import { stopBrowser } from "./browser.js";
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

export async function runPublishFlow(account: AccountConfig) {
  const profileId = await resolveAccountProfileId(account);

  log("INFO", `Generating a ${account.topic} post for ${account.name}`);

  const generated = await generatePost({
    forceImage: true,
    topic: account.topic,
    previousPosts: recentPostsForAccount(account.name),
  });

  if (!generated.imagePath) {
    throw new Error(`Image generation failed for ${account.name}`);
  }
  const content = generated.content;

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
      generated.imagePath ?? null,
      account.name,
      new Date().toISOString(),
      "publishing",
    );

  const postId = result.lastInsertRowid;

  try {
    await publishPost(content, generated.imagePath, profileId);

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
    try {
      log("INFO", `Starting ${account.name} (${account.topic})`);
      await runPublishFlow(account);
    } catch (error) {
      log(
        "ERROR",
        `${account.name} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      await stopBrowser().catch(() => {});
    }

    if (index < accounts.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}
