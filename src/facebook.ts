import { getPage, openFacebook, startBrowser, stopBrowser } from "./browser.js";
import { log } from "./db.js";

const CREATE_POST_PATTERNS = [
  /what'?s on your mind/i,
  /bạn đang nghĩ gì/i,
  /create (a )?post/i,
  /tạo bài viết/i,
  /write something/i,
  /viết gì đó/i,
  /you think/i,
  /nghĩ gì/i,
];

const POST_BUTTON_PATTERNS = [
  /^post$/i,
  /^đăng$/i,
  /^publish$/i,
];

const POST_BUTTON_SKIP = [
  /photo/i,
  /video/i,
  /feeling/i,
  /tag/i,
  /check in/i,
  /live/i,
  /reel/i,
  /story/i,
  /close/i,
  /cancel/i,
  /hủy/i,
  /đóng/i,
  /ảnh/i,
  /cảm xúc/i,
  /gắn thẻ/i,
  /next/i,
  /tiếp/i,
];

async function dismissOverlays(page: any) {
  const overlayTexts = [
    /allow all cookies/i,
    /accept all/i,
    /accept cookies/i,
    /cho phép tất cả/i,
    /chấp nhận tất cả/i,
    /not now/i,
    /để sau/i,
    /close/i,
  ];

  for (const pattern of overlayTexts) {
    const button = page.getByRole("button", { name: pattern }).first();

    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

async function ensureLoggedIn(page: any) {
  const url = page.url();

  if (/login|checkpoint|recover/i.test(url)) {
    throw new Error(
      "Facebook is not logged in. Log in once in the opened browser, then retry.",
    );
  }

  const loginForm = page.locator("#email, input[name='email']").first();

  if (await loginForm.isVisible({ timeout: 1000 }).catch(() => false)) {
    throw new Error(
      "Facebook is not logged in. Log in once in the opened browser, then retry.",
    );
  }
}

async function findCreatePostButton(page: any) {
  for (const pattern of CREATE_POST_PATTERNS) {
    const byRole = page.getByRole("button", { name: pattern }).first();

    if (await byRole.isVisible({ timeout: 1000 }).catch(() => false)) {
      return byRole;
    }

    const textNode = page.getByText(pattern).first();

    if (await textNode.isVisible({ timeout: 500 }).catch(() => false)) {
      const button = textNode.locator(
        'xpath=ancestor::*[@role="button"][1]',
      );

      if (await button.isVisible().catch(() => false)) {
        return button;
      }

      return textNode;
    }
  }

  const placeholders = page.locator(
    '[aria-label*="mind" i], [aria-label*="nghĩ" i], [aria-placeholder*="mind" i], [aria-placeholder*="nghĩ" i]',
  );

  const placeholderCount = await placeholders.count();

  for (let i = 0; i < placeholderCount; i++) {
    const el = placeholders.nth(i);

    if (await el.isVisible().catch(() => false)) {
      return el;
    }
  }

  return null;
}

function createPostDialog(page: any) {
  return page.getByRole("dialog").filter({
    hasText:
      /tạo bài viết|create (a )?post|create post|what's on your mind|bạn đang nghĩ gì|write something|viết gì/i,
  });
}

async function findVisibleEditor(scope: any) {
  const editors = scope.locator(
    '[role="textbox"], [contenteditable="true"], [contenteditable="plaintext-only"]',
  );
  const count = await editors.count();
  let fallback = null;

  for (let i = 0; i < count; i++) {
    const editor = editors.nth(i);

    if (!(await editor.isVisible().catch(() => false))) {
      continue;
    }

    const aria =
      `${(await editor.getAttribute("aria-label").catch(() => "")) || ""} ${(await editor.getAttribute("aria-placeholder").catch(() => "")) || ""}`;

    if (/search|tìm|comment|bình luận|message|tin nhắn|chat/i.test(aria)) {
      continue;
    }

    if (/mind|nghĩ|create post|tạo bài|write something|viết/i.test(aria)) {
      return editor;
    }

    fallback = fallback || editor;
  }

  return fallback;
}

async function findComposer(page: any) {
  const dialog = createPostDialog(page);

  await dialog
    .first()
    .waitFor({ state: "visible", timeout: 15000 })
    .catch(() => {});

  for (let attempt = 0; attempt < 30; attempt++) {
    const namedDialog = dialog.first();

    if (await namedDialog.isVisible().catch(() => false)) {
      const editor = await findVisibleEditor(namedDialog);

      if (editor) {
        return editor;
      }
    }

    const dialogs = page.locator('[role="dialog"]');
    const dialogCount = await dialogs.count();

    for (let i = dialogCount - 1; i >= 0; i -= 1) {
      const current = dialogs.nth(i);

      if (!(await current.isVisible().catch(() => false))) {
        continue;
      }

      const editor = await findVisibleEditor(current);

      if (editor) {
        return editor;
      }
    }

    const pageEditor = await findVisibleEditor(page);

    if (pageEditor) {
      const box = await pageEditor.boundingBox().catch(() => null);

      if (box && box.height >= 36 && box.width >= 120) {
        return pageEditor;
      }
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function typeIntoComposer(page: any, composer: any, content: string) {
  await composer.scrollIntoViewIfNeeded();
  await composer.click();
  await page.waitForTimeout(400);

  await page.keyboard.press("Control+A").catch(() => {});
  await page.waitForTimeout(100);
  await page.keyboard.press("Backspace").catch(() => {});

  const lines = content.replace(/\r/g, "").split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]) {
      await page.keyboard.insertText(lines[i]);
    }

    if (i < lines.length - 1) {
      await page.keyboard.press("Enter");
    }
  }

  await page.waitForTimeout(800);

  const typed = await composer
    .evaluate((el: HTMLElement) => (el.innerText || "").trim())
    .catch(() => "");

  if (!typed) {
    await composer.click();
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.type(content, { delay: 20 });
  }
}

function normalizeLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function clickPhotoNextIfNeeded(page: any) {
  const dialogs = page.getByRole("dialog");
  const count = await dialogs.count();

  for (let i = count - 1; i >= 0; i--) {
    const dialog = dialogs.nth(i);

    if (!(await dialog.isVisible().catch(() => false))) {
      continue;
    }

    const next = dialog.getByRole("button", { name: /^(next|tiếp)$/i }).last();

    if (!(await next.isVisible({ timeout: 500 }).catch(() => false))) {
      continue;
    }

    const disabled = await next.getAttribute("aria-disabled").catch(() => null);

    if (disabled === "true") {
      continue;
    }

    await next.click();
    await page.waitForTimeout(1500);
    return;
  }
}

async function isButtonEnabled(button: any) {
  const ariaDisabled = await button.getAttribute("aria-disabled").catch(() => null);
  const disabledAttr = await button.getAttribute("disabled").catch(() => null);

  return ariaDisabled !== "true" && disabledAttr === null;
}

async function findPostButton(page: any) {
  await clickPhotoNextIfNeeded(page);

  const dialog = createPostDialog(page).first();
  const scope = (await dialog.isVisible().catch(() => false))
    ? dialog
    : page.locator('[role="dialog"]').last();

  const locators = [
    scope.getByRole("button", { name: /^post$/i }),
    scope.getByRole("button", { name: /^đăng$/i }),
    scope.locator('[aria-label="Post"]'),
    scope.locator('[aria-label="Đăng"]'),
    scope.getByText(/^Post$/i),
    scope.getByText(/^Đăng$/i),
  ];

  for (const locator of locators) {
    const button = locator.last();

    if (!(await button.isVisible({ timeout: 800 }).catch(() => false))) {
      continue;
    }

    const clickable = button.locator(
      'xpath=ancestor-or-self::*[@role="button" or self::button][1]',
    );

    const target = (await clickable.isVisible().catch(() => false))
      ? clickable
      : button;

    if (await isButtonEnabled(target)) {
      return target;
    }
  }

  const buttons = scope.locator('[role="button"], button');
  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);

    if (!(await button.isVisible().catch(() => false))) {
      continue;
    }

    const label = normalizeLabel(
      `${(await button.getAttribute("aria-label").catch(() => "")) || ""} ${(await button.innerText().catch(() => "")) || ""}`,
    );

    if (!label || POST_BUTTON_SKIP.some((skip) => skip.test(label))) {
      continue;
    }

    if (!POST_BUTTON_PATTERNS.some((pattern) => pattern.test(label))) {
      continue;
    }

    if (await isButtonEnabled(button)) {
      return button;
    }
  }

  return null;
}

function composerDialog(page: any) {
  return page.locator('[role="dialog"]').filter({
    has: page.locator('[contenteditable="true"], [role="textbox"]'),
  });
}

async function waitForEnabledPostButton(page: any, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const button = await findPostButton(page);

    if (button) {
      return button;
    }

    await page.waitForTimeout(500);
  }

  return null;
}

async function attachImage(page: any, imagePath: string) {
  const dialog = composerDialog(page).last();
  const scope = (await dialog.isVisible().catch(() => false))
    ? dialog
    : page.locator('[role="dialog"]').last();

  const photoButton = scope.locator(
    '[aria-label="Photo/video"], [aria-label="Photo/Video"], [aria-label="Ảnh/video"], [aria-label="Ảnh/Video"]',
  ).first();

  if (await photoButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await photoButton.click().catch(() => {});
    await page.waitForTimeout(800);
  }

  const inputs = scope.locator('input[type="file"]');
  await inputs
    .first()
    .waitFor({ state: "attached", timeout: 8000 })
    .catch(() => {});

  let uploaded = false;
  const inputCount = await inputs.count();

  for (let i = 0; i < inputCount; i++) {
    const input = inputs.nth(i);
    const accept = ((await input.getAttribute("accept").catch(() => "")) || "").toLowerCase();

    if (accept && !/image|png|jpe?g|webp|\*/i.test(accept)) {
      continue;
    }

    try {
      await input.setInputFiles(imagePath);
      uploaded = true;
      break;
    } catch {
      // Try the next file input in the composer.
    }
  }

  if (!uploaded) {
    const fallback = page.locator('input[type="file"]').last();
    await fallback.setInputFiles(imagePath);
  }

  const previewOk = await scope
    .evaluate(() => {
      const images = document.querySelectorAll('[role="dialog"] img');

      for (let i = 0; i < images.length; i += 1) {
        const src = images[i].getAttribute("src") || "";
        const rect = images[i].getBoundingClientRect();

        if (src.indexOf("blob:") === 0 && rect.width > 80) {
          return true;
        }

        if (src.indexOf("scontent") !== -1 && rect.width > 140 && rect.height > 140) {
          return true;
        }
      }

      return false;
    })
    .catch(() => false);

  if (!previewOk) {
    await page.waitForTimeout(4000);
    const retryPreview = await scope
      .evaluate(() => {
        const images = document.querySelectorAll('[role="dialog"] img');

        for (let i = 0; i < images.length; i += 1) {
          const src = images[i].getAttribute("src") || "";
          const rect = images[i].getBoundingClientRect();

          if (src.indexOf("blob:") === 0 && rect.width > 80) {
            return true;
          }

          if (src.indexOf("scontent") !== -1 && rect.width > 140) {
            return true;
          }
        }

        return false;
      })
      .catch(() => false);

    if (!retryPreview) {
      throw new Error("Image was selected but Facebook did not show a photo preview.");
    }
  }

  log("INFO", "Photo attached in composer");
  await clickPhotoNextIfNeeded(page);
}

async function clickPublishInDialog(page: any) {
  const clicked = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');

    for (let d = dialogs.length - 1; d >= 0; d -= 1) {
      const buttons = dialogs[d].querySelectorAll('[role="button"], button');

      for (let b = 0; b < buttons.length; b += 1) {
        const button = buttons[b] as HTMLElement;
        const aria = (button.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const text = (button.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
        const isPost =
          /^(post|đăng|publish)$/.test(aria) || /^(post|đăng|publish)$/.test(text);

        if (!isPost) {
          continue;
        }

        if (button.getAttribute("aria-disabled") === "true") {
          continue;
        }

        button.scrollIntoView({ block: "center" });
        button.click();
        return aria || text;
      }
    }

    return "";
  });

  if (!clicked) {
    throw new Error("Could not click the Facebook Post/Đăng button in the composer.");
  }

  log("INFO", `Clicked publish button (${clicked})`);
  return clicked;
}

async function jsClick(locator: any) {
  const handle = await locator.elementHandle().catch(() => null);

  if (!handle) {
    return false;
  }

  return handle
    .evaluate((el: HTMLElement) => {
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return true;
    })
    .catch(() => false);
}

type PublishedPost = {
  id: string;
  url: string;
};

function permalinkForId(id: string) {
  if (/^https?:\/\//i.test(id)) {
    return id;
  }

  if (/^pfbid/i.test(id)) {
    return `https://www.facebook.com/permalink.php?story_fbid=${id}`;
  }

  return `https://www.facebook.com/story.php?story_fbid=${id}`;
}

function parseFacebookPostRef(value: string): PublishedPost | null {
  const raw = (value || "").trim();

  if (!raw) {
    return null;
  }

  if (/^(pfbid[A-Za-z0-9]+)$/i.test(raw) || /^\d{10,}$/.test(raw)) {
    return {
      id: raw,
      url: permalinkForId(raw),
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(raw, "https://www.facebook.com");
  } catch {
    return null;
  }

  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) {
    return null;
  }

  const story =
    parsed.searchParams.get("story_fbid") || parsed.searchParams.get("fbid");
  const posts = parsed.pathname.match(/\/posts\/(pfbid[A-Za-z0-9]+|\d+)/i);
  const permalink = parsed.pathname.match(/\/permalink\/(?:\d+\/)?(pfbid[A-Za-z0-9]+|\d+)/i);
  const media = parsed.pathname.match(/\/(?:videos|reel|watch)\/(\d+)/i);
  const id = story || posts?.[1] || permalink?.[1] || media?.[1] || "";

  if (!id) {
    return null;
  }

  if (/profile\.php|\/friends|\/photos\/?$|\/about/i.test(parsed.pathname)) {
    return null;
  }

  return {
    id,
    url: parsed.toString(),
  };
}

function collectPublishedPosts(value: unknown, hits: PublishedPost[], depth = 0) {
  if (depth > 14 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const found = parseFacebookPostRef(value);

    if (found) {
      hits.push(found);
    }

    return;
  }

  if (typeof value === "number" && Number.isFinite(value) && String(value).length >= 10) {
    const found = parseFacebookPostRef(String(value));

    if (found) {
      hits.push(found);
    }

    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectPublishedPosts(item, hits, depth + 1);
    }

    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const urlKeys = [
    "permalink_url",
    "wwwURL",
    "url",
    "shareable_url",
    "canonical_url",
    "story_url",
  ];
  const idKeys = [
    "legacy_story_id",
    "post_id",
    "story_fbid",
    "fbid",
    "photo_id",
  ];

  for (const key of urlKeys) {
    if (typeof record[key] === "string") {
      const found = parseFacebookPostRef(record[key] as string);

      if (found) {
        hits.push(found);
      }
    }
  }

  for (const key of idKeys) {
    const raw = record[key];

    if (typeof raw === "string" || typeof raw === "number") {
      const id = String(raw);

      if (/^(pfbid[A-Za-z0-9]+|\d{10,})$/i.test(id)) {
        hits.push({
          id,
          url: permalinkForId(id),
        });
      }
    }
  }

  for (const nested of Object.values(record)) {
    collectPublishedPosts(nested, hits, depth + 1);
  }
}

function pickBestPublishedPost(hits: PublishedPost[]) {
  const unique = new Map<string, PublishedPost>();

  for (const hit of hits) {
    const key = hit.url || hit.id;

    if (!unique.has(key)) {
      unique.set(key, hit);
    }
  }

  const ranked = [...unique.values()].sort((left, right) => {
    const score = (item: PublishedPost) => {
      const url = item.url || "";

      if (/\/posts\/|permalink\.php|story\.php/i.test(url) || /^pfbid/i.test(item.id)) {
        return 4;
      }

      if (/photo\.php|\/photo\//i.test(url)) {
        return 3;
      }

      if (/\/(videos|reel)\//i.test(url)) {
        return 2;
      }

      return 1;
    };

    return score(right) - score(left);
  });

  return ranked[0] || null;
}

function startPublishedPostCapture(page: any) {
  const hits: PublishedPost[] = [];

  const onResponse = async (response: any) => {
    try {
      const url = String(response.url() || "");

      if (!/facebook\.com/i.test(url)) {
        return;
      }

      const status = response.status();

      if (status < 200 || status >= 400) {
        return;
      }

      const fromUrl = parseFacebookPostRef(url);

      if (fromUrl) {
        hits.push(fromUrl);
      }

      const requestText = `${url} ${response.request().postData() || ""}`;
      const isComposerTraffic =
        /ComposerStoryCreate|useCometComposer|story_create|feed_story_create|CreateComposer|composer_story|CometComposer|composer/i.test(
          requestText,
        );

      let body = "";

      try {
        body = await response.text();
      } catch {
        return;
      }

      if (
        !isComposerTraffic &&
        !/legacy_story_id|permalink_url|story_create|composer_story|"post_id"/i.test(
          body.slice(0, 8000),
        )
      ) {
        return;
      }

      const cleaned = body.replace(/^for \(;;\);/, "").trim();

      if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
        return;
      }

      collectPublishedPosts(JSON.parse(cleaned), hits);
    } catch {
      // Ignore non-JSON traffic.
    }
  };

  page.on("response", onResponse);

  return {
    hits,
    stop() {
      page.off("response", onResponse);
    },
  };
}

async function collectPermalinkHrefs(page: any) {
  const hrefs = (await page
    .evaluate(() => {
      const anchors = document.querySelectorAll("a[href]");
      const out: string[] = [];

      for (let i = 0; i < anchors.length; i += 1) {
        out.push((anchors[i] as HTMLAnchorElement).href);
      }

      return out;
    })
    .catch(() => [])) as string[];

  return hrefs
    .map((href) => parseFacebookPostRef(href))
    .filter((item): item is PublishedPost => Boolean(item));
}

async function resolvePublishedPost(
  page: any,
  capture: { hits: PublishedPost[] },
  hrefsBefore: Set<string>,
) {
  const deadline = Date.now() + 18000;

  while (Date.now() < deadline) {
    const fresh = await collectPermalinkHrefs(page);

    for (const item of fresh) {
      if (!hrefsBefore.has(item.url) && !hrefsBefore.has(item.id)) {
        capture.hits.push(item);
      }
    }

    const fromLocation = parseFacebookPostRef(page.url());

    if (fromLocation) {
      capture.hits.push(fromLocation);
    }

    const best = pickBestPublishedPost(capture.hits);

    if (best) {
      return best;
    }

    await page.waitForTimeout(1000);
  }

  if (await openPublishedPostView(page)) {
    await page.waitForTimeout(2500);
    const fromView = parseFacebookPostRef(page.url());

    if (fromView) {
      return fromView;
    }
  }

  return pickBestPublishedPost(capture.hits);
}

async function openPublishedPost(page: any, published: PublishedPost) {
  const current = parseFacebookPostRef(page.url());

  if (current && (current.id === published.id || current.url === published.url)) {
    return;
  }

  await page.goto(published.url, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(5000);
  await dismissOverlays(page);
}

function normalizeSnippet(value: string) {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function postNeedles(content: string) {
  const hook =
    content
      .split(/\n+/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) || content;

  const compact = normalizeSnippet(hook);
  const sizes = [18, 24, 32, 40];
  const needles = sizes
    .map((size) => compact.slice(0, size).trim())
    .filter((needle) => needle.length >= 12);

  return [...new Set(needles)];
}

async function findPostCard(page: any, content: string) {
  const needles = postNeedles(content);

  for (const needle of needles) {
    const articles = page.getByRole("article").filter({ hasText: needle });
    const articleCount = await articles.count().catch(() => 0);

    for (let i = 0; i < Math.min(articleCount, 10); i += 1) {
      const article = articles.nth(i);
      await article.scrollIntoViewIfNeeded().catch(() => {});
      return article;
    }

    const texts = page.getByText(needle, { exact: false });
    const textCount = await texts.count().catch(() => 0);

    for (let i = 0; i < Math.min(textCount, 8); i += 1) {
      const text = texts.nth(i);
      await text.scrollIntoViewIfNeeded().catch(() => {});

      const article = text.locator("xpath=ancestor-or-self::*[@role='article'][1]");

      if (await article.count().catch(() => 0)) {
        return article.first();
      }

      const handle = await text.elementHandle().catch(() => null);

      if (!handle) {
        continue;
      }

      const found = await handle.evaluate((el: HTMLElement) => {
        let node: HTMLElement | null = el;

        while (node && node !== document.body) {
          let commentable = false;
          const labels = node.querySelectorAll("[aria-label], [role='textbox']");

          for (let i = 0; i < labels.length; i += 1) {
            const aria = labels[i].getAttribute("aria-label") || "";

            if (/comment|bình luận|write a comment|viết bình luận/i.test(aria)) {
              commentable = true;
              break;
            }
          }

          if (node.getAttribute("role") === "article" || commentable) {
            node.setAttribute("data-fb-comment-post", "1");
            node.scrollIntoView({ block: "center" });
            return true;
          }

          node = node.parentElement;
        }

        return false;
      });

      if (found) {
        const marked = page.locator('[data-fb-comment-post="1"]').first();

        if (await marked.count().catch(() => 0)) {
          return marked;
        }
      }
    }
  }

  const foundByDom = await page.evaluate((needles: string[]) => {
    const needlesN: string[] = [];

    for (let n = 0; n < needles.length; n += 1) {
      const cleaned = String(needles[n] || "")
        .replace(/[“”]/g, '"')
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      if (cleaned.length >= 12) {
        needlesN.push(cleaned);
      }
    }

    const marked = document.querySelectorAll("[data-fb-comment-post]");

    for (let m = 0; m < marked.length; m += 1) {
      marked[m].removeAttribute("data-fb-comment-post");
    }

    const candidates = document.querySelectorAll(
      '[role="article"], [data-pagelet*="Feed"], [data-pagelet*="ProfileTilesFeed"], [data-pagelet*="Timeline"]',
    );

    for (let c = 0; c < candidates.length; c += 1) {
      const node = candidates[c] as HTMLElement;
      const text = (node.innerText || "")
        .replace(/[“”]/g, '"')
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      let matched = false;

      for (let k = 0; k < needlesN.length; k += 1) {
        if (text.indexOf(needlesN[k]) !== -1) {
          matched = true;
          break;
        }
      }

      if (!matched) {
        continue;
      }

      node.setAttribute("data-fb-comment-post", "1");
      node.scrollIntoView({ block: "center" });
      return true;
    }

    const commentBoxes = document.querySelectorAll(
      '[aria-label*="Write a comment" i], [aria-label*="Viết bình luận" i], [aria-label*="comment" i], [aria-label*="bình luận" i]',
    );

    for (let b = 0; b < commentBoxes.length; b += 1) {
      let parent = commentBoxes[b].parentElement;

      while (parent && parent !== document.body) {
        const parentText = (parent.innerText || "")
          .replace(/[“”]/g, '"')
          .replace(/[’‘]/g, "'")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const height = parent.getBoundingClientRect().height;
        let parentMatched = false;

        for (let p = 0; p < needlesN.length; p += 1) {
          if (parentText.indexOf(needlesN[p]) !== -1) {
            parentMatched = true;
            break;
          }
        }

        if (height > 160 && parentMatched) {
          parent.setAttribute("data-fb-comment-post", "1");
          parent.scrollIntoView({ block: "center" });
          return true;
        }

        parent = parent.parentElement;
      }
    }

    return false;
  }, needles);

  if (foundByDom) {
    const marked = page.locator('[data-fb-comment-post="1"]').first();

    if (await marked.count().catch(() => 0)) {
      return marked;
    }
  }

  const recent = page.getByRole("article").filter({
    hasText: /just now|vừa xong|a minute ago|1m\b|giây trước|phút trước|few seconds/i,
  });

  if (await recent.count().catch(() => 0)) {
    return recent.first();
  }

  const marked = page.locator('[data-fb-comment-post="1"]').first();

  if (await marked.count().catch(() => 0)) {
    return marked;
  }

  return null;
}

async function waitForOwnPost(page: any, content: string, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let ticks = 0;

  while (Date.now() < deadline) {
    const post = await findPostCard(page, content);

    if (post) {
      await post.scrollIntoViewIfNeeded().catch(() => {});
      return post;
    }

    ticks += 1;

    if (ticks >= 3) {
      await page.mouse.wheel(0, 600).catch(() => {});
    }

    await page.waitForTimeout(1200);
  }

  return null;
}

async function openPublishedPostView(page: any) {
  const viewPatterns = [
    /^(view|see post|see it|xem bài viết|xem bài|^xem$)$/i,
    /view post/i,
    /see post/i,
  ];

  const toast = page.locator('[role="status"], [role="alert"], [aria-live]');
  const scopes = [toast, page];

  for (const scope of scopes) {
    for (const pattern of viewPatterns) {
      const button = scope.getByRole("button", { name: pattern }).first();

      if (await button.isVisible({ timeout: 600 }).catch(() => false)) {
        await jsClick(button);
        await page.waitForTimeout(4000);
        return true;
      }

      const link = scope.getByRole("link", { name: pattern }).first();

      if (await link.isVisible({ timeout: 400 }).catch(() => false)) {
        await jsClick(link);
        await page.waitForTimeout(4000);
        return true;
      }
    }
  }

  const permalink = toast
    .locator(
      'a[href*="/posts/"], a[href*="story.php"], a[href*="story_fbid"], a[href*="/permalink"]',
    )
    .first();

  if (await permalink.isVisible({ timeout: 800 }).catch(() => false)) {
    await jsClick(permalink);
    await page.waitForTimeout(4000);
    return true;
  }

  const justNow = page
    .getByRole("link", { name: /just now|vừa xong|a minute ago|giây trước|phút trước/i })
    .first();

  if (await justNow.isVisible({ timeout: 800 }).catch(() => false)) {
    await jsClick(justNow);
    await page.waitForTimeout(4000);
    return true;
  }

  return false;
}

async function openOwnProfile(page: any) {
  const profileLinks = [
    page.locator('[aria-label="Your profile"]'),
    page.locator('[aria-label="Trang cá nhân của bạn"]'),
    page.getByRole("link", { name: /^(your profile|trang cá nhân)/i }),
  ];

  for (const locator of profileLinks) {
    const link = locator.first();

    if (await link.isVisible({ timeout: 800 }).catch(() => false)) {
      await jsClick(link);
      await page.waitForTimeout(5000);
      return;
    }
  }

  await page.goto("https://www.facebook.com/me", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(5000);
}

async function openPostsTab(page: any) {
  const tab = page.getByRole("tab", { name: /^(posts|bài viết)$/i }).first();

  if (await tab.isVisible({ timeout: 1500 }).catch(() => false)) {
    await jsClick(tab);
    await page.waitForTimeout(2500);
    return;
  }

  const link = page.getByRole("link", { name: /^(posts|bài viết)$/i }).first();

  if (await link.isVisible({ timeout: 800 }).catch(() => false)) {
    await jsClick(link);
    await page.waitForTimeout(2500);
  }
}

async function findCommentBox(scope: any) {
  const locators = [
    scope.locator('[aria-label*="Write a comment" i]'),
    scope.locator('[aria-label*="Viết bình luận" i]'),
    scope.locator('[aria-placeholder*="comment" i]'),
    scope.locator('[aria-placeholder*="bình luận" i]'),
    scope.locator('[role="textbox"]'),
    scope.locator('[contenteditable="true"]'),
  ];

  for (const locator of locators) {
    const count = await locator.count();

    for (let i = 0; i < count; i += 1) {
      const box = locator.nth(i);

      if (!(await box.isVisible().catch(() => false))) {
        continue;
      }

      const aria =
        `${(await box.getAttribute("aria-label").catch(() => "")) || ""} ${(await box.getAttribute("aria-placeholder").catch(() => "")) || ""}`;

      if (/search|tìm|message|tin nhắn|chat|create post|tạo bài|mind|nghĩ/i.test(aria)) {
        continue;
      }

      if (/comment|bình luận/i.test(aria) || locator === locators[0] || locator === locators[1]) {
        return box;
      }
    }
  }

  return null;
}

async function openCommentBox(page: any, post: any) {
  let box = await findCommentBox(post);

  if (box) {
    return box;
  }

  const commentButtons = [
    post.getByRole("button", { name: /^(comment|leave a comment|bình luận)$/i }),
    post.locator('[aria-label="Leave a comment"]'),
    post.locator('[aria-label="Comment"]'),
    post.locator('[aria-label="Bình luận"]'),
  ];

  for (const locator of commentButtons) {
    const button = locator.first();

    if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
      await jsClick(button);
      await page.waitForTimeout(1500);
      box = await findCommentBox(post);

      if (box) {
        return box;
      }
    }
  }

  throw new Error("Facebook comment box was not found on the published post.");
}

async function commentBoxValue(box: any) {
  return box
    .evaluate((el: HTMLElement) =>
      (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
    )
    .catch(() => "");
}

async function clickCommentSend(page: any, box: any) {
  const handle = await box.elementHandle().catch(() => null);

  if (handle) {
    const clicked = await handle
      .evaluate((el: HTMLElement) => {
        let node: HTMLElement | null = el;

        for (let depth = 0; depth < 14 && node; depth += 1) {
          const buttons = node.querySelectorAll('[role="button"], button');

          for (let b = 0; b < buttons.length; b += 1) {
            const aria = (buttons[b].getAttribute("aria-label") || "").toLowerCase();

            if (
              /press enter to post|nhấn enter|nhan enter|để đăng|de dang|^send$|^gửi$|^gui$|post comment|đăng bình luận/.test(
                aria,
              )
            ) {
              (buttons[b] as HTMLElement).click();
              return true;
            }
          }

          node = node.parentElement;
        }

        return false;
      })
      .catch(() => false);

    if (clicked) {
      return true;
    }
  }

  const send = page
    .locator(
      '[aria-label="Press Enter to post"], [aria-label="Nhấn Enter để đăng"], [aria-label="Send"], [aria-label="Gửi"]',
    )
    .last();

  if (await send.isVisible({ timeout: 1200 }).catch(() => false)) {
    await jsClick(send);
    return true;
  }

  return false;
}

async function typeComment(page: any, box: any, comment: string) {
  await box.scrollIntoViewIfNeeded();
  await jsClick(box);
  await box.click({ force: true }).catch(() => {});
  await page.waitForTimeout(400);
  await page.keyboard.press("Control+A").catch(() => {});
  await page.waitForTimeout(80);
  await page.keyboard.press("Backspace").catch(() => {});
  await page.keyboard.insertText(comment);
  await page.waitForTimeout(500);

  const snippet = comment.replace(/\s+/g, " ").trim().slice(0, 12);
  const landed = (await commentBoxValue(box)).includes(snippet);

  if (!landed) {
    await box.click({ force: true }).catch(() => {});
    await page.keyboard.type(comment, { delay: 12 });
    await page.waitForTimeout(300);
  }

  const sent = await clickCommentSend(page, box);

  if (!sent) {
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(400);
  }

  if ((await commentBoxValue(box)).includes(snippet)) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
  }

  if ((await commentBoxValue(box)).includes(snippet)) {
    await clickCommentSend(page, box);
  }
}

async function commentAppeared(page: any, comment: string) {
  const snippet = comment.replace(/\s+/g, " ").trim().slice(0, 18);

  if (!snippet) {
    return false;
  }

  return page
    .evaluate((needle: string) => {
      const n = String(needle || "").toLowerCase();
      const nodes = document.querySelectorAll("div, span, [role='article']");

      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i] as HTMLElement;

        if (el.getAttribute("contenteditable") === "true") {
          continue;
        }

        if (el.getAttribute("role") === "textbox") {
          continue;
        }

        if (el.querySelector("[contenteditable='true'], [role='textbox']")) {
          continue;
        }

        const aria = (el.getAttribute("aria-label") || "").toLowerCase();

        if (/write a comment|viết bình luận|comment as/.test(aria)) {
          continue;
        }

        const text = (el.innerText || "").replace(/\s+/g, " ").toLowerCase();

        if (text.indexOf(n) !== -1) {
          return true;
        }
      }

      return false;
    }, snippet)
    .catch(() => false);
}

async function clickCommentOverflow(page: any, post: any, comment: string) {
  const snippet = comment.slice(0, 36);
  const commentArticle = post.getByRole("article").filter({ hasText: snippet }).first();
  const commentText = post.getByText(snippet).first();
  const scope = (await commentArticle.isVisible().catch(() => false))
    ? commentArticle
    : commentText;

  await commentText.scrollIntoViewIfNeeded().catch(() => {});
  await scope.hover().catch(() => {});

  const box = await scope.boundingBox().catch(() => null);

  if (box) {
    await page.mouse.move(box.x + Math.max(box.width - 24, 8), box.y + 10);
  }

  await page.waitForTimeout(700);

  const menuButtons = [
    scope.locator('[aria-label="Actions for this comment"]'),
    scope.locator('[aria-label*="actions for this comment" i]'),
    scope.locator('[aria-label="More"]'),
    scope.getByRole("button", {
      name: /more|tùy chọn|tuỳ chọn|actions for this comment/i,
    }),
    scope.locator('[aria-haspopup="menu"]'),
    post.locator('[aria-label="Actions for this comment"]'),
  ];

  for (const locator of menuButtons) {
    const button = locator.last();

    if (await button.isVisible({ timeout: 700 }).catch(() => false)) {
      await jsClick(button);
      return true;
    }
  }

  return post.evaluate((root: HTMLElement, needle: string) => {
    const lower = String(needle || "").toLowerCase();
    const articles = root.querySelectorAll('[role="article"]');
    let commentRoot: Element | null = null;

    for (let i = articles.length - 1; i >= 0; i -= 1) {
      if ((articles[i].textContent || "").toLowerCase().indexOf(lower) !== -1) {
        commentRoot = articles[i];
        break;
      }
    }

    if (!commentRoot) {
      const divs = root.querySelectorAll("div");

      for (let d = 0; d < divs.length; d += 1) {
        const text = ((divs[d] as HTMLElement).innerText || "").replace(/\s+/g, " ");

        if (text.toLowerCase().indexOf(lower) !== -1 && text.length < 500) {
          commentRoot = divs[d];
          break;
        }
      }
    }

    if (!commentRoot) {
      return false;
    }

    commentRoot.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const buttons = commentRoot.querySelectorAll(
      '[role="button"], button, [aria-haspopup="menu"]',
    );

    for (let b = 0; b < buttons.length; b += 1) {
      const aria = (buttons[b].getAttribute("aria-label") || "").toLowerCase();

      if (/action|more|tùy|tuỳ|menu|option/.test(aria)) {
        (buttons[b] as HTMLElement).click();
        return true;
      }
    }

    if (buttons.length) {
      (buttons[buttons.length - 1] as HTMLElement).click();
      return true;
    }

    return false;
  }, snippet);
}

async function clickPinAction(page: any) {
  const pinName =
    /pin comment|pin this comment|pin to top|ghim bình luận|^pin$|^ghim$/i;

  const menuPin = page.getByRole("menuitem", { name: pinName }).first();

  if (await menuPin.isVisible({ timeout: 4000 }).catch(() => false)) {
    await jsClick(menuPin);
    return true;
  }

  const buttonPin = page.getByRole("button", { name: pinName }).first();

  if (await buttonPin.isVisible({ timeout: 1000 }).catch(() => false)) {
    await jsClick(buttonPin);
    return true;
  }

  const textPin = page.getByText(pinName).first();

  if (await textPin.isVisible({ timeout: 1000 }).catch(() => false)) {
    await jsClick(textPin);
    return true;
  }

  return page.evaluate(() => {
    const items = document.querySelectorAll(
      '[role="menuitem"], [role="button"], span, div',
    );

    for (let i = 0; i < items.length; i += 1) {
      const text = ((items[i] as HTMLElement).innerText || "")
        .replace(/\s+/g, " ")
        .trim();

      if (
        /^(pin comment|pin this comment|pin to top|ghim bình luận|pin|ghim)$/i.test(
          text,
        )
      ) {
        (items[i] as HTMLElement).click();
        return true;
      }
    }

    return false;
  });
}

async function confirmPinDialog(page: any) {
  const dialog = page.getByRole("dialog").filter({
    hasText: /pin comment|pin this comment|ghim bình luận|ghim/i,
  });

  if (!(await dialog.first().isVisible({ timeout: 2500 }).catch(() => false))) {
    return;
  }

  const confirm = dialog
    .first()
    .getByRole("button", { name: /^(pin|ghim|pin comment|ghim bình luận)$/i })
    .last();

  if (await confirm.isVisible().catch(() => false)) {
    await jsClick(confirm);
  }
}

async function commentAndPinOnLatestPost(
  page: any,
  content: string,
  comment?: string,
  published?: PublishedPost | null,
) {
  const text = (comment || "").replace(/\s+/g, " ").trim();

  if (!text) {
    throw new Error("No comment was generated for this post.");
  }

  let post = null;

  if (published?.url) {
    log("INFO", `Opening Facebook post ${published.id}`);
    await openPublishedPost(page, published);
    post = page.getByRole("article").first();

    if (!(await post.count().catch(() => 0))) {
      post = page.locator("body");
    }
  } else {
    const needle = postNeedles(content)[0] || "";
    log("INFO", `No post ID yet; searching the feed (${needle})`);

    await page.waitForTimeout(4000);
    await dismissOverlays(page);

    post = await waitForOwnPost(page, content, 12000);

    if (!post && (await openPublishedPostView(page))) {
      await dismissOverlays(page);
      post = await waitForOwnPost(page, content, 12000);
    }

    if (!post) {
      await page.goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(6000);
      await dismissOverlays(page);
      post = await waitForOwnPost(page, content, 15000);
    }

    if (!post) {
      await openOwnProfile(page);
      await dismissOverlays(page);
      await openPostsTab(page);
      post = await waitForOwnPost(page, content, 18000);
    }
  }

  if (!post) {
    throw new Error("Could not find the published post to comment on.");
  }

  await post.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(1000);

  let box = await findCommentBox(post);

  if (!box) {
    box = await openCommentBox(page, post).catch(() => null);
  }

  if (!box) {
    box = await findCommentBox(page);
  }

  if (!box) {
    throw new Error("Facebook comment box was not found on the published post.");
  }

  await typeComment(page, box, text);

  let appeared = false;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.waitForTimeout(1200);

    if (await commentAppeared(page, text)) {
      appeared = true;
      break;
    }

    const leftover = await commentBoxValue(box);

    if (leftover && leftover.includes(text.slice(0, 10))) {
      await clickCommentSend(page, box);
      await page.keyboard.press("Control+Enter");
      await page.waitForTimeout(300);
      await page.keyboard.press("Enter");
    }
  }

  if (!appeared) {
    throw new Error("Comment was typed but did not appear on the post.");
  }

  log("INFO", `Commented on post ${published?.id || ""}: "${text}"`);

  let pinned = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const opened = await clickCommentOverflow(page, post, text);

    if (!opened) {
      await page.waitForTimeout(1000);
      continue;
    }

    await page.waitForTimeout(800);
    pinned = await clickPinAction(page);

    if (pinned) {
      break;
    }

    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(800);
  }

  if (!pinned) {
    throw new Error("Pin comment action was not found.");
  }

  await confirmPinDialog(page);
  await page.waitForTimeout(2000);
  log("INFO", "Pinned the comment");
}

export async function publishPost(
  content: string,
  imagePath?: string,
  profileId?: string,
  comment?: string,
) {
  await startBrowser(profileId);

  let page = getPage();

  try {
    await openFacebook();
    page = getPage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!/closed|Target page/i.test(message)) {
      throw error;
    }

    await stopBrowser().catch(() => {});
    await startBrowser(profileId);
    await openFacebook();
    page = getPage();
  }

  await page.waitForTimeout(60_000);

  await dismissOverlays(page);
  await ensureLoggedIn(page);

  const createPostButton = await findCreatePostButton(page);

  if (!createPostButton) {
    throw new Error("Facebook Create Post button was not found.");
  }

  await createPostButton.scrollIntoViewIfNeeded();
  await createPostButton.click({ force: true });

  await page.waitForTimeout(5000);

  let composer = await findComposer(page);

  if (!composer) {
    log("INFO", "Composer not found after first click, retrying Create Post");
    await dismissOverlays(page);
    await createPostButton.click({ force: true }).catch(() => {});
    await page.waitForTimeout(4000);
    composer = await findComposer(page);
  }

  if (!composer) {
    throw new Error("Facebook post composer was not found.");
  }

  await typeIntoComposer(page, composer, content);

  if (!imagePath) {
    throw new Error("No image was generated for this post.");
  }

  await attachImage(page, imagePath);
  await page.waitForTimeout(8_000);
  await page.waitForTimeout(60_000);

  const postButton = await waitForEnabledPostButton(page, 45000);

  if (!postButton) {
    throw new Error("Facebook publish button was not found or stayed disabled.");
  }

  const hrefsBefore = new Set(
    (await collectPermalinkHrefs(page)).flatMap((item) => [item.id, item.url]),
  );
  const capture = startPublishedPostCapture(page);

  await clickPublishInDialog(page).catch(async () => {
    log("INFO", "DOM publish click missed, retrying with Playwright click");
    await postButton.scrollIntoViewIfNeeded();
    await postButton.click({ force: true });
  });

  const openComposer = composerDialog(page).last();
  const stillVisible = await openComposer
    .waitFor({ state: "hidden", timeout: 25000 })
    .then(() => false)
    .catch(async () => openComposer.isVisible().catch(() => true));

  if (stillVisible) {
    await clickPublishInDialog(page).catch(async () => {
      const retry = await waitForEnabledPostButton(page, 8000);
      if (retry) {
        await retry.click({ force: true });
      }
    });

    const stillOpen = await openComposer.isVisible().catch(() => false);

    if (stillOpen) {
      throw new Error(
        "Publish button click did not submit the post. The composer is still open.",
      );
    }
  }

  log("INFO", "Composer closed after publish");

  let published: PublishedPost | null = null;

  try {
    published = await resolvePublishedPost(page, capture, hrefsBefore);
  } finally {
    capture.stop();
  }

  if (published) {
    log("INFO", `Facebook post id ${published.id}`);
  } else {
    log("WARN", "Could not capture the Facebook post id after publish");
  }

  try {
    await commentAndPinOnLatestPost(page, content, comment, published);
  } catch (error) {
    log(
      "ERROR",
      `Post went up, but comment/pin failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  log("INFO", "Leaving the browser open after posting");
}
