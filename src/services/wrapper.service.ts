import fs from "fs";
import path from "path";
import { db } from "../server.js";
import logger from "../middleware/logger.js";
import { redis, redis_buffer_client } from "../lib/redis.js";
import { user_finnsys_service } from "./user.finnsys.service.js";
import { mutual_fund_finnsys_service } from "./finnsys/mf.finnsys.service.js";
import { compress_json, decompress_json } from "../lib/utils.js";
import { env } from "../lib/config-env.js";

class WrapperServiceClass {
    // In-memory cache for static JSON logos
    private logoDataCache = new Map<string, string>();

    constructor() {
        this.initializeStaticCache();
    }

    private initializeStaticCache() {
        try {
            const filePath = path.join(process.cwd(), "logo_data.json");
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, "utf-8");
                const data = JSON.parse(fileContent);
                if (Array.isArray(data)) {
                    data.forEach((item: any) => {
                        if (item.mutual_fund_name && item.logo_url) {
                            // Store lowercase keys for case-insensitive matching
                            this.logoDataCache.set(item.mutual_fund_name.toLowerCase(), item.logo_url);
                        }
                    });
                }
                logger.info(`Loaded ${this.logoDataCache.size} AMC logos from static JSON file.`);
            } else {
                logger.warn(`logo_data.json not found at ${filePath}`);
            }
        } catch (error) {
            logger.error("Failed to load logo_data.json:", error);
        }
    }

    /**
     * Resolves logo URLs for a batch of Scheme IDs in an optimized way.
     * 1. Query the database in ONE query for all matching scheme IDs.
     * 2. For each scheme ID, if the product has a direct logo (img_url), use it.
     * 3. If direct logo is missing/empty, fall back to the AMC logo using product's amc_name and the static JSON cache.
     * 
     * @param schemeIds Array of scheme IDs to resolve logos for
     * @returns A Map mapping scheme ID (as a string) to its logo URL
     */
    async getLogosForSchemes(schemeIds: string[]): Promise<Map<string, string>> {
        const logo_map = new Map<string, string>();
        if (!schemeIds || schemeIds.length === 0) return logo_map;

        const cleanSchemeIds = schemeIds.map(id => String(id).trim()).filter(id => !!id);
        if (cleanSchemeIds.length === 0) return logo_map;

        try {
            // Fetch products matching scheme_ids
            const dbProducts = await db.mfProduct.findMany({
                where: {
                    scheme_id: {
                        in: cleanSchemeIds
                    }
                },
                select: {
                    scheme_id: true,
                    img_url: true,
                    amc_name: true
                }
            });

            // Map each scheme_id to its logo
            dbProducts.forEach(product => {
                if (product.scheme_id) {
                    let url = product.img_url || "";

                    // Fall back to AMC logo if scheme-specific logo is missing
                    if (!url && product.amc_name) {
                        url = this.logoDataCache.get(product.amc_name.toLowerCase()) || "";
                    }

                    logo_map.set(product.scheme_id, url);
                }
            });

            // Fill in empty strings for schemes not found in DB at all
            cleanSchemeIds.forEach(id => {
                if (!logo_map.has(id)) {
                    logo_map.set(id, "");
                }
            });

        } catch (error) {
            logger.error("Error fetching Scheme logos from database:", error);
            cleanSchemeIds.forEach(id => {
                logo_map.set(id, "");
            });
        }

        return logo_map;
    }

    /**
     * Resolves AMC Details (name and logo) for a batch of Scheme IDs in an optimized way.
     * 
     * @param schemeIds Array of scheme IDs to resolve details for
     * @returns A Map mapping scheme ID (as a string) to its AMC details
     */
    async getAmcDetailsForSchemes(schemeIds: string[]): Promise<Map<string, { amc_name: string, img_url: string, product_id: string, transaction_rules: any }>> {
        const details_map = new Map<string, { amc_name: string, img_url: string, product_id: string, transaction_rules: any }>();
        if (!schemeIds || schemeIds.length === 0) return details_map;

        const cleanSchemeIds = schemeIds.map(id => String(id).trim()).filter(id => !!id);
        if (cleanSchemeIds.length === 0) return details_map;

        try {
            // Fetch products matching scheme_ids
            const dbProducts = await db.mfProduct.findMany({
                where: {
                    scheme_id: {
                        in: cleanSchemeIds
                    }
                },
                select: {
                    scheme_id: true,
                    img_url: true,
                    amc_name: true,
                    id: true,
                    transaction_rules: {
                        select: {
                            min_sip_amount: true,
                            min_lump_sum_amount: true
                        }
                    }
                }
            });

            // Map each scheme_id to its details
            dbProducts.forEach(product => {
                if (product.scheme_id) {
                    let url = product.img_url || "";

                    // Fall back to AMC logo if scheme-specific logo is missing
                    if (!url && product.amc_name) {
                        url = this.logoDataCache.get(product.amc_name.toLowerCase()) || "";
                    }

                    details_map.set(product.scheme_id, {
                        amc_name: product.amc_name || "",
                        img_url: url,
                        product_id: product.id,
                        transaction_rules: product.transaction_rules
                    });
                }
            });

            // Fill in empty values for schemes not found in DB
            cleanSchemeIds.forEach(id => {
                if (!details_map.has(id)) {
                    details_map.set(id, { amc_name: "", img_url: "", product_id: "", transaction_rules: { min_sip_amount: "", min_lump_sum_amount: "" } });
                }
            });

        } catch (error) {
            logger.error("Error fetching AMC details from database:", error);
            cleanSchemeIds.forEach(id => {
                details_map.set(id, { amc_name: "", img_url: "", product_id: "", transaction_rules: { min_sip_amount: "", min_lump_sum_amount: "" } });
            });
        }

        return details_map;
    }

    /**
     * Resolves logo URLs for a batch of AMC names in an optimized way.
     * 1. Query the database in ONE query for all AMC names.
     * 2. For any missing AMC names, fall back to the in-memory static JSON cache.
     * 
     * @param amcNames Array of AMC names to resolve logos for
     * @returns A Map mapping AMC name to its logo URL
     */
    async get_logos_of_amc(amcNames: string[]): Promise<Map<string, string>> {
        const logo_map = new Map<string, string>();
        if (!amcNames || amcNames.length === 0) return logo_map;

        // Trim and filter empty names
        const cleanNames = amcNames.map(name => name?.trim()).filter(name => !!name);

        if (cleanNames.length === 0) return logo_map;
        try {
            // 1. Fetch logos from database in ONE batch query
            const dbProducts = await db.mfProduct.findMany({
                where: {
                    amc_name: {
                        in: cleanNames
                    },
                    img_url: {
                        not: ""
                    }
                },
                select: {
                    amc_name: true,
                    img_url: true
                },
                distinct: ["amc_name"]
            });

            // Populate the temporary map with DB results (lowercased keys)
            const tempMap = new Map<string, string>();
            dbProducts.forEach(product => {
                if (product.amc_name && product.img_url) {
                    tempMap.set(product.amc_name.toLowerCase(), product.img_url);
                }
            });

            // 2. Resolve for each request name, falling back to static cache
            cleanNames.forEach(name => {
                const key = name.toLowerCase();
                let url = tempMap.get(key);

                if (!url) {
                    // Fallback to static cache
                    url = this.logoDataCache.get(key) || "";
                }

                logo_map.set(name, url);
            });
        } catch (error) {
            logger.error("Error fetching AMC logos from database:", error);
            // Fallback completely to static cache on DB failure
            cleanNames.forEach(name => {
                logo_map.set(name, this.logoDataCache.get(name.toLowerCase()) || "");
            });
        }

        return logo_map;
    }

    /**
     * Get image URL for a single AMC name (with fallback)
     */
    async get_mf_img_by_amc_name(amcName: string): Promise<string> {
        if (!amcName) return "";
        const cleanName = amcName.trim();
        try {
            const product = await db.mfProduct.findFirst({
                where: {
                    amc_name: cleanName,
                    img_url: { not: "" }
                },
                select: { img_url: true }
            });
            if (product?.img_url) return product.img_url;
        } catch (error) {
            logger.error(`Error fetching AMC logo for ${amcName}:`, error);
        }
        return this.logoDataCache.get(cleanName.toLowerCase()) || "";
    }

    /**
     * Resolves transaction rules for a batch of NSE scheme codes.
     */
    async get_transaction_rules_by_nse_codes(nse_codes: string[]): Promise<Map<string, any>> {
        const rules_map = new Map<string, any>();
        if (!nse_codes || nse_codes.length === 0) return rules_map;

        const cleanCodes = Array.from(new Set(nse_codes.filter(c => !!c)));
        if (cleanCodes.length === 0) return rules_map;

        try {
            const products = await db.mfProduct.findMany({
                where: { nse_scheme_code: { in: cleanCodes } },
                select: {
                    nse_scheme_code: true,
                    transaction_rules: true
                }
            });

            products.forEach(p => {
                if (p.nse_scheme_code && p.transaction_rules) {
                    rules_map.set(p.nse_scheme_code, p.transaction_rules);
                }
            });
        } catch (error) {
            logger.error("Error fetching transaction rules by NSE codes:", error);
        }

        return rules_map;
    }

    /**
     * Resolves amc_name and img_url for a batch of NSE scheme codes.
     */
    async get_details_by_nse_codes(nse_codes: string[]): Promise<Map<string, { amc_name: string, img_url: string }>> {
        const details_map = new Map<string, { amc_name: string, img_url: string }>();
        if (!nse_codes || nse_codes.length === 0) return details_map;

        const cleanCodes = Array.from(new Set(nse_codes.filter(c => !!c)));
        if (cleanCodes.length === 0) return details_map;

        try {
            const products = await db.mfProduct.findMany({
                where: { nse_scheme_code: { in: cleanCodes } },
                select: {
                    nse_scheme_code: true,
                    amc_name: true,
                    img_url: true
                }
            });

            products.forEach(p => {
                if (p.nse_scheme_code) {
                    let url = p.img_url || "";
                    if (!url && p.amc_name) {
                        url = this.logoDataCache.get(p.amc_name.toLowerCase()) || "";
                    }
                    details_map.set(p.nse_scheme_code, {
                        amc_name: p.amc_name || "",
                        img_url: url
                    });
                }
            });
        } catch (error) {
            logger.error("Error fetching details by NSE codes:", error);
        }

        return details_map;
    }

    /**
     * Fetch user portfolio from Redis cache if available, else fetch from Finnsys and cache.
     */
    async get_user_portfolio_cached(user_id: string, log: string, pwd: string): Promise<any> {
        const cache_key = `mf_portfolio:finnsys:${user_id}`;
        let portfolio_res: any = null;

        const cached = await redis.get(cache_key);
        if (cached) {
            try {
                portfolio_res = JSON.parse(cached as string);
                logger.debug("Fetched user portfolio from Redis cache");
            } catch (e) {
                logger.warn("Failed to parse cached portfolio", e);
            }
        }

        if (!portfolio_res) {
            portfolio_res = await user_finnsys_service.get_user_portfolio_finnsys(log, pwd);
            
            if (portfolio_res && (portfolio_res.code == 1 || portfolio_res.code == 0)) {
                // Cache for 3 hours (10800 seconds)
                await redis.set(cache_key, JSON.stringify(portfolio_res), { EX: 10800 });
            }
        }
        return portfolio_res;
    }

    /**
     * Fetch xSIP registration report from Redis cache if available (compressed), else fetch from Finnsys and cache.
     * Uses a 10-year date range to fetch all SIPs for the user.
     */
    async get_xsip_registration_report_cached(client_code: string, log: string, pwd: string): Promise<any> {
        if (!client_code) return null;

        const cache_key = `mf_xsip:finnsys:${client_code}`;
        let xsip_report: any = null;

        try {
            const cached = await redis_buffer_client.get(cache_key);
            if (cached) {
                xsip_report = await decompress_json<any>(cached as Buffer);
                logger.debug("Fetched user xSIP report from Redis cache (decompressed)");
                return xsip_report;
            }
        } catch (e) {
            logger.warn("Failed to retrieve or decompress cached xSIP report", e);
        }

        // If not cached, fetch from Finnsys for a 10 year range
        try {
            const today = new Date();
            const tenYearsAgo = new Date();
            tenYearsAgo.setFullYear(today.getFullYear() - 10);
            
            const formatDate = (date: Date) => {
                const d = String(date.getDate()).padStart(2, '0');
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const y = date.getFullYear();
                return `${y}-${m}-${d}`;
            };

            const sipPayload = {
                arn: env.ARN,
                username: log,
                password: pwd,
                data: {
                    client_code: client_code,
                    from_date: formatDate(tenYearsAgo),
                    to_date: formatDate(today)
                }
            };

            xsip_report = await mutual_fund_finnsys_service.get_xsip_registration_report(sipPayload);
            
            if (xsip_report && (xsip_report.code == 1 || xsip_report.code == 0)) {
                try {
                    const compressed = await compress_json(xsip_report);
                    // Cache for 24 hours (86400 seconds)
                    await redis_buffer_client.set(cache_key, compressed, { EX: 86400 });
                    logger.debug("Cached user xSIP report in Redis (compressed)");
                } catch (e) {
                    logger.warn("Failed to compress and cache xSIP report", e);
                }
            }
        } catch (error) {
            logger.error("Error fetching xSIP registration report for cache", error);
        }

        return xsip_report;
    }
}

export const wrapper_service = new WrapperServiceClass();