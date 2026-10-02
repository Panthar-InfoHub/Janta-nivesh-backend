import fs from "fs";
import path from "path";
import logger from "../middleware/logger.js";

interface BankEntry {
    ifsc: string;
    bank_name: string;
}

class BankMaster {
    private static instance: BankMaster;
    private readonly bankMap: Map<string, string>;

    private constructor() {
        this.bankMap = new Map<string, string>();
        this.loadMasterData();
    }

    public static getInstance(): BankMaster {
        if (!BankMaster.instance) {
            BankMaster.instance = new BankMaster();
        }
        return BankMaster.instance;
    }

    private loadMasterData(): void {
        try {
            const filePath = path.join(process.cwd(), "output_bank.json");
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, "utf-8");
                const data: BankEntry[] = JSON.parse(raw);

                if (Array.isArray(data)) {
                    for (const entry of data) {
                        if (entry?.ifsc && entry?.bank_name) {
                            this.bankMap.set(entry.ifsc.trim().toUpperCase(), entry.bank_name.trim());
                        }
                    }
                }
                logger.info(`[BankMaster] Initialized ${this.bankMap.size} bank prefixes in memory.`);
            } else {
                logger.warn(`[BankMaster] output_bank.json not found at ${filePath}`);
            }
        } catch (error) {
            logger.error("[BankMaster] Failed to load output_bank.json:", error);
        }
    }

    /**
     * O(1) Lookup: Resolves bank name from an 11-char IFSC code or 4-char prefix
     */
    public getBankName(ifscCode?: string | null): string | null {
        if (!ifscCode || typeof ifscCode !== "string") return null;

        const cleanIfsc = ifscCode.trim().toUpperCase();
        if (cleanIfsc.length < 4) return null;

        const prefix = cleanIfsc.substring(0, 4);
        return this.bankMap.get(prefix) ?? null;
    }
}

export const bank_master = BankMaster.getInstance();
export const get_bank_name_from_ifsc = (ifsc?: string | null): string | null => bank_master.getBankName(ifsc);
