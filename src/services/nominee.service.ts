import { db } from "../server.js";
import AppError from "../middleware/error.middleware.js";
import logger from "../middleware/logger.js";
import type { NomineeInput, UpdateNomineeInput } from "../lib/zod-schemas/nominee.schema.js";

const ALLOCATION_TOTAL = 100;

class NomineeServiceClass {

    get_all = async (user_id: string) => {
        return await db.nominee.findMany({
            where: { user_id },
            orderBy: { createdAt: "asc" }
        });
    }

    private assert_valid_total = (percentages: number[]) => {
        const total = percentages.reduce((sum, p) => sum + p, 0);
        if (total !== ALLOCATION_TOTAL) {
            throw new AppError(
                `Nominee percentage allocations must sum to ${ALLOCATION_TOTAL}, got ${total}`,
                400,
                "INVALID_NOMINEE_ALLOCATION"
            );
        }
    }

    /** Flattens the nested phone_number/address input shape into the DB's flat columns. */
    private flatten = (n: Partial<NomineeInput>) => {
        const { phone_number, address, ...rest } = n;
        return {
            ...rest,
            ...(phone_number ? { phone_isd: phone_number.isd, phone_number: phone_number.number } : {}),
            ...(address ? {
                address_line1: address.line1,
                address_line2: address.line2,
                address_line3: address.line3,
                address_city: address.city,
                address_state: address.state,
                address_postal_code: address.postal_code,
                address_country: address.country,
            } : {}),
        };
    }

    /**
     * Creates a batch of nominees in one go (the "Add another nominee" screen submits the
     * whole list at once). Validates the combined total - existing nominees + this batch -
     * sums to exactly 100.
     */
    create_many = async (user_id: string, nominees: NomineeInput[]) => {
        const existing = await this.get_all(user_id);
        const existing_percentages = existing.map((n) => Number(n.percentage_allocation));
        const new_percentages = nominees.map((n) => n.percentage_allocation);

        this.assert_valid_total([...existing_percentages, ...new_percentages]);

        logger.debug("Creating nominees", { user_id, count: nominees.length });

        return await db.nominee.createManyAndReturn({
            data: nominees.map((n) => ({ ...this.flatten(n), user_id } as any))
        });
    }

    /**
     * Ownership-scoped update. If percentage_allocation is part of the patch, re-validates
     * the total across all of the user's nominees still sums to 100 with the new value applied.
     */
    update = async (user_id: string, nominee_id: string, patch: UpdateNomineeInput) => {
        const nominee = await db.nominee.findFirst({ where: { id: nominee_id, user_id } });
        if (!nominee) {
            throw new AppError("Nominee not found", 404, "NOMINEE_NOT_FOUND");
        }

        if (patch.percentage_allocation !== undefined) {
            const all = await this.get_all(user_id);
            const percentages = all.map((n) =>
                n.id === nominee_id ? patch.percentage_allocation! : Number(n.percentage_allocation)
            );
            this.assert_valid_total(percentages);
        }

        logger.debug("Updating nominee", { user_id, nominee_id });

        return await db.nominee.update({ where: { id: nominee_id }, data: this.flatten(patch) });
    }

    /** Ownership-scoped delete. Doesn't re-validate the 100% total - deleting is allowed to leave an incomplete set mid-edit. */
    delete = async (user_id: string, nominee_id: string) => {
        const result = await db.nominee.deleteMany({ where: { id: nominee_id, user_id } });
        if (result.count === 0) {
            throw new AppError("Nominee not found", 404, "NOMINEE_NOT_FOUND");
        }
        logger.debug("Deleted nominee", { user_id, nominee_id });
    }

    /** Sets the FP related_party object id once it's been registered. */
    set_fp_related_party_id = async (nominee_id: string, fp_related_party_id: string) => {
        return await db.nominee.update({ where: { id: nominee_id }, data: { fp_related_party_id } });
    }
}

export const nominee_service = new NomineeServiceClass();
