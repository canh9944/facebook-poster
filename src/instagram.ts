import path from "node:path";
import { getContext, startBrowser, stopBrowser } from "./browser.js";
import { log } from "./db.js";

async function dismissOverlays(page: any) {
  const overlayTexts = [
    /allow all cookies/i,
    /accept all/i,
    /accept cookies/i,
    /cho phép tất cả/i,
    /chấp nhận tất cả/i,
    /not now/i,
    /để sau/i,
    /save info/i,
    /turn on notifications/i,
    /bật thông báo/i,
  ];

  for (const pattern of overlayTexts) {
    const button = page.getByRole("button", { name: pattern }).first();

    if (await button.isVisible({ timeout: 600 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}

async function ensureLoggedIn(page: any) {
  const url = page.url();

  if (/accounts\/login|accounts\/emailsignup|challenge/i.test(url)) {
    throw new Error(
      "Instagram is not logged in. Log in once in the opened browser, then retry.",
    );
  }

  const username = page.locator('input[name="username"]').first();

  if (await username.isVisible({ timeout: 1000 }).catch(() => false)) {
    throw new Error(
      "Instagram is not logged in. Log in once in the opened browser, then retry.",
    );
  }
}

async function clickCreate(page: any) {
  const locators = [
    page.locator('svg[aria-label="New post"]').first(),
    page.locator('svg[aria-label="Create"]').first(),
    page.locator('svg[aria-label="Tạo"]').first(),
    page.locator('svg[aria-label="Bài viết mới"]').first(),
    page.locator('[aria-label="New post"]').first(),
    page.locator('[aria-label="Create"]').first(),
    page.locator('[aria-label="Tạo"]').first(),
    page.getByRole("link", { name: /^(create|new post|tạo)$/i }).first(),
    page.getByRole("button", { name: /^(create|new post|tạo)$/i }).first(),
    page.getByText(/^(create|tạo)$/i).first(),
  ];

  for (const locator of locators) {
    if (!(await locator.isVisible({ timeout: 800 }).catch(() => false))) {
      continue;
    }

    await locator.click({ force: true }).catch(async () => {
      const parent = locator.locator(
        'xpath=ancestor::*[@role="link" or @role="button" or self::a or self::button][1]',
      );

      if (await parent.isVisible().catch(() => false)) {
        await parent.click({ force: true });
      }
    });

    await page.waitForTimeout(1500);
    return true;
  }

  return false;
}

async function choosePostType(page: any) {
  const locators = [
    page.getByRole("button", { name: /^(post|bài viết)$/i }).last(),
    page.getByText(/^(post|bài viết)$/i).last(),
    page.locator('[role="menu"] [role="menuitem"], [role="dialog"] [role="button"]').filter({
      hasText: /^(post|bài viết)$/i,
    }).first(),
  ];

  for (const locator of locators) {
    if (await locator.isVisible({ timeout: 800 }).catch(() => false)) {
      await locator.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1200);
      return;
    }
  }
}

async function uploadPhoto(page: any, imagePath: string | string[]) {
  const files = (Array.isArray(imagePath) ? imagePath : [imagePath]).map(
    (file) => path.resolve(file),
  );

  if (!files.length) {
    throw new Error("No image file to attach.");
  }

  const multi = page
    .getByRole("button", { name: /select multiple|chọn nhiều/i })
    .first();

  if (
    files.length > 1 &&
    (await multi.isVisible({ timeout: 800 }).catch(() => false))
  ) {
    await multi.click({ force: true }).catch(() => {});
    await page.waitForTimeout(600);
  }

  const inputs = page.locator('input[type="file"]');
  const inputCount = await inputs.count();

  for (let i = inputCount - 1; i >= 0; i -= 1) {
    const input = inputs.nth(i);
    const accept = (
      (await input.getAttribute("accept").catch(() => "")) || ""
    ).toLowerCase();

    if (accept && !/image|png|jpe?g|webp|\*/i.test(accept)) {
      continue;
    }

    try {
      if (files.length > 1) {
        await input.evaluate((el: HTMLInputElement) => {
          el.setAttribute("multiple", "");
        });
      }

      await input.setInputFiles(files);
      await page.waitForTimeout(files.length > 1 ? 6000 : 4000);
      return;
    } catch {
      // Try the next file input.
    }
  }

  const select = page
    .getByRole("button", {
      name: /select from computer|chọn từ máy tính|chọn tệp/i,
    })
    .first();

  if (await select.isVisible({ timeout: 3000 }).catch(() => false)) {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      select.click(),
    ]);
    await chooser.setFiles(files);
    await page.waitForTimeout(files.length > 1 ? 6000 : 4000);
    return;
  }

  throw new Error("Instagram photo picker was not found.");
}

async function hasShareButton(page: any) {
  return page
    .getByRole("button", { name: /^(share|chia sẻ)$/i })
    .last()
    .isVisible()
    .catch(() => false);
}

async function captionBox(page: any) {
  const locators = [
    page.getByRole("textbox", { name: /caption|chú thích|chu thich|write a caption/i }).first(),
    page.locator('[aria-label*="Write a caption" i]').first(),
    page.locator('[aria-label*="Viết chú thích" i]').first(),
    page.locator('[aria-label*="caption" i]').first(),
    page.locator('[aria-label*="chú thích" i]').first(),
    page.locator('[placeholder*="Write a caption" i]').first(),
    page.locator('[placeholder*="Viết chú thích" i]').first(),
    page.locator('[contenteditable="true"][aria-label*="caption" i]').first(),
    page.locator('[contenteditable="true"][aria-label*="chú thích" i]').first(),
  ];

  for (const locator of locators) {
    if (await locator.isVisible({ timeout: 400 }).catch(() => false)) {
      const aria = `${(await locator.getAttribute("aria-label").catch(() => "")) || ""} ${(await locator.getAttribute("placeholder").catch(() => "")) || ""}`;

      if (/search|tìm kiếm|message|tin nhắn/i.test(aria)) {
        continue;
      }

      return locator;
    }
  }

  const dialog = page.locator('[role="dialog"]').last();

  if (!(await dialog.isVisible({ timeout: 400 }).catch(() => false))) {
    return null;
  }

  const candidates = dialog.locator(
    '[contenteditable="true"], [role="textbox"], textarea',
  );
  const count = await candidates.count();

  for (let i = 0; i < count; i += 1) {
    const box = candidates.nth(i);

    if (!(await box.isVisible().catch(() => false))) {
      continue;
    }

    const aria = `${(await box.getAttribute("aria-label").catch(() => "")) || ""} ${(await box.getAttribute("placeholder").catch(() => "")) || ""}`;

    if (/search|tìm kiếm|message|tin nhắn/i.test(aria)) {
      continue;
    }

    const size = await box.boundingBox().catch(() => null);

    if (size && size.width >= 140 && size.height >= 36) {
      return box;
    }
  }

  return null;
}

async function clickDialogHeaderAction(page: any, labels: string[]) {
  const pattern = new RegExp(`^(${labels.join("|")})$`, "i");
  const byRole = page.getByRole("button", { name: pattern }).last();

  if (await byRole.isVisible({ timeout: 800 }).catch(() => false)) {
    const disabled = await byRole.getAttribute("aria-disabled").catch(() => null);

    if (disabled !== "true") {
      await byRole.click({ force: true });
      return true;
    }
  }

  const clicked = await page.evaluate((names: string[]) => {
    const wanted = names.map((name) => name.toLowerCase());
    const dialogs = Array.from(
      document.querySelectorAll('[role="dialog"]'),
    ) as HTMLElement[];
    const root = dialogs[dialogs.length - 1] || document.body;
    const nodes = Array.from(
      root.querySelectorAll('[role="button"], button'),
    ) as HTMLElement[];

    const matches: Array<{ el: HTMLElement; x: number; y: number }> = [];

    for (const node of nodes) {
      if (node.getAttribute("aria-disabled") === "true") {
        continue;
      }

      const aria = (node.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const own = Array.from(node.childNodes)
        .map((child) => (child.textContent || "").trim())
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const text = (node.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
      const hit = wanted.some(
        (name) => aria === name || own === name || text === name,
      );

      if (!hit) {
        continue;
      }

      const rect = node.getBoundingClientRect();

      if (rect.width < 8 || rect.height < 8) {
        continue;
      }

      matches.push({ el: node, x: rect.right, y: rect.top });
    }

    matches.sort((a, b) => a.y - b.y || b.x - a.x);

    if (!matches[0]) {
      return false;
    }

    matches[0].el.click();
    return true;
  }, labels);

  return Boolean(clicked);
}

async function waitForPhotoReady(page: any) {
  for (let i = 0; i < 16; i += 1) {
    if (await captionBox(page)) {
      return;
    }

    const nextVisible = await page
      .getByRole("button", { name: /^(next|tiếp|tiếp theo)$/i })
      .last()
      .isVisible()
      .catch(() => false);

    if (nextVisible) {
      return;
    }

    const preview = page.locator('[role="dialog"] img, [role="dialog"] canvas').first();

    if (await preview.isVisible({ timeout: 300 }).catch(() => false)) {
      return;
    }

    await page.waitForTimeout(500);
  }
}

async function goToCaptionStep(page: any) {
  await waitForPhotoReady(page);

  for (let i = 0; i < 3; i += 1) {
    if (await captionBox(page)) {
      return;
    }

    if (await hasShareButton(page)) {
      const box = await captionBox(page);

      if (box) {
        return;
      }

      log("INFO", "Instagram Share is visible; waiting for caption field");
      await page.waitForTimeout(1500);

      if (await captionBox(page)) {
        return;
      }

      break;
    }

    const ok = page.getByRole("button", { name: /^(ok|done|tiếp tục)$/i }).last();

    if (await ok.isVisible({ timeout: 300 }).catch(() => false)) {
      await ok.click({ force: true }).catch(() => {});
      await page.waitForTimeout(800);
    }

    const clicked = await clickDialogHeaderAction(page, [
      "Next",
      "Tiếp",
      "Tiếp theo",
    ]);

    if (!clicked) {
      log("WARN", `Instagram Next not found on step ${i + 1}`);
      break;
    }

    log("INFO", `Instagram clicked Next (${i + 1})`);
    await page.waitForTimeout(2500);
  }

  if (await captionBox(page)) {
    return;
  }

  const heading = await page
    .evaluate(() => {
      const dialog = Array.from(
        document.querySelectorAll('[role="dialog"]'),
      ).pop() as HTMLElement | undefined;
      const title = dialog?.querySelector("h1, h2, [role='heading']");
      return (title?.textContent || dialog?.innerText || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
    })
    .catch(() => "");

  log("WARN", `Instagram composer stuck: ${heading || "no dialog text"}`);
  throw new Error("Instagram caption box was not found.");
}

async function typeCaption(page: any, box: any, content: string) {
  await box.click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+A").catch(() => {});
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

  await box
    .evaluate((el: HTMLElement) => {
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })
    .catch(() => {});

  await page.waitForTimeout(800);
}

async function waitForShareEnabled(page: any) {
  for (let i = 0; i < 12; i += 1) {
    const enabled = await page.evaluate(() => {
      const dialogs = Array.from(
        document.querySelectorAll('[role="dialog"]'),
      ) as HTMLElement[];
      const root = dialogs[dialogs.length - 1];

      if (!root) {
        return false;
      }

      const nodes = Array.from(
        root.querySelectorAll('[role="button"], button'),
      ) as HTMLElement[];

      return nodes.some((node) => {
        const aria = (node.getAttribute("aria-label") || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const text = (node.innerText || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

        return (
          (aria === "share" ||
            aria === "chia sẻ" ||
            text === "share" ||
            text === "chia sẻ") &&
          node.getAttribute("aria-disabled") !== "true"
        );
      });
    });

    if (enabled) {
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function dialogState(page: any) {
  return page.evaluate(() => {
    const hay = (document.body.innerText || "").replace(/\s+/g, " ");

    if (
      /couldn'?t share|could not share|try again|something went wrong|không thể chia sẻ/i.test(
        hay,
      )
    ) {
      return "error";
    }

    if (
      /your post has been shared|your reel has been shared|post shared|bài viết đã được chia sẻ|đã chia sẻ bài viết|bài viết của bạn đã được chia sẻ|게시물이 공유되었습니다/i.test(
        hay,
      )
    ) {
      return "ok";
    }

    const dialogs = document.querySelectorAll('[role="dialog"]');

    if (!dialogs.length) {
      return "gone";
    }

    const last = dialogs[dialogs.length - 1] as HTMLElement;
    const text = (last.innerText || "").toLowerCase();
    const hasCaption = /write a caption|viết chú thích|caption/i.test(
      `${last.getAttribute("aria-label") || ""} ${text}`,
    );
    const hasShare = /(^|\n)\s*(share|chia sẻ)\s*(\n|$)/i.test(text);

    if (!hasCaption && !hasShare && /ok|done|đóng|close/i.test(text)) {
      return "ok";
    }

    return "wait";
  });
}

async function dismissSuccess(page: any) {
  const close = page
    .getByRole("button", { name: /^(ok|done|close|đóng)$/i })
    .first();

  if (await close.isVisible({ timeout: 1200 }).catch(() => false)) {
    await close.click().catch(() => {});
  }
}

async function waitForShared(page: any) {
  const deadline = Date.now() + 45000;

  while (Date.now() < deadline) {
    const state = await dialogState(page);

    if (state === "error") {
      throw new Error("Instagram refused to share the post.");
    }

    if (state === "ok" || state === "gone") {
      await dismissSuccess(page);
      return true;
    }

    await page.waitForTimeout(1000);
  }

  return false;
}

export async function publishInstagramPost(
  content: string,
  imagePath?: string | string[],
  profileId?: string,
) {
  if (!imagePath || (Array.isArray(imagePath) && !imagePath.length)) {
    throw new Error("No image was generated for the Instagram post.");
  }

  await startBrowser(profileId);

  let page;

  try {
    page = await getContext().newPage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!/closed|Target page|not started/i.test(message)) {
      throw error;
    }

    await stopBrowser().catch(() => {});
    await startBrowser(profileId);
    page = await getContext().newPage();
  }

  await page.goto("https://www.instagram.com/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(4000);
  await dismissOverlays(page);
  await ensureLoggedIn(page);

  const opened = await clickCreate(page);

  if (!opened) {
    throw new Error("Instagram Create button was not found.");
  }

  await choosePostType(page);
  await uploadPhoto(page, imagePath);
  await goToCaptionStep(page);

  const box = await captionBox(page);

  if (!box) {
    throw new Error("Instagram caption box was not found.");
  }

  await typeCaption(page, box, content);

  const shareReady = await waitForShareEnabled(page);

  if (!shareReady) {
    log("WARN", "Instagram Share still looked disabled; clicking it anyway");
  }

  let sharedClick = await clickDialogHeaderAction(page, [
    "Share",
    "Chia sẻ",
  ]);

  if (!sharedClick) {
    throw new Error("Instagram Share button was not found.");
  }

  await page.waitForTimeout(2500);

  if ((await dialogState(page)) === "wait" && (await captionBox(page))) {
    log("INFO", "Instagram still on caption step, clicking Share again");
    sharedClick = await clickDialogHeaderAction(page, ["Share", "Chia sẻ"]);
  }

  const shared = await waitForShared(page);

  if (!shared) {
    throw new Error("Instagram Share click did not finish posting.");
  }

  log("INFO", "Instagram post published");
}
