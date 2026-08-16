import "./env.js";
import { startBrowser } from "./browser.js";
import { startScheduler } from "./scheduler.js";
import "./server.js";

async function main() {
  console.log(`
========================================
 Facebook Auto Poster
========================================
`);

  await startBrowser().catch((e) => {
    console.error(
      "Genlogin profile start failed:",
      e instanceof Error ? e.message : String(e),
    );
    console.error(
      "Start the Genlogin app, then POST /api/browser/start with { \"profileId\": \"...\" }.",
    );
  });

  startScheduler();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
