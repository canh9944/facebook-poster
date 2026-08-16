import "./env.js";
import { log } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { runPublishFlow } from "./job.js";
import "./server.js";

async function main() {
  console.log(`
========================================
 Facebook Auto Poster
========================================
`);

  startScheduler();

  log("INFO", "Starting full publish flow");
  await runPublishFlow();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
