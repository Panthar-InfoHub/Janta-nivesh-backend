import { createHash } from "crypto";
import { promisify } from "util";
import bcrypt from "bcryptjs";
import logger from "../middleware/logger.js";
import { gunzip, gzip } from "zlib";
import { FdPayoutFrequency } from "../prisma/generated/prisma/enums.js";
import {
    FdInterestRateWhereInput,
    FdProductOrderByWithRelationInput,
    FdProductWhereInput,
    MfProductOrderByWithRelationInput,
    MfProductWhereInput
} from "../prisma/generated/prisma/models.js";

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

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const get_mf_search_query = (params: any): { query: MfProductWhereInput, order: MfProductOrderByWithRelationInput, search?: string } => {

    const { category, risk, sort_by, search } = params;
    const normalized_category = map_mf_asset_type(category, category);

    const query: MfProductWhereInput = {
        ...(normalized_category && { asset_type: { equals: normalized_category } }),
        ...(risk && { risk_level: { equals: risk } }),
    }

    const order: MfProductOrderByWithRelationInput = {
        ...(sort_by === "3m" && { metrics: { return_90d: 'desc' } }),
        ...(sort_by === "6m" && { metrics: { return_6m: 'desc' } }),
        ...(sort_by === "1y" && { metrics: { return_1y: 'desc' } }),
        ...(sort_by === "3y" && { metrics: { return_3y: 'desc' } }),
    }

    return { query, order, search };
}

const normalize_fd_pagination = (params: RawFdParams): { page: number, limit: number } => {
    const page = Math.max(1, parseInt(params.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit as string) || 30));

    return { page, limit };
}

const build_fd_interest_rate_filter = (params: RawFdParams): FdInterestRateWhereInput => {
    const tenure_key = String(params.tenure ?? "3y").toLowerCase();
    const tenure_days = FD_TENURE_MAP[tenure_key] ?? FD_TENURE_MAP["3y"];

    const payout_frequency = String(params.payout_frequency ?? "CUMULATIVE").toUpperCase() as FdPayoutFrequency;

    return {
        tenure_days: { in: tenure_days },
        payout_frequency,
        // is_default_selection: true,
    };
}

const parse_optional_number = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

const build_fd_where_query = (params: RawFdParams, interestRateFilter: FdInterestRateWhereInput): FdProductWhereInput => {
    const min_deposit = parse_optional_number(params.min_deposit);
    const max_deposit = parse_optional_number(params.max_deposit);
    const search = String(params.search ?? "").trim();

    return {
        ...(params.issuer_id ? { issuer_id: String(params.issuer_id) } : {}),
        ...(min_deposit !== undefined || max_deposit !== undefined
            ? {
                min_deposit: {
                    ...(min_deposit !== undefined ? { gte: min_deposit } : {}),
                    ...(max_deposit !== undefined ? { lte: max_deposit } : {}),
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
    const tenure_key = String(params.tenure ?? "3y").toLowerCase();
    const normalized_tenure = FD_TENURE_MAP[tenure_key] ? tenure_key : "3y";
    const payout_frequency = String(params.payout_frequency ?? "CUMULATIVE").toUpperCase();
    const sort_by = String(params.sort_by ?? "created_at").toLowerCase();
    const search = String(params.search ?? "").trim();
    const normalized_sort_by = ["min_deposit", "max_deposit", "tenure", "created_at"].includes(sort_by) ? sort_by : "created_at";
    const sort_order = String(params.sort_order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
    const min_deposit = parse_optional_number(params.min_deposit);
    const max_deposit = parse_optional_number(params.max_deposit);

    const normalized_payload = {
        version: 1,
        page: pagination.page,
        limit: pagination.limit,
        tenure: normalized_tenure,
        payout_frequency,
        issuer_id: params.issuer_id ? String(params.issuer_id) : "",
        min_deposit: min_deposit ?? null,
        max_deposit: max_deposit ?? null,
        sort_by: normalized_sort_by,
        sort_order,
        search,
    };

    const hash = createHash("sha1").update(JSON.stringify(normalized_payload)).digest("hex");
    return `fd:list:v1:page1:${hash}`;
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