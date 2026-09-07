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
      const images = [...document.querySelectorAll('[role="dialog"] img')];

      return images.some((img) => {
        const src = img.getAttribute("src") || "";
        const rect = img.getBoundingClientRect();

        if (src.startsWith("blob:") && rect.width > 80) {
          return true;
        }

        return src.includes("scontent") && rect.width > 140 && rect.height > 140;
      });
    })
    .catch(() => false);

  if (!previewOk) {
    await page.waitForTimeout(4000);
    const retryPreview = await scope
      .evaluate(() => {
        const images = [...document.querySelectorAll('[role="dialog"] img')];
        return images.some((img) => {
          const src = img.getAttribute("src") || "";
          const rect = img.getBoundingClientRect();
          return (
            (src.startsWith("blob:") && rect.width > 80) ||
            (src.includes("scontent") && rect.width > 140)
          );
        });
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
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].reverse();

    for (const dialog of dialogs) {
      const buttons = [...dialog.querySelectorAll('[role="button"], button')];

      for (const button of buttons) {
        const aria = normalize(button.getAttribute("aria-label") || "");
        const text = normalize((button as HTMLElement).innerText || "");
        const isPost =
          /^(post|đăng|publish)$/.test(aria) || /^(post|đăng|publish)$/.test(text);

        if (!isPost) {
          continue;
        }

        if (button.getAttribute("aria-disabled") === "true") {
          continue;
        }

        (button as HTMLElement).scrollIntoView({ block: "center" });
        (button as HTMLElement).click();
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

export async function publishPost(
  content: string,
  imagePath?: string,
  profileId?: string,
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
  log("INFO", "Waiting a few seconds before closing the browser");
  await page.waitForTimeout(8_000);
}
