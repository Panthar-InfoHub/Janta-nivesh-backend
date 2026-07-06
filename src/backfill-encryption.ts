/**
 * One-time backfill script: encrypts all existing plaintext rows in the DB.
 *
 * Run AFTER `prisma migrate deploy` (Phase 1) and BEFORE migration 20260627000002.
 *
 * Usage:
 *   npm run build && node dist/scripts/backfill-encryption.js
 *
 * It is safe to re-run — already-encrypted values are detected and skipped.
 */
// import { PrismaClient } from "../../src/prisma/generated/prisma/client.js";
// import { encrypt, generateBlindIndex } from "../../src/lib/encryption.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./prisma/generated/prisma/client.js";
import { encrypt, generateBlindIndex } from "./lib/encryption.js";

const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
export const prisma = new PrismaClient({ adapter: pool })

// const prisma = new PrismaClient();

// A value is already encrypted if it's in "base64:base64:base64" format (iv:ciphertext:tag)
function isEncrypted(value: string | null | undefined): boolean {
    if (!value) return false;
    return value.split(":").length === 3;
}

// Raw prisma (no extension) so auto-encrypt middleware is bypassed.
// We use `as any` because the TS types may still reflect pre-migration types
// until `prisma generate` is re-run.
const db = prisma as any;

async function backfillUsers() {
    const rows = await db.user.findMany({
        select: { id: true, email: true, phone_no: true, full_name: true, dob: true }
    });
    let updated = 0;
    for (const row of rows) {
        const data: Record<string, string | null> = {};
        if (row.email && !isEncrypted(row.email)) {
            data.email_hash = generateBlindIndex(row.email);
            data.email = encrypt(row.email);
        }
        if (row.phone_no && !isEncrypted(row.phone_no)) {
            data.phone_hash = generateBlindIndex(row.phone_no);
            data.phone_no = encrypt(row.phone_no);
        }
        if (row.full_name && !isEncrypted(row.full_name)) {
            data.full_name = encrypt(row.full_name);
        }
        if (row.dob && !isEncrypted(row.dob)) {
            data.dob = encrypt(row.dob);
        }
        if (Object.keys(data).length > 0) {
            await db.user.update({ where: { id: row.id }, data });
            updated++;
        }
    }
    console.log(`  [User]            ${updated}/${rows.length} rows updated`);
}

async function backfillUserBankDetails() {
    const rows = await db.userBankDetails.findMany({
        select: { id: true, account_no: true, ifsc_code: true }
    });
    let updated = 0;
    for (const row of rows) {
        const data: Record<string, string | null> = {};
        if (row.account_no && !isEncrypted(row.account_no)) {
            data.account_no_hash = generateBlindIndex(row.account_no);
            data.account_no = encrypt(row.account_no);
        }
        if (row.ifsc_code && !isEncrypted(row.ifsc_code)) {
            data.ifsc_code = encrypt(row.ifsc_code);
        }
        if (Object.keys(data).length > 0) {
            await db.userBankDetails.update({ where: { id: row.id }, data });
            updated++;
        }
    }
    console.log(`  [UserBankDetails] ${updated}/${rows.length} rows updated`);
}

async function backfillUserFinance() {
    const fields = ["annual_income", "expense_house", "expense_food", "expense_transportation", "expense_others"];
    const rows = await db.userFinance.findMany();
    let updated = 0;
    for (const row of rows) {
        const data: Record<string, string | null> = {};
        for (const f of fields) {
            if (row[f] !== undefined && row[f] !== null && !isEncrypted(row[f])) {
                data[f] = encrypt(String(row[f]));
            }
        }
        if (Object.keys(data).length > 0) {
            await db.userFinance.update({ where: { id: row.id }, data });
            updated++;
        }
    }
    console.log(`  [UserFinance]     ${updated}/${rows.length} rows updated`);
}

async function backfillUserAssets() {
    const fields = ["stocks", "fd", "real_estate", "gold", "cash_saving", "mutual_funds"];
    const rows = await db.userAssets.findMany();
    let updated = 0;
    for (const row of rows) {
        const data: Record<string, string | null> = {};
        for (const f of fields) {
            if (row[f] !== undefined && row[f] !== null && !isEncrypted(row[f])) {
                data[f] = encrypt(String(row[f]));
            }
        }
        if (Object.keys(data).length > 0) {
            await db.userAssets.update({ where: { id: row.id }, data });
            updated++;
        }
    }
    console.log(`  [UserAssets]      ${updated}/${rows.length} rows updated`);
}

async function backfillUserInsurance() {
    const fields = ["life_insurance", "health_insurance"];
    const rows = await db.userInsurance.findMany();
    let updated = 0;
    for (const row of rows) {
        const data: Record<string, string | null> = {};
        for (const f of fields) {
            if (row[f] !== undefined && row[f] !== null && !isEncrypted(row[f])) {
                data[f] = encrypt(String(row[f]));
            }
        }
        if (Object.keys(data).length > 0) {
            await db.userInsurance.update({ where: { id: row.id }, data });
            updated++;
        }
    }
    console.log(`  [UserInsurance]   ${updated}/${rows.length} rows updated`);
}

async function backfillUserLoan() {
    const fields = ["outstanding_amount", "monthly_emi"];
    const rows = await db.userLoan.findMany();
    let updated = 0;
    for (const row of rows) {
        const data: Record<string, string | null> = {};
        for (const f of fields) {
            if (row[f] !== undefined && row[f] !== null && !isEncrypted(row[f])) {
                data[f] = encrypt(String(row[f]));
            }
        }
        if (Object.keys(data).length > 0) {
            await db.userLoan.update({ where: { id: row.id }, data });
            updated++;
        }
    }
    console.log(`  [UserLoan]        ${updated}/${rows.length} rows updated`);
}

async function backfillUserGoals() {
    const fields = ["current_saved_amount", "current_goal_cost", "current_monthly_expense", "post_retirement_return"];
    const rows = await db.userGoals.findMany();
    let updated = 0;
    for (const row of rows) {
        const data: Record<string, string | null> = {};
        for (const f of fields) {
            if (row[f] !== undefined && row[f] !== null && !isEncrypted(row[f])) {
                data[f] = encrypt(String(row[f]));
            }
        }
        if (Object.keys(data).length > 0) {
            await db.userGoals.update({ where: { id: row.id }, data });
            updated++;
        }
    }
    console.log(`  [UserGoals]       ${updated}/${rows.length} rows updated`);
}

async function backfillUserNetWorthSnapshot() {
    const fields = ["netWorth", "assets", "liabilities"];
    const rows = await db.userNetWorthSnapshot.findMany();
    let updated = 0;
    for (const row of rows) {
        const data: Record<string, string | null> = {};
        for (const f of fields) {
            if (row[f] !== undefined && row[f] !== null && !isEncrypted(row[f])) {
                data[f] = encrypt(String(row[f]));
            }
        }
        if (Object.keys(data).length > 0) {
            await db.userNetWorthSnapshot.update({ where: { id: row.id }, data });
            updated++;
        }
    }
    console.log(`  [NetWorthSnapshot]${updated}/${rows.length} rows updated`);
}

async function backfillMfKycIdentity() {
    const fields = ["uid", "pan_no", "full_name", "dob", "full_address", "mobile_no", "email_id"];
    const rows = await db.mfKycIdentity.findMany();
    let updated = 0;
    for (const row of rows) {
        const data: Record<string, string | null> = {};
        for (const f of fields) {
            if (row[f] !== undefined && row[f] !== null && !isEncrypted(row[f])) {
                data[f] = encrypt(String(row[f]));
            }
        }
        if (Object.keys(data).length > 0) {
            await db.mfKycIdentity.update({ where: { id: row.id }, data });
            updated++;
        }
    }
    console.log(`  [MfKycIdentity]   ${updated}/${rows.length} rows updated`);
}

async function main() {
    console.log("Starting encryption backfill...\n");
    await backfillUsers();
    await backfillUserBankDetails();
    await backfillUserFinance();
    await backfillUserAssets();
    await backfillUserInsurance();
    await backfillUserLoan();
    await backfillUserGoals();
    await backfillUserNetWorthSnapshot();
    await backfillMfKycIdentity();
    console.log("\nBackfill complete. Now run migration 20260627000002 to add the bank hash unique constraint.");
}

main()
    .catch(e => { console.error("Backfill failed:", e); process.exit(1); })
    .finally(() => prisma.$disconnect());
