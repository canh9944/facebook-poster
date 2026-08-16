import { getPage, openFacebook, startBrowser, stopBrowser } from "./browser.js";

const CREATE_POST_PATTERNS = [
  /what'?s on your mind/i,
  /bạn đang nghĩ gì/i,
  /create (a )?post/i,
  /tạo bài viết/i,
  /write something/i,
  /viết gì đó/i,
  /you think/i,
];

const POST_BUTTON_PATTERNS = [
  /^post$/i,
  /^đăng$/i,
  /^publish$/i,
  /^chia sẻ$/i,
  /^share$/i,
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
    hasText: /tạo bài viết|create (a )?post|create post/i,
  });
}

async function findComposer(page: any) {
  const dialog = createPostDialog(page);

  await dialog
    .first()
    .waitFor({ state: "visible", timeout: 10000 })
    .catch(() => {});

  for (let attempt = 0; attempt < 20; attempt++) {
    const scope = (await dialog.first().isVisible().catch(() => false))
      ? dialog.first()
      : page.locator('[role="dialog"]').last();

    if (await scope.isVisible().catch(() => false)) {
      const dialogEditors = scope.locator(
        '[role="textbox"], [contenteditable="true"], [contenteditable="plaintext-only"]',
      );

      const count = await dialogEditors.count();

      for (let i = 0; i < count; i++) {
        const editor = dialogEditors.nth(i);

        if (!(await editor.isVisible().catch(() => false))) {
          continue;
        }

        const aria =
          (await editor.getAttribute("aria-label").catch(() => "")) || "";

        if (/search|tìm/i.test(aria)) {
          continue;
        }

        return editor;
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
  await page.keyboard.insertText(content);
  await page.waitForTimeout(800);

  const typed = await composer
    .evaluate((el: HTMLElement) => (el.innerText || "").trim())
    .catch(() => "");

  if (!typed) {
    await composer.click();
    await page.keyboard.type(content, { delay: 20 });
  }
}

function normalizeLabel(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function findPostButton(page: any) {
  const dialog = createPostDialog(page).first();
  const scope = (await dialog.isVisible().catch(() => false))
    ? dialog
    : page.locator('[role="dialog"]').last();

  const named = scope.locator(
    '[aria-label="Đăng"], [aria-label="Post"], [aria-label="Share"], [aria-label="Publish"], [aria-label="Chia sẻ"]',
  );

  if (await named.last().isVisible({ timeout: 1000 }).catch(() => false)) {
    const disabled = await named
      .last()
      .getAttribute("aria-disabled")
      .catch(() => null);

    if (disabled !== "true") {
      return named.last();
    }
  }

  const textButton = scope.getByText(/^(Đăng|Post|Share|Publish|Chia sẻ)$/i).last();

  if (await textButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    const button = textButton.locator('xpath=ancestor-or-self::*[@role="button" or self::button][1]');

    if (await button.isVisible().catch(() => false)) {
      const disabled = await button.getAttribute("aria-disabled").catch(() => null);

      if (disabled !== "true") {
        return button;
      }
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

    const disabled = await button.getAttribute("aria-disabled").catch(() => null);

    if (disabled === "true") {
      continue;
    }

    return button;
  }

  return null;
}

export async function publishPost(content: string) {
  await startBrowser();

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
    await startBrowser();
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

  await page.waitForTimeout(1500);

  const composer = await findComposer(page);

  if (!composer) {
    throw new Error("Facebook post composer was not found.");
  }

  await typeIntoComposer(page, composer, content);
  await page.waitForTimeout(120_000);

  const postButton = await findPostButton(page);

  if (!postButton) {
    throw new Error("Facebook publish button was not found.");
  }

  await postButton.scrollIntoViewIfNeeded();
  await postButton.click({ force: true });
  await page.waitForTimeout(4000);
}
