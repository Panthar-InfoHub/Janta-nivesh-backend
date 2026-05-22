import { createHash } from "crypto";
import { promisify } from "util";
import bcrypt from "bcryptjs";
import logger from "../middleware/logger.js";
import { gunzip, gzip } from "zlib";
import { FdCustomerType, FdPayoutFrequency, IssuerType } from "../prisma/generated/prisma/enums.js";
import {
    FdInterestRateWhereInput,
    FdProductOrderByWithRelationInput,
    FdProductWhereInput,
    MfProductOrderByWithRelationInput,
    MfProductWhereInput
} from "../prisma/generated/prisma/models.js";
import { env } from "./config-env.js";

type RawFdParams = Record<string, unknown>;

export const MF_ASSET_TYPE_BY_ID = {
    "1": "Equity",
    "2": "Debt",
    "3": "Hybrid",
    "4": "Precious Metal",
    "5": "Others - Commodities",
    "6": "Currency",
    "7": "Liquid",
    "8": "Others - Mutual Funds",
    "9": "Solution Oriented",
} as const;

export type MfAssetTypeId = keyof typeof MF_ASSET_TYPE_BY_ID;

export const map_mf_asset_type = (
    asset_type_id?: string | number | null,
    fallback_asset_type?: string | null
): string | null => {
    const key = asset_type_id !== undefined && asset_type_id !== null ? String(asset_type_id) : "";
    return MF_ASSET_TYPE_BY_ID[key as MfAssetTypeId] ?? fallback_asset_type ?? null;
}

export type FdSearchBuildResult = {
    query: FdProductWhereInput;
    order: FdProductOrderByWithRelationInput;
    pagination: { page: number, limit: number };
    interest_rate_filter: FdInterestRateWhereInput;
}

const FD_TENURE_MAP: Record<string, number[]> = {
    "1y": [365, 366],
    "2y": [730, 731],
    "3y": [1095, 1096],
    "5y": [1825, 1826],
};

const FD_TENURE_BUCKETS = {
    LT_1Y: { lt: 365 },
    Y1_TO_3: { gte: 365, lte: 1095 },
    Y3_TO_5: { gt: 1095, lte: 1825 },
    GT_5Y: { gt: 1825 },
} as const;

const parse_optional_boolean = (value: unknown): boolean | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;

    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
    return undefined;
}

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const get_mf_search_query = (params: any): { query: MfProductWhereInput, order: MfProductOrderByWithRelationInput, search?: string } => {
    logger.debug("Query for get_mf_search_query ==> ", params);
    const { category, risk, sort_by, search } = params;
    const normalized_category = map_mf_asset_type(category, category);

    const query: MfProductWhereInput = {
        ...(normalized_category && { asset_type: { equals: normalized_category } }),
        ...(risk && { risk_level: { equals: risk } }),
        ...(sort_by === "3m" && { metrics: { return_90d: { not: null } } }),
        ...(sort_by === "6m" && { metrics: { return_6m: { not: null } } }),
        ...(sort_by === "1y" && { metrics: { return_1y: { not: null } } }),
        ...(sort_by === "3y" && { metrics: { return_3y: { not: null } } }),
        ...(sort_by === "5y" && { metrics: { return_5y: { not: null } } }),
    }

    logger.debug("Query for sort by ==> ", sort_by)
    const order: MfProductOrderByWithRelationInput = {
        ...(sort_by === "3m" && { metrics: { return_90d: { sort: 'desc', nulls: 'last' } } }),
        ...(sort_by === "6m" && { metrics: { return_6m: { sort: 'desc', nulls: 'last' } } }),
        ...(sort_by === "1y" && { metrics: { return_1y: { sort: 'desc', nulls: 'last' } } }),
        ...(sort_by === "3y" && { metrics: { return_3y: { sort: 'desc', nulls: 'last' } } }),
        ...(sort_by === "5y" && { metrics: { return_5y: { sort: 'desc', nulls: 'last' } } }),
    }
    logger.debug("Query for order by ==> ", order)
    return { query, order, search };
}

const normalize_fd_pagination = (params: RawFdParams): { page: number, limit: number } => {
    const page = Math.max(1, parseInt(params.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit as string) || 30));

    return { page, limit };
}

const build_fd_interest_rate_filter = (params: RawFdParams): FdInterestRateWhereInput => {
    const tenure_bucket_key = String(params.tenure_bucket ?? "").toUpperCase() as keyof typeof FD_TENURE_BUCKETS;
    const tenure_key = String(params.tenure ?? "").toLowerCase();

    const payout_frequency = String(params.payout_frequency ?? "CUMULATIVE").toUpperCase() as FdPayoutFrequency;
    const customer_type_candidate = String(params.customer_type ?? "").toUpperCase();
    const customer_type = Object.values(FdCustomerType).includes(customer_type_candidate as FdCustomerType)
        ? customer_type_candidate as FdCustomerType
        : undefined;

    let tenure_days: any = undefined;

    if (FD_TENURE_BUCKETS[tenure_bucket_key]) {
        tenure_days = FD_TENURE_BUCKETS[tenure_bucket_key];
    } else if (tenure_key && FD_TENURE_MAP[tenure_key]) {
        tenure_days = { in: FD_TENURE_MAP[tenure_key] };
    }

    return {
        ...(tenure_days !== undefined && { tenure_days }),
        payout_frequency,
        ...(customer_type ? { customer_type } : {}),
    };
}

const parse_optional_number = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

const build_fd_where_query = (params: RawFdParams, interestRateFilter: FdInterestRateWhereInput): FdProductWhereInput => {
    const min_deposit = parse_optional_number(params.min_deposit);
    const low_min_investment = parse_optional_boolean(params.low_min_investment);
    const issuer_type_candidate = String(params.issuer_type ?? "").toUpperCase();
    const issuer_type = Object.values(IssuerType).includes(issuer_type_candidate as IssuerType)
        ? issuer_type_candidate as IssuerType
        : undefined;
    const search = String(params.search ?? "").trim();

    const min_deposit_filter: { gte?: number, lte?: number } = {
        ...(min_deposit !== undefined ? { gte: min_deposit } : {}),
        ...(low_min_investment ? { lte: 2000 } : {}),
    };

    return {
        ...(issuer_type ? { issuer: { issuer_type } } : {}),
        ...(Object.keys(min_deposit_filter).length > 0
            ? {
                min_deposit: {
                    ...min_deposit_filter,
                },
            }
            : {}),
        ...(search && {
            OR: [
                { type: { contains: search, mode: 'insensitive' } },
                {
                    issuer: {
                        OR: [
                            { full_name: { contains: search, mode: 'insensitive' } },
                            { display_name: { contains: search, mode: 'insensitive' } },
                            { operating_since: { contains: search, mode: 'insensitive' } },
                            { about_description: { contains: search, mode: 'insensitive' } },
                        ]
                    }
                },
            ]
        }),
        interest_rates: { some: interestRateFilter }
    };
}

const build_fd_order_query = (params: RawFdParams): FdProductOrderByWithRelationInput => {
    const sort_by = String(params.sort_by ?? "created_at").toLowerCase();
    const sort_order: "asc" | "desc" = String(params.sort_order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";

    if (sort_by === "min_deposit") return { min_deposit: sort_order };
    if (sort_by === "max_deposit") return { max_deposit: sort_order };
    if (sort_by === "tenure") return { min_tenure_days: sort_order };

    return { createdAt: sort_order };
}

export const get_fd_search_query = (params: RawFdParams): FdSearchBuildResult => {
    const pagination = normalize_fd_pagination(params);
    const interest_rate_filter = build_fd_interest_rate_filter(params);
    const query = build_fd_where_query(params, interest_rate_filter);
    const order = build_fd_order_query(params);

    return {
        query,
        order,
        pagination,
        interest_rate_filter,
    };
}

export const build_fd_list_cache_key = (params: RawFdParams): string => {
    const pagination = normalize_fd_pagination(params);
    const tenure_key = String(params.tenure ?? "").toLowerCase();
    const normalized_tenure = FD_TENURE_MAP[tenure_key] ? tenure_key : null;
    const tenure_bucket_candidate = String(params.tenure_bucket ?? "").toUpperCase();
    const tenure_bucket = Object.keys(FD_TENURE_BUCKETS).includes(tenure_bucket_candidate)
        ? tenure_bucket_candidate
        : "";
    const payout_frequency = String(params.payout_frequency ?? "CUMULATIVE").toUpperCase();
    const customer_type_candidate = String(params.customer_type ?? "").toUpperCase();
    const customer_type = Object.values(FdCustomerType).includes(customer_type_candidate as FdCustomerType)
        ? customer_type_candidate
        : "";
    const issuer_type_candidate = String(params.issuer_type ?? "").toUpperCase();
    const issuer_type = Object.values(IssuerType).includes(issuer_type_candidate as IssuerType)
        ? issuer_type_candidate
        : "";
    const sort_by = String(params.sort_by ?? "created_at").toLowerCase();
    const search = String(params.search ?? "").trim();
    const normalized_sort_by = ["min_deposit", "max_deposit", "tenure", "created_at"].includes(sort_by) ? sort_by : "created_at";
    const sort_order = String(params.sort_order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const min_deposit = parse_optional_number(params.min_deposit);
    const low_min_investment = parse_optional_boolean(params.low_min_investment);
    const env_mode = env.ENVIRONMENT

    const normalized_payload = {
        version: 2,
        page: pagination.page,
        limit: pagination.limit,
        tenure: normalized_tenure,
        tenure_bucket,
        payout_frequency,
        customer_type,
        issuer_type,
        low_min_investment: low_min_investment ?? null,
        min_deposit: min_deposit ?? null,
        sort_by: normalized_sort_by,
        sort_order,
        search,
        env_mode,
    };

    const hash = createHash("sha1").update(JSON.stringify(normalized_payload)).digest("hex");
    return `fd:list:v2:page1:${hash}`;
}

export const compress_json = async (value: unknown): Promise<Buffer> => {
    return await gzipAsync(JSON.stringify(value));
}

export const decompress_json = async <T>(buffer: Buffer): Promise<T> => {
    const decompressed = await gunzipAsync(buffer);
    return JSON.parse(decompressed.toString("utf-8")) as T;
}


export const chunkArray = (array: any[], size: number): any[][] => {
    const chunked: any[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
};


export const logMemoryUsage = (step: string) => {
    const used = process.memoryUsage();
    // heapUsed is the amount of memory occupied by objects created in JS
    const memoryInMB = Math.round(used.heapUsed / 1024 / 1024 * 100) / 100;

    // Using Winston if you have it, otherwise console.info
    logger.info(`[Memory Check] ${step}: ${memoryInMB} MB`);
};

export const decompressAndFilter = async (buffer: Buffer, period?: string) => {
    const decompressed = await gunzipAsync(buffer);

    const nav_history = JSON.parse(decompressed.toString("utf-8"));

    if (period === "all" || !period) return nav_history;

    // Filtering logic based on period : 3,6,1y,3y, 5y, all
    const now = new Date();
    const cutoffDate = new Date();

    switch (period) {
        case "3m": cutoffDate.setMonth(now.getMonth() - 3); break;
        case "6m": cutoffDate.setMonth(now.getMonth() - 6); break;
        case "1y": cutoffDate.setFullYear(now.getFullYear() - 1); break;
        case "3y": cutoffDate.setFullYear(now.getFullYear() - 3); break;
        case "5y": cutoffDate.setFullYear(now.getFullYear() - 5); break;
    }

    const cutoffTimestamp = cutoffDate.getTime();

    return nav_history.filter((entry: any) => {
        return new Date(entry.nav_date).getTime() >= cutoffTimestamp;
    });

}

export const hash_mpin = async (mpin: string): Promise<string> => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(mpin, salt);
}

export const compare_mpin = async (mpin: string, hashedMpin: string): Promise<boolean> => {
    return await bcrypt.compare(mpin, hashedMpin);
}