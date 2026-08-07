import { db } from "../server.js";
import type { Prisma } from "../prisma/generated/prisma/client.js";
import logger from "../middleware/logger.js";

class MandateServiceClass {

    get_all = async (user_id: string) => {
        return await db.mandate.findMany({ where: { user_id }, orderBy: { createdAt: "desc" } });
    }

    get_by_fp_payment_id = async (fp_payment_id: string) => {
        return await db.mandate.findFirst({ where: { fp_payment_id } });
    }

    create = async (user_id: string, data: {
        mandate_id: string;
        amount: number;
        fp_bank_account_id: string;
        fp_payment_id?: string | null;
        start_date?: Date | null;
        end_date?: Date | null;
    }) => {
        logger.debug("Persisting mandate", { user_id, mandate_id: data.mandate_id });

        return await db.mandate.create({
            data: {
                user_id,
                mandate_id: data.mandate_id,
                amount: data.amount,
                fp_bank_account_id: data.fp_bank_account_id,
                fp_payment_id: data.fp_payment_id ?? null,
                start_date: data.start_date ?? null,
                end_date: data.end_date ?? null,
            }
        });
    }

    update = async (id: string, data: Prisma.MandateUpdateInput) => {
        return await db.mandate.update({ where: { id }, data });
    }

    /** Ownership-scoped lookup by FP's mandate id (what the client gets back from create). */
    get_by_mandate_id = async (user_id: string, mandate_id: string) => {
        return await db.mandate.findFirst({ where: { user_id, mandate_id } });
    }

    /**
     * FP mandate_status -> our 3-state enum. Full FP vocab per the webhook event list:
     * created / received / submitted / approved / rejected / cancelled.
     */
    private map_status = (mandate_status?: string): "PENDING" | "SUCCESS" | "FAILED" => {
        switch ((mandate_status ?? "").toUpperCase()) {
            case "APPROVED":
                return "SUCCESS";
            case "REJECTED":
            case "CANCELLED":
                return "FAILED";
            default: // CREATED / RECEIVED / SUBMITTED - still in flight
                return "PENDING";
        }
    }

    /** Refreshes our row from a GET /api/pg/mandates/:id response. */
    sync_from_fp = async (id: string, fp_mandate: any) => {
        logger.debug("Syncing mandate from FP", { id, mandate_status: fp_mandate?.mandate_status });

        return await this.update(id, {
            status: this.map_status(fp_mandate?.mandate_status),
            umrn: fp_mandate?.umrn ?? undefined,
            failure_reason: fp_mandate?.rejected_reason ?? undefined,
            mandate_type: fp_mandate?.mandate_type ?? undefined,
            provider_name: fp_mandate?.provider_name ?? undefined,
            amount: fp_mandate?.mandate_limit ?? undefined,
            start_date: fp_mandate?.valid_from ? new Date(fp_mandate.valid_from) : undefined,
        });
    }
}

export const mandate_service = new MandateServiceClass();
