import { chromium, Browser, BrowserContext, Page } from "playwright";
import { getSetting, log, setSetting } from "./db.js";
import { listProfiles, startProfile, stopProfile } from "./genlogin.js";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let starting: Promise<void> | null = null;
let activeProfileId: string | null = null;

function isContextAlive() {
  if (!context || !page) {
    return false;
  }

  try {
    if (page.isClosed()) {
      browser = null;
      context = null;
      page = null;
      return false;
    }

    return true;
  } catch {
    browser = null;
    context = null;
    page = null;
    return false;
  }
}

async function resolveProfileId(profileId?: string) {
  const resolved =
    profileId ||
    process.env.GENLOGIN_PROFILE_ID ||
    getSetting("genlogin_profile_id");

  if (resolved) {
    return String(resolved);
  }

  const { profiles } = await listProfiles();
  const first = profiles[0];

  if (!first?.id) {
    throw new Error(
      "No Genlogin profiles found. Create a profile in the Genlogin app, then retry.",
    );
  }

  log("INFO", `No profile configured; using first Genlogin profile ${first.id}`);

  return String(first.id);
}

export function getActiveProfileId() {
  return activeProfileId;
}

export function isBrowserRunning() {
  return isContextAlive();
}

export async function startBrowser(profileId?: string) {
  const resolvedId = await resolveProfileId(profileId);

  if (isContextAlive() && activeProfileId === resolvedId) {
    return;
  }

  if (isContextAlive() && activeProfileId !== resolvedId) {
    await stopBrowser();
  }

  browser = null;
  context = null;
  page = null;

  if (starting) {
    await starting;
    if (isContextAlive() && activeProfileId === resolvedId) {
      return;
    }
  }

  starting = (async () => {
    const { wsEndpoint } = await startProfile(resolvedId);

    const connected = await chromium.connectOverCDP(wsEndpoint);

    connected.on("disconnected", () => {
      if (browser === connected) {
        browser = null;
        context = null;
        page = null;
        activeProfileId = null;
      }
    });

    const launchedContext = connected.contexts()[0] ?? (await connected.newContext());
    const launchedPage =
      launchedContext.pages().find((item) => !item.isClosed()) ??
      (await launchedContext.newPage());

    browser = connected;
    context = launchedContext;
    page = launchedPage;
    activeProfileId = resolvedId;
    setSetting("genlogin_profile_id", resolvedId);

    log("INFO", `Connected to Genlogin profile ${resolvedId}`);

    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
    });

    log("INFO", "Facebook opened");
  })();

  try {
    await starting;
  } catch (error) {
    browser = null;
    context = null;
    page = null;
    activeProfileId = null;
    throw error;
  } finally {
    starting = null;
  }
}

export function getPage() {
  if (page && !page.isClosed()) {
    return page;
  }

  const live = context?.pages().find((item) => !item.isClosed());

  if (live) {
    page = live;
    return live;
  }

  throw new Error("Browser is not started");
}

export async function openFacebook() {
  if (!isContextAlive()) {
    await startBrowser();
  }

  const currentPage = getPage();

  await currentPage.goto("https://www.facebook.com/", {
    waitUntil: "domcontentloaded",
  });
}

export async function stopBrowser() {
  const profileId = activeProfileId;

  if (browser) {
    await browser.close().catch(() => {});
  }

  browser = null;
  context = null;
  page = null;
  activeProfileId = null;

  if (profileId) {
    await stopProfile(profileId).catch((error) => {
      log(
        "ERROR",
        `Failed to stop Genlogin profile ${profileId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  log("INFO", "Browser stopped");
}
