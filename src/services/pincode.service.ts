import fs from "fs";
import path from "path";
import logger from "../middleware/logger.js";

interface PincodeEntry {
    pincode: number | string;
    district: string;
}

class PincodeServiceClass {
    private readonly pincodeMap: Map<string, string>;
    private isLoaded: boolean = false;

    constructor() {
        this.pincodeMap = new Map<string, string>();
        this.loadMasterData();
    }

    private loadMasterData(): void {
        if (this.isLoaded) return;

        try {
            const filePath = path.join(process.cwd(), "pincodes.json");
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, "utf-8");
                const data: PincodeEntry[] = JSON.parse(raw);

                if (Array.isArray(data)) {
                    for (const entry of data) {
                        if (entry?.pincode && entry?.district) {
                            const pinStr = String(entry.pincode).trim();
                            // Keep primary district if duplicates exist
                            if (!this.pincodeMap.has(pinStr)) {
                                this.pincodeMap.set(pinStr, entry.district.trim());
                            }
                        }
                    }
                }
                this.isLoaded = true;
                logger.info(`[PincodeService] Initialized ${this.pincodeMap.size} unique pincodes in memory.`);
            } else {
                logger.warn(`[PincodeService] pincodes.json not found at ${filePath}`);
            }
        } catch (error) {
            logger.error("[PincodeService] Failed to load pincodes.json:", error);
        }
    }

    /**
     * O(1) Lookup: Resolves city/district from 6-digit Indian PIN code.
     * Returns city/district name, or empty string "" if not found.
     */
    get_city_by_pincode = (pincode?: string | number | null): string => {
        if (!pincode) return "";

        const cleanPin = String(pincode).trim();
        if (!cleanPin) return "";

        return this.pincodeMap.get(cleanPin) || "";
    };
}

export const pincode_service = new PincodeServiceClass();
