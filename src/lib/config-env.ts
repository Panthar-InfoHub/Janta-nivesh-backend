import dotenv from "dotenv";
dotenv.config();

export const env = {

    // =====================  v2 ENVS ===================================

    MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY!,
    MSG91_TEMPLATE_ID: process.env.MSG91_TEMPLATE_ID!,
    MSG91_BASE_URL: process.env.MSG91_BASE_URL!,

    // MSG91 email API - same authkey as the SMS flow above, different endpoint + template.
    // Sending domain and the OTP template have to be set up in the MSG91 panel first.
    MSG91_EMAIL_URL: process.env.MSG91_EMAIL_URL || "https://control.msg91.com/api/v5/email/send",
    MSG91_EMAIL_TEMPLATE_ID: process.env.MSG91_EMAIL_TEMPLATE_ID!,
    MSG91_EMAIL_DOMAIN: process.env.MSG91_EMAIL_DOMAIN!,
    MSG91_FROM_EMAIL: process.env.MSG91_FROM_EMAIL!,














    // Shared secret for the dev-only admin routes (OTP-bypass login). No default on purpose -
    // a hardcoded fallback would be a publicly known secret. Unset means admin routes reject
    // everything, which is the safe direction to fail.
    ADMIN_API_SECRET: process.env.ADMIN_API_SECRET,

    // Cybrilla (POA / onboarding-KYC provider) - v2 Finnsys replacement
    CYBRILLA_TOKEN_URL: process.env.CYBRILLA_TOKEN_URL!,
    CYBRILLA_CLIENT_ID: process.env.CYBRILLA_CLIENT_ID!,
    CYBRILLA_CLIENT_SECRET: process.env.CYBRILLA_CLIENT_SECRET!,
    CYBRILLA_API_BASE_URL: process.env.CYBRILLA_API_BASE_URL!,
    // Client-side redirect URLs (app deep link / web landing page) - NOT webhooks. Where the
    // user's browser lands after finishing the DigiLocker / esign journey in the webview.
    KYC_FORM_PROOF_CALLBACK_URL: process.env.KYC_FORM_PROOF_CALLBACK_URL!,
    KYC_FORM_ESIGN_CALLBACK_URL: process.env.KYC_FORM_ESIGN_CALLBACK_URL!,

    // Fintech Primitives / "Janta Nivesh" API (MF, bank account, file) - v2 Finnsys replacement
    FINTECH_PRIMITIVE_TOKEN_URL: process.env.FINTECH_PRIMITIVE_TOKEN_URL!,
    FINTECH_PRIMITIVE_CLIENT_ID: process.env.FINTECH_PRIMITIVE_CLIENT_ID!,
    FINTECH_PRIMITIVE_CLIENT_SECRET: process.env.FINTECH_PRIMITIVE_CLIENT_SECRET!,
    FINTECH_PRIMITIVE_API_BASE_URL: process.env.FINTECH_PRIMITIVE_API_BASE_URL!,
    FINTECH_PRIMITIVE_TENANT_ID: process.env.FINTECH_PRIMITIVE_TENANT_ID!, // x-tenant-id header
    FINTECH_PRIMITIVE_WEBHOOK_SECRET: process.env.FINTECH_PRIMITIVE_WEBHOOK_SECRET!,










    finsys_base_api: process.env.FINSYS_BASE_API!,
    ENVIRONMENT: process.env.ENVIRONMENT!,
    JWT_SECRET: process.env.JWT_SECRET!,
    MF_LATEST_URL: process.env.MF_LATEST_URL!,
    MFAPI_BASE_URL: process.env.MFAPI_BASE_URL || "https://api.mfapi.in", // NAV source (scheme master + per-fund latest NAV)
    KYC_BASE_URL: process.env.KYC_BASE_URL!,
    ARN: process.env.ARN!,
    EUIN: process.env.EUIN!,
    FINNSYS_MASTER_URL: process.env.FINNSYS_MASTER_URL!,
    FINNSYS_USERNAME: process.env.FINNSYS_USERNAME!,
    FINNSYS_PASSWORD: process.env.FINNSYS_PASSWORD!,

    // NSE Headers
    NSE_MEMBER_ID: process.env.NSE_MEMBER_ID!,
    NSE_API_KEY: process.env.NSE_API_KEY!,
    NSE_API_SECRET: process.env.NSE_API_SECRET!,
    NSE_USERNAME: process.env.NSE_USERNAME!,

    // NSE MFDESK (nseinvest.com) raw API creds - placeholders, to be filled in later
    NSE_MFDESK_BASE_URL: process.env.NSE_MFDESK_BASE_URL || "https://www.nseinvest.com",
    NSE_MFDESK_LOGIN_USER_ID: process.env.NSE_USERNAME!,
    NSE_MFDESK_API_SECRET: process.env.NSE_API_SECRET!,
    NSE_MFDESK_MEMBER_LICENSE_KEY: process.env.NSE_API_KEY!,
    // NSE_MFDESK_MEMBER_CODE: process.env.NSE_MFDESK_MEMBER_CODE!,
    NSE_MFDESK_MEMBER_ID: process.env.NSE_MEMBER_ID!,

    // Blostem Creds
    BLOSTEM_URL: process.env.BLOSTEM_URL!,
    BLOSTEM_USERNAME: process.env.BLOSTEM_USERNAME!,
    BLOSTEM_PASSWORD: process.env.BLOSTEM_PASSWORD!,
    BLOSTEM_DASH_PASSWORD: process.env.BLOSTEM_DASH_PASSWORD!,
    BLOSTEM_ENCRYPTION_KEY: process.env.BLOSTEM_ENCRYPTION_KEY!,
    BLOSTEM_ENCRYPTION_SALT: process.env.BLOSTEM_ENCRYPTION_SALT!,
    BLOSTEM_MASTER_URL: process.env.BLOSTEM_MASTER_URL!,

    // Testing creds
    TEST_USR: process.env.TEST_USR!,
    TEST_PASS: process.env.TEST_PASS!,
    TEST_INV: process.env.TEST_INV!,

    // Redis Config
    REDIS_HOST: process.env.REDIS_HOST!,
    REDIS_PORT: process.env.REDIS_PORT!,
    REDIS_USERNAME: process.env.REDIS_USERNAME!,
    REDIS_PASS: process.env.REDIS_PASS!,
    REDIS_TYPE: process.env.REDIS_TYPE!,

    // Database Encryption Config
    DB_ENCRYPTION_KEY: process.env.DB_ENCRYPTION_KEY || "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    BLIND_INDEX_KEY: process.env.BLIND_INDEX_KEY || "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",

    // Zoho Webhook
    ZOHO_API_KEY: process.env.ZOHO_API_KEY!
};

