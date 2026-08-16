import { db, log } from "./db.js";
import { generatePost } from "./content.js";
import { publishPost } from "./facebook.js";

export async function runPublishFlow() {
  const generated = await generatePost({ forceImage: true });
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
    .run(content, generated.imagePath ?? null, new Date().toISOString(), "publishing");

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

    log("ERROR", `Post ${postId} failed: ${message}`);
    throw error;
  }
}
