import dotenv from "dotenv";
dotenv.config();

export const env = {

    // =====================  v2 ENVS ===================================

    MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY!,
    MSG91_TEMPLATE_ID: process.env.MSG91_TEMPLATE_ID!,
    MSG91_BASE_URL: process.env.MSG91_BASE_URL!,














    finsys_base_api: process.env.FINSYS_BASE_API!,
    ENVIRONMENT: process.env.ENVIRONMENT!,
    JWT_SECRET: process.env.JWT_SECRET!,
    MF_LATEST_URL: process.env.MF_LATEST_URL!,
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

