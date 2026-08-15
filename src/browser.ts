import { chromium, BrowserContext, Page } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { log } from "./db.js";

const profilePath = path.resolve("data/facebook-profile");

let context: BrowserContext | null = null;
let page: Page | null = null;

export async function startBrowser() {
  if (context) {
    return;
  }

  fs.mkdirSync(profilePath, { recursive: true });

  context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    viewport: {
      width: 1440,
      height: 900,
    },
    args: ["--start-maximized"],
  });

  page = context.pages()[0] ?? (await context.newPage());

  log("INFO", "Browser started");

  await page.goto("https://www.facebook.com/", {
    waitUntil: "domcontentloaded",
  });

  log("INFO", "Facebook opened");
}

export function getPage() {
  if (!page) {
    throw new Error("Browser is not started");
  }

  return page;
}

export async function openFacebook() {
  const currentPage = getPage();

  await currentPage.goto("https://www.facebook.com/", {
    waitUntil: "domcontentloaded",
  });
}

export async function stopBrowser() {
  if (!context) {
    return;
  }

  await context.close();

  context = null;
  page = null;

  log("INFO", "Browser stopped");
}
