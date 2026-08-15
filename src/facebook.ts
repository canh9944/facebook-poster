import { getPage, openFacebook, startBrowser } from "./browser.js";
import { log } from "./db.js";

async function findCreatePostButton(page: any) {
  /*
   * Facebook's feed composer trigger.
   *
   * We don't rely on the visible text because it changes
   * with Facebook language.
   */

  const candidates = page.locator('[role="button"]');

  const count = await candidates.count();

  for (let i = 0; i < count; i++) {
    const element = candidates.nth(i);

    if (!(await element.isVisible().catch(() => false))) {
      continue;
    }

    /*
     * Get semantic information.
     */
    const ariaLabel =
      (await element.getAttribute("aria-label").catch(() => null)) ?? "";

    const html = await element
      .evaluate((el: HTMLElement) => el.outerHTML.substring(0, 10000))
      .catch(() => "");

    /*
     * The feed composer button has a text-containing
     * descendant, but is NOT an actual textbox itself.
     *
     * We can inspect its DOM shape.
     */

    const hasImage = html.includes("<img") || html.includes("<svg");

    const hasText = html.includes('dir="auto"');

    const hasButtonRole = html.includes('role="button"');

    /*
     * This is a semantic/structural candidate.
     */
    if (hasButtonRole && hasText && (hasImage || html.length > 500)) {
      /*
       * Avoid obvious navigation buttons.
       */
      const navigationLabels = [
        "menu",
        "messenger",
        "notification",
        "thông báo",
        "trang cá nhân",
        "profile",
        "back",
        "quay lại",
      ];

      const lowerAria = ariaLabel.toLowerCase();

      const isNavigation = navigationLabels.some((label) =>
        lowerAria.includes(label),
      );

      if (!isNavigation) {
        /*
         * Check whether this button is located
         * in the main feed area.
         */
        const rect = await element.boundingBox().catch(() => null);

        if (rect && rect.width > 150 && rect.height > 30) {
          return element;
        }
      }

      /*
       * EXTRA FALLBACK: Some Facebook UIs render the composer trigger
       * as a `div[role="button"]` containing a span with the prompt
       * text (e.g. "bạn đang nghĩ gì" / "what's on your mind").
       * Detect those by inspecting span descendants.
       */
      const promptPatterns = [
        /what.*on your mind/i,
        /bạn đang nghĩ gì/i,
        /what.*thinking/i,
        /vous.*pensez/i,
        /你在想什么/i,
      ];

      const buttons = page.locator('[role="button"]');

      const btnCount = await buttons.count();

      for (let i = 0; i < btnCount; i++) {
        const btn = buttons.nth(i);

        if (!(await btn.isVisible().catch(() => false))) continue;

        const spans = btn.locator("span");

        const spanCount = await spans.count();

        for (let s = 0; s < spanCount; s++) {
          const span = spans.nth(s);

          const text = (await span.innerText().catch(() => "")).trim();

          if (!text) continue;

          const matches = promptPatterns.some((p) => p.test(text));

          if (matches) {
            const rect = await btn.boundingBox().catch(() => null);

            if (rect && rect.width > 150 && rect.height > 30) {
              return btn;
            }
          }
        }
      }
    }
  }

  /*
   * FALLBACK ONLY
   *
   * Text is used here only if structural detection
   * doesn't find the composer.
   *
   * This fallback supports multiple languages.
   */
  const fallbackTexts = [
    /what.*on your mind/i,
    /create post/i,
    /create a post/i,

    /bạn đang nghĩ gì/i,
    /tạo bài viết/i,

    /what.*thinking/i,

    /vous.*pensez/i,

    /你在想什么/i,
    /有什么新鲜事/i,

    /무슨 생각을 하고 계신가요/i,

    /何を考えていますか/i,
  ];

  for (const pattern of fallbackTexts) {
    const element = page.getByText(pattern).first();

    if (await element.isVisible().catch(() => false)) {
      /*
       * The text itself may be inside the button.
       * Find the closest role=button ancestor.
       */
      const button = element.locator('xpath=ancestor::*[@role="button"][1]');

      if (await button.isVisible().catch(() => false)) {
        return button;
      }
    }
  }

  return null;
}

async function findComposer(page: any) {
  const selectors = [
    '[role="textbox"]',
    '[role="combobox"]',
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    "[contenteditable]",
    "textarea",
    'input[type="text"]',
  ];

  /*
   * Facebook can render the composer asynchronously.
   * Poll for up to 15 seconds instead of checking once.
   */
  for (let attempt = 0; attempt < 30; attempt++) {
    console.log(`[Composer] searching... attempt ${attempt + 1}/30`);

    /*
     * Check main page.
     */
    for (const selector of selectors) {
      const elements = page.locator(selector);

      const count = await elements.count();

      if (count > 0) {
        console.log(`[Composer] ${selector}: ${count}`);
      }

      for (let i = 0; i < count; i++) {
        const element = elements.nth(i);

        if (!(await element.isVisible().catch(() => false))) {
          continue;
        }

        // Inspect element to avoid matching search input or header inputs
        // Inspect element to avoid matching search input or header inputs
        const tagName =
          (await element
            .evaluate((el: HTMLElement) => el.tagName)
            .catch(() => null)) || "";
        const role =
          (await element.getAttribute("role").catch(() => null)) || "";
        const ariaLabel =
          (await element.getAttribute("aria-label").catch(() => null)) || "";
        const placeholder =
          (await element.getAttribute("placeholder").catch(() => null)) || "";
        const nameAttr =
          (await element.getAttribute("name").catch(() => null)) || "";

        const lower = (
          ariaLabel +
          " " +
          placeholder +
          " " +
          nameAttr
        ).toLowerCase();

        const searchHints = [
          "search",
          "tìm",
          "buscar",
          "搜索",
          "搜索",
          "suchen",
        ];

        const isLikelySearch = searchHints.some((h) => lower.includes(h));

        if ((tagName === "INPUT" || tagName === "TEXTAREA") && isLikelySearch) {
          continue;
        }

        // Avoid small header/search inputs by position (y too small)
        const rect = await element.boundingBox().catch(() => null);

        if (rect && rect.y < 120) {
          // likely header or search; skip
          continue;
        }
        // Require composer candidates to be in the main feed area:
        // sufficiently wide, not in the header/left column.
        if (!rect) continue;

        if (rect.width < 200) continue;

        // x near left (e.g., search) or too-top likely indicates header/search
        if (rect.x < 120 || rect.y < 120) {
          continue;
        }

        // Ensure the element is inside the main feed area by walking up
        // ancestors and finding role="main" or an aria-label that looks like the feed.
        const inMain = await element
          .evaluate((el: HTMLElement) => {
            let p: any = el;

            while (p) {
              try {
                const role = p.getAttribute && p.getAttribute("role");
                const aria =
                  p.getAttribute &&
                  (p.getAttribute("aria-label") || "").toLowerCase();

                if (role === "main") return true;

                if (
                  aria &&
                  (aria.includes("news") ||
                    aria.includes("bảng") ||
                    aria.includes("feed") ||
                    aria.includes("trang"))
                )
                  return true;
              } catch (e) {
                // ignore
              }

              p = p.parentElement;
            }

            return false;
          })
          .catch(() => false);

        if (!inMain) {
          continue;
        }

        // Prefer contenteditable and role=textbox/combobox elements
        const isContentEditable = await element
          .evaluate((el: any) => el.isContentEditable)
          .catch(() => false);

        if (isContentEditable || role === "textbox" || role === "combobox") {
          console.log(`[Composer] FOUND: ${selector} (preferred)`);
          return element;
        }

        // If it's an input/textarea fallback, ensure it's located in main feed (not header/search)
        if (tagName === "INPUT" || tagName === "TEXTAREA") {
          const rect = await element.boundingBox().catch(() => null);

          if (rect && rect.width > 200 && rect.y > 150) {
            console.log(`[Composer] FOUND: ${selector} (fallback input)`);
            return element;
          }
        }
      }
    }

    /*
     * Check if Facebook has created another frame.
     */
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) {
        continue;
      }

      console.log(`[Composer] checking frame: ${frame.url()}`);

      for (const selector of selectors) {
        const elements = frame.locator(selector);

        const count = await elements.count();

        for (let i = 0; i < count; i++) {
          const element = elements.nth(i);

          if (await element.isVisible().catch(() => false)) {
            console.log(`[Composer] FOUND in frame: ${selector}`);

            return element;
          }
        }
      }
    }

    /*
     * FALLBACK: Inspect any visible dialog for editable content.
     * Some composer implementations place the editable region
     * inside a dialog without standard roles/attributes we checked above.
     */
    try {
      const dialogs = page.locator('[role="dialog"]');

      const dialogCount = await dialogs.count();

      for (let d = 0; d < dialogCount; d++) {
        const dialog = dialogs.nth(d);

        if (!(await dialog.isVisible().catch(() => false))) {
          continue;
        }

        // look for any contenteditable or textbox candidates inside the dialog
        const dialogCandidates = dialog.locator(
          '[contenteditable], [role="textbox"], [role="combobox"], textarea, input[type="text"]',
        );

        const dcCount = await dialogCandidates.count();

        for (let i = 0; i < dcCount; i++) {
          const el = dialogCandidates.nth(i);

          if (await el.isVisible().catch(() => false)) {
            return el;
          }
        }
      }
    } catch (e) {
      // ignore and continue polling
    }

    /*
     * Wait 500ms before checking again.
     */
    await page.waitForTimeout(1500);
  }

  return null;
}

async function findPostButton(page: any) {
  /*
   * IMPORTANT:
   *
   * Do not search for "Post", "Đăng", etc.
   *
   * First locate the currently opened composer dialog.
   */
  const dialogs = page.locator('[role="dialog"]');

  const dialogCount = await dialogs.count();

  // If no dialog is present, attempt to find an inline composer and its nearby action buttons
  if (!dialogCount) {
    try {
      const composerCandidates = page.locator(
        '[contenteditable], [role="textbox"], textarea, input[type="text"]',
      );

      const cCount = await composerCandidates.count();

      let composerRect: any = null;

      for (let i = 0; i < cCount; i++) {
        const c = composerCandidates.nth(i);

        if (!(await c.isVisible().catch(() => false))) {
          continue;
        }

        const rect = await c.boundingBox().catch(() => null);

        if (!rect) continue;

        if (rect.y > 120) {
          if (!composerRect || rect.y < composerRect.y) {
            composerRect = rect;
          }
        }
      }

      if (composerRect) {
        const buttons = page.locator('button, [role="button"]');

        const count = await buttons.count();

        const visibleButtons: any[] = [];

        for (let i = 0; i < count; i++) {
          const button = buttons.nth(i);

          if (!(await button.isVisible().catch(() => false))) continue;

          const rect = await button.boundingBox().catch(() => null);

          if (!rect) continue;

          // select buttons near the composer area
          if (rect.y >= composerRect.y - 20 && rect.y <= composerRect.y + 400) {
            visibleButtons.push({ button, rect });
          }
        }

        // sort by vertical position, then pick last enabled
        visibleButtons.sort((a, b) => a.rect.y - b.rect.y);

        for (let i = visibleButtons.length - 1; i >= 0; i--) {
          const btn = visibleButtons[i].button;

          const disabled = await btn
            .getAttribute("aria-disabled")
            .catch(() => null);
          const disabledAttribute = await btn
            .getAttribute("disabled")
            .catch(() => null);

          if (disabled === "true" || disabledAttribute !== null) continue;

          return btn;
        }
      }
    } catch (e) {
      // ignore and continue to dialog-based approach
    }

    return null;
  }

  const dialog = dialogs.last();

  if (!(await dialog.isVisible().catch(() => false))) {
    return null;
  }

  /*
   * Strategy 1:
   *
   * Submit button.
   *
   * This is completely language-independent.
   */
  const submitButtons = dialog.locator(
    'button[type="submit"], [role="button"][type="submit"]',
  );

  const submitCount = await submitButtons.count();

  for (let i = 0; i < submitCount; i++) {
    const button = submitButtons.nth(i);

    if (await button.isVisible().catch(() => false)) {
      return button;
    }
  }

  /*
   * Strategy 2:
   *
   * Find the dialog footer/action area.
   *
   * Facebook's publish button is normally the final
   * primary action after the composer and options.
   *
   * We intentionally avoid text.
   */

  const buttons = dialog.locator('[role="button"], button');

  const count = await buttons.count();

  const visibleButtons: any[] = [];

  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);

    if (await button.isVisible().catch(() => false)) {
      visibleButtons.push(button);
    }
  }

  /*
   * Inspect buttons from bottom to top.
   *
   * The publish action is normally near the bottom
   * of the dialog.
   */
  for (let i = visibleButtons.length - 1; i >= 0; i--) {
    const button = visibleButtons[i];

    const disabled = await button
      .getAttribute("aria-disabled")
      .catch(() => null);

    const disabledAttribute = await button
      .getAttribute("disabled")
      .catch(() => null);

    if (disabled === "true" || disabledAttribute !== null) {
      continue;
    }

    /*
     * Facebook frequently uses data-visualcompletion
     * and role=button for its action controls.
     *
     * We return the last enabled action button
     * in the dialog as a structural fallback.
     */
    return button;
  }

  return null;
}

async function saveDebug(page: any, filename: string) {
  await page.screenshot({
    path: `data/${filename}`,
    fullPage: true,
  });

  console.log(`Debug screenshot saved: data/${filename}`);
}

export async function publishPost(content: string) {
  try {
    getPage();
  } catch (e) {
    await startBrowser();
  }

  const page = getPage();

  await openFacebook();

  log("INFO", `Facebook URL: ${page.url()}`);

  await page.waitForTimeout(3000);

  /*
   * STEP 1
   * Find Create Post
   */
  const createPostButton = await findCreatePostButton(page);

  if (!createPostButton) {
    await saveDebug(page, "facebook-create-post-debug.png");

    throw new Error("Facebook Create Post button was not found.");
  }

  log("INFO", "Create Post button found");

  await createPostButton.scrollIntoViewIfNeeded();

  await createPostButton.click();

  log("INFO", "Create Post clicked");

  /*
   * STEP 2
   * Wait for composer
   */
  await page.waitForTimeout(3000);

  const composer = await findComposer(page);

  if (!composer) {
    await saveDebug(page, "facebook-composer-debug.png");

    throw new Error("Facebook post composer was not found.");
  }

  log("INFO", "Composer found");

  /*
   * STEP 3
   * Enter content
   */
  await composer.scrollIntoViewIfNeeded();

  await composer.click();

  await composer.fill(content);

  log("INFO", "Content entered");

  await page.waitForTimeout(1000);

  /*
   * STEP 4
   * Find publish button WITHOUT TEXT
   */
  const postButton = await findPostButton(page);

  if (!postButton) {
    await saveDebug(page, "facebook-post-button-debug.png");

    throw new Error("Facebook publish button was not found.");
  }

  log("INFO", "Publish button found");

  await postButton.scrollIntoViewIfNeeded();

  await postButton.click();

  log("INFO", "Publish button clicked");

  await page.waitForTimeout(5000);

  log("INFO", "Publish flow completed");
}
