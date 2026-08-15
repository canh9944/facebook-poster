import { startBrowser } from "./browser.js";
import { startScheduler } from "./scheduler.js";
import "./server.js";

async function main() {
  console.log(`
========================================
 Facebook Auto Poster
========================================
`);

  startBrowser().catch((e) => {
    console.error(
      "Browser start failed:",
      e instanceof Error ? e.message : String(e),
    );
  });

  startScheduler();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
