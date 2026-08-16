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
  const dialog = createPostDialog(page).first();
  const scope = (await dialog.isVisible().catch(() => false))
    ? dialog
    : page;

  let fileInput = scope.locator('input[type="file"][accept*="image"], input[type="file"]').first();

  if ((await fileInput.count()) === 0) {
    const photoButton = scope
      .getByRole("button", { name: /photo|video|ảnh/i })
      .first();

    if (await photoButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await photoButton.click();
      await page.waitForTimeout(800);
    }

    fileInput = scope.locator('input[type="file"]').first();
  }

  if ((await fileInput.count()) === 0) {
    fileInput = page.locator('input[type="file"]').first();
  }

  if ((await fileInput.count()) === 0) {
    throw new Error("Facebook photo upload input was not found.");
  }

  await fileInput.setInputFiles(imagePath);

  const preview = scope.locator('img[src^="blob:"], img[src*="scontent"]').first();
  const previewVisible = await preview
    .waitFor({ state: "visible", timeout: 20000 })
    .then(() => true)
    .catch(() => false);

  if (!previewVisible) {
    await page.waitForTimeout(3000);
  }
}

function composerDialog(page: any) {
  return page.locator('[role="dialog"]').filter({
    has: page.locator('[contenteditable="true"], [role="textbox"]'),
  });
}

async function clickPublishInDialog(page: any) {
  const clicked = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].reverse();

    for (const dialog of dialogs) {
      const buttons = [...dialog.querySelectorAll('[role="button"], button')];

      for (const button of buttons) {
        const label = (
          button.getAttribute("aria-label") ||
          button.textContent ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim();

        if (!/^(post|đăng)$/i.test(label)) {
          continue;
        }

        if (button.getAttribute("aria-disabled") === "true") {
          continue;
        }

        (button as HTMLElement).click();
        return label;
      }
    }

    return "";
  });

  if (!clicked) {
    throw new Error("Could not click the Facebook Post/Đăng button in the composer.");
  }

  return clicked;
}

export async function publishPost(content: string, imagePath?: string) {
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

  await page.waitForTimeout(3000);

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

  if (imagePath) {
    await attachImage(page, imagePath);
    await page.waitForTimeout(3000);
  }

  const postButton = await waitForEnabledPostButton(page, 35000);

  if (!postButton) {
    throw new Error("Facebook publish button was not found or stayed disabled.");
  }

  await clickPublishInDialog(page).catch(async () => {
    await postButton.scrollIntoViewIfNeeded();
    await postButton.click({ force: true });
  });

  const openComposer = composerDialog(page).last();
  const closed = await openComposer
    .waitFor({ state: "hidden", timeout: 25000 })
    .then(() => true)
    .catch(() => false);

  if (!closed && (await openComposer.isVisible().catch(() => false))) {
    await clickPublishInDialog(page).catch(async () => {
      const retry = await waitForEnabledPostButton(page, 5000);
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
}
