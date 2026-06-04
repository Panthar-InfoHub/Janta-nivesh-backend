import fs from "fs";
import path from "path";
import { db } from "../server.js";
import logger from "../middleware/logger.js";

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
}

export const wrapper_service = new WrapperServiceClass();