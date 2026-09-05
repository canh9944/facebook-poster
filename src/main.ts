import "./env.js";
import { log } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { runAllAccounts } from "./job.js";
import "./server.js";

async function main() {
  console.log(`
========================================
 Facebook Auto Poster
========================================
`);

  startScheduler();

  log("INFO", "Starting publish flow for all accounts");
  await runAllAccounts();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
