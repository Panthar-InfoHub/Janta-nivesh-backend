import { PrismaPg } from "@prisma/adapter-pg"
import cors from "cors"
import dotenv from "dotenv"
import express from "express"
import morgan from "morgan"
import { connectDB } from "./lib/db.js"
import { errorHandler } from "./middleware/error.middleware.js"
import logger from "./middleware/logger.js"
import { PrismaClient } from "./prisma/generated/prisma/client.js"
import { auth_router } from "./routes/auth.router.js"
import { fire_report_router } from "./routes/fire-report.router.js"
import { job_router } from "./routes/job.router.js"
import { kyc_router } from "./routes/kyc.router.js"
import { basic_details_router } from "./routes/onboarding_routers/basic_details.router.js"
import { pan_verification_router } from "./routes/onboarding_routers/pan_verification.router.js"
import { kyc_form_router } from "./routes/onboarding_routers/kyc_form.router.js"
import { penny_drop_router } from "./routes/onboarding_routers/penny_drop.router.js"
import { email_verification_router } from "./routes/onboarding_routers/email_verification.router.js"
import { admin_router } from "./routes/admin.router.js"
import { investor_profile_router } from "./routes/onboarding_routers/investor_profile.router.js"
import { nominee_router } from "./routes/onboarding_routers/nominee.router.js"
import { mandate_router } from "./routes/mandate.router.js"
import { mandate_webhook_router } from "./routes/webhooks/mandate.webhook.router.js"
import { mf_router } from "./routes/mf.router.js"
import { mf_scheme_router } from "./routes/mf-scheme.router.js"
// mutual_fund_router (v1 Finnsys catalogue) retired as part of the Cybrilla/FP migration - the
// controller/router and their dedicated services are excluded from the build (tsconfig.json).
// import { mutual_fund_router } from "./routes/mutual-fund.router.js"
import { onboarding_router } from "./routes/onboarding.router.js"
import { user_assets_router } from "./routes/user/user.assets.router.js"
import { user_finance_router } from "./routes/user/user.finance.router.js"
import { user_goal_router } from "./routes/user/user.goal.router.js"
import { user_insurance_router } from "./routes/user/user.insurance.router.js"
import { user_loan_router } from "./routes/user/user.loan.router.js"
import { user_router } from "./routes/user/user.router.js"
import { fd_router } from "./routes/fd.router.js"
import { webhook_router as fd_webhook_router } from "./routes/webhook.validation.router.js"
import { bundle_router } from "./routes/bundle.router.js"
import { frontend_router } from "./routes/frontend.router.js"
import { migration_router } from "./routes/migration.router.js"
import { report_router } from "./routes/report.router.js"
import { extendPrismaClient } from "./lib/extended-db.js"
import { test_router } from "./routes/test.router.js"


//Configurations
dotenv.config()
const pool = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter: pool })
export const db = extendPrismaClient(prisma)
const app = express()


//Setting up socket server : later





//Middlewares
app.use(cors())
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
if (process.env.ENVIRONMENT === "dev") {
    app.use(morgan('combined')); //For logging
}


//Routes
app.use("/api/v2/auth", auth_router)
app.use("/api/v2/onboarding/basic-details", basic_details_router)
app.use("/api/v2/onboarding/pan-verification", pan_verification_router)
app.use("/api/v2/onboarding/kyc-form", kyc_form_router)
app.use("/api/v2/onboarding/penny-drop", penny_drop_router)
app.use("/api/v2/onboarding/email", email_verification_router)
app.use("/api/v2/onboarding/investor-profile", investor_profile_router)
app.use("/api/v2/onboarding/nominee", nominee_router)
app.use("/api/v2/mandate", mandate_router)
app.use("/api/v2/webhook/mandate", mandate_webhook_router)
app.use("/api/v2/mf-scheme", mf_scheme_router)


app.use("/api/v2/mf", mf_router)

// Admin/internal-ops routes. Mounted unconditionally - each route decides its own restriction
// level via middleware (see admin.middleware.ts): /login additionally requires dev_only_require
// since it mints auth tokens, but e.g. /mf-product-import needs to run in production too and
// relies on admin_require's x-admin-secret check alone.
app.use("/api/v2/admin", admin_router)
app.use("/api/v2/jobs", job_router)


app.use("/api/v1/migration", migration_router)
app.use("/api/v1/user", user_router)
app.use("/api/v1/frontend", frontend_router)

app.use("/api/v1/fd", fd_router)
app.use("/api/v1/test", test_router)
app.use("/api/v1/fd/webhook", fd_webhook_router)
// app.use("/api/v1/mf", mutual_fund_router) // retired - see the import comment above
app.use("/api/v1/onboarding", onboarding_router)
app.use("/api/v1/user-assets", user_assets_router)
app.use("/api/v1/user-finance", user_finance_router)
app.use("/api/v1/user-loan", user_loan_router)
app.use("/api/v1/user-insurance", user_insurance_router)
app.use("/api/v1/user-goal", user_goal_router)
app.use("/api/v1/fire-report", fire_report_router)

app.use("/api/v1/kyc", kyc_router)
app.use("/api/v1/bundles", bundle_router)
app.use("/api/v1/report", report_router)
//Health check
app.get("/api/v1/ping", (_req, res) => {
    // throw new AppError("Service is running...", 501, "SERVER_RUNNING")
    res.status(200).send({ message: "server is running....." })
})


//Error middlware
app.use(errorHandler)


const PORT = process.env.PORT || 8080



const server = app.listen(PORT, async () => {
    logger.debug(`Backend server started on PORT ==> ${PORT}`);
    await connectDB()
});

// Graceful shutdown
const shutdown = (signal: any) => {
    logger.warn(`${signal} received. Shutting down gracefully...`);
    server.close(() => {
        logger.info("HTTP server closed.");
        process.exit(0);
    });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);