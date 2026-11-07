import { db } from "../dist/server.js";
import { fintech_primitive_mf_purchase_plan_service } from "../dist/services/fintech-primitive/mf_purchase_plan.service.js";
import { fintech_primitive_mf_purchase_service } from "../dist/services/fintech-primitive/mf_purchase.service.js";
import { fintech_primitive_mf_redemption_service } from "../dist/services/fintech-primitive/mf_redemption.service.js";
import { fintech_primitive_mf_redemption_plan_service } from "../dist/services/fintech-primitive/mf_redemption_plan.service.js";
import { mf_transaction_plan_service } from "../dist/services/mf-transaction-plan.service.js";

const isDryRun = process.argv.includes("--dry-run");
const isAll = process.argv.includes("--all");
const userArgIndex = process.argv.indexOf("--user");
const targetUserId = userArgIndex !== -1 ? process.argv[userArgIndex + 1] : null;
const stateArgIndex = process.argv.indexOf("--state");
const targetState = stateArgIndex !== -1 ? process.argv[stateArgIndex + 1] : null;

// Default to in-flight states only. Terminal states (FAILED, CANCELLED, SUCCESSFUL, COMPLETED)
// and long-running states (ACTIVE) are excluded unless --all or --state is passed.
const IN_FLIGHT_STATES = [
  "PENDING",
  "CONFIRMED",
  "SUBMITTED",
  "REVIEW_COMPLETED",
  "UNDER_REVIEW",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function syncAllTransactions() {
  const activeFilterDescription = targetState
    ? `Single State: ${targetState}`
    : isAll
    ? "ALL States"
    : `In-Flight States only (${IN_FLIGHT_STATES.join(", ")})`;

  console.log("=================================================");
  console.log("   SYNC MF TRANSACTIONS TO LIVE FP STATE        ");
  console.log(`   Mode   : ${isDryRun ? "DRY RUN (No DB Writes)" : "LIVE SYNC (Upsert to DB)"}`);
  console.log(`   Filter : ${activeFilterDescription}`);
  if (targetUserId) console.log(`   Target User: ${targetUserId}`);
  console.log("=================================================\n");

  const whereClause = {
    fp_id: { not: undefined },
    ...(targetUserId ? { user_id: targetUserId } : {}),
    ...(targetState
      ? { state: targetState }
      : isAll
      ? {}
      : { state: { in: IN_FLIGHT_STATES } }),
  };

  const transactions = await db.mfTransactionPlan.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      user_id: true,
      fp_id: true,
      plan_type: true,
      systematic: true,
      state: true,
      amount: true,
      scheme: true,
      createdAt: true,
    },
  });

  console.log(`Found ${transactions.length} transactions in database.\n`);

  let updatedCount = 0;
  let unchangedCount = 0;
  let failedCount = 0;
  const changes = [];

  for (let i = 0; i < transactions.length; i++) {
    const txn = transactions[i];
    const prefix = `[${i + 1}/${transactions.length}] [${txn.fp_id}]`;

    try {
      let livePlan = null;
      let planType = txn.plan_type;
      let systematic = txn.systematic;

      // 1. Fetch live state from FP depending on ID prefix
      if (txn.fp_id.startsWith("mfpp_")) {
        // Systematic Purchase Plan (SIP)
        livePlan = await fintech_primitive_mf_purchase_plan_service.get_purchase_plan(txn.fp_id);
        planType = "PURCHASE";
        systematic = true;
      } else if (txn.fp_id.startsWith("mfp_")) {
        // One-shot Purchase (Lumpsum)
        livePlan = await fintech_primitive_mf_purchase_service.get_purchase(txn.fp_id);
        planType = "PURCHASE";
        systematic = false;
      } else if (txn.fp_id.startsWith("mfrp_")) {
        // Systematic Redemption Plan (SWP)
        livePlan = await fintech_primitive_mf_redemption_plan_service.get_redemption_plan(txn.fp_id);
        planType = "REDEMPTION";
        systematic = true;
      } else if (txn.fp_id.startsWith("mfr_")) {
        // One-shot Redemption
        livePlan = await fintech_primitive_mf_redemption_service.get_redemption(txn.fp_id);
        planType = "REDEMPTION";
        systematic = false;
      } else {
        console.warn(`${prefix} Unknown ID prefix, skipping.`);
        failedCount++;
        continue;
      }

      if (!livePlan || !livePlan.state) {
        console.warn(`${prefix} No live state returned from FP`);
        failedCount++;
        continue;
      }

      const liveStateUpper = livePlan.state.toUpperCase();
      const stateChanged = txn.state !== liveStateUpper;

      if (stateChanged) {
        console.log(`${prefix} State CHANGED: ${txn.state} -> ${liveStateUpper}`);
        changes.push({
          fp_id: txn.fp_id,
          user_id: txn.user_id,
          scheme: txn.scheme,
          from: txn.state,
          to: liveStateUpper,
        });

        if (!isDryRun) {
          await mf_transaction_plan_service.upsert_from_fp(
            txn.user_id,
            planType,
            livePlan,
            systematic
          );
        }
        updatedCount++;
      } else {
        console.log(`${prefix} Unchanged (${txn.state})`);
        unchangedCount++;
      }

      // Small throttle to be courteous to FP API
      await sleep(150);
    } catch (err) {
      console.error(`${prefix} FAILED:`, err?.response?.data || err.message);
      failedCount++;
    }
  }

  console.log("\n=================================================");
  console.log("                   SUMMARY                       ");
  console.log("=================================================");
  console.log(`Total Inspected : ${transactions.length}`);
  console.log(`Updated         : ${updatedCount}`);
  console.log(`Unchanged       : ${unchangedCount}`);
  console.log(`Failed / Errors : ${failedCount}`);

  if (changes.length > 0) {
    console.log("\nDetailed Changes:");
    console.table(changes);
  }
  console.log("=================================================\n");

  process.exit(0);
}

syncAllTransactions().catch((err) => {
  console.error("Fatal error running sync script:", err);
  process.exit(1);
});

