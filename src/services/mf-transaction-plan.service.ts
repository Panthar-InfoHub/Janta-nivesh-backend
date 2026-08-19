import { db } from "../server.js";
import logger from "../middleware/logger.js";
import AppError from "../middleware/error.middleware.js";
import { MfTransactionState } from "../prisma/generated/prisma/enums.js";

export type MfPlanType = "PURCHASE" | "REDEMPTION" | "SWITCH";

export type { MfTransactionState };

// Derived from the generated Prisma enum, deliberately NOT hand-listed: a hand-rolled copy silently
// drifts the moment a value is added to the schema, and the symptom is a 502 UNKNOWN_FP_STATE on a
// state Postgres would have accepted (which is exactly what happened when UNDER_REVIEW was added).
const MF_TRANSACTION_STATES: readonly string[] = Object.values(MfTransactionState);

// FP sends lowercase snake_case state strings (e.g. "review_completed"); our enum is
// SCREAMING_SNAKE_CASE to match every other enum in this codebase. Validates rather than
// blindly casting - an unrecognized value should fail loudly here, not as an opaque Postgres
// enum-constraint error out of the upsert below.
const to_mf_transaction_state = (raw: string): MfTransactionState => {
    const upper = raw.toUpperCase();
    if (MF_TRANSACTION_STATES.includes(upper)) {
        return upper as MfTransactionState;
    }
    logger.error("Unrecognized FP transaction state", { raw });
    throw new AppError(`Unrecognized transaction state from FP: ${raw}`, 502, "UNKNOWN_FP_STATE");
};

// One ledger for every MF transaction a user makes - systematic plans (SIP/SWP/STP) and
// one-shot orders (lumpsum purchase/redemption/switch) both live here, discriminated by
// `systematic`. The FP payloads across all of these are near-identical, so one upsert handles
// all of them - type-specific fields just come back undefined for the type that doesn't use them.
class MfTransactionPlanServiceClass {

    /**
     * `systematic` matters here: plans and one-shot orders share plan_type (a lumpsum purchase and
     * a SIP are both PURCHASE), so a listing that filters on plan_type alone would mix them.
     * Callers listing plans must pass true.
     */
    get_all = async (user_id: string, plan_type?: MfPlanType, systematic?: boolean) => {
        return await db.mfTransactionPlan.findMany({
            where: {
                user_id,
                ...(plan_type ? { plan_type } : {}),
                ...(systematic === undefined ? {} : { systematic }),
            },
            orderBy: { createdAt: "desc" }
        });
    }

    get_by_fp_id = async (user_id: string, fp_plan_id: string) => {
        return await db.mfTransactionPlan.findFirst({ where: { user_id, fp_id: fp_plan_id } });
    }

    /**
     * Upserts from an FP plan/order payload (create/fetch/update all return the same shape),
     * keyed on fp_id so repeated syncs just refresh the row.
     *
     * `systematic` is an explicit argument, NOT read off the payload: the one-shot order endpoints
     * never send that field, so inferring it would silently persist every lumpsum order as a plan.
     */
    upsert_from_fp = async (user_id: string, plan_type: MfPlanType, plan: any, systematic: boolean) => {
        const state = to_mf_transaction_state(plan?.state);
        logger.debug("Persisting mf transaction plan", { user_id, plan_type, systematic, fp_id: plan?.id, state });

        // Resolve the catalogue FK from the ISIN FP echoes back. Doing it here rather than in each
        // controller means every call site gets it, including flows not built yet. A miss is logged
        // but not thrown - FP has already accepted the order, so refusing to record it would lose
        // the transaction entirely over a catalogue gap.
        const product = await db.mfProduct.findUnique({ where: { isin: plan.scheme }, select: { id: true } });
        if (!product) {
            logger.warn("No MfProduct for this ISIN - transaction stored without a catalogue link", {
                isin: plan.scheme, fp_id: plan.id,
            });
        }

        const data = {
            user_id,
            plan_type,
            fp_id: plan.id,
            fp_old_id: plan.old_id ?? null,
            mf_product_id: product?.id ?? null,
            mf_investment_account: plan.mf_investment_account,
            scheme: plan.scheme,
            folio_number: plan.folio_number ?? null,
            amount: plan.amount ?? null,
            units: plan.units ?? null,
            systematic,
            frequency: plan.frequency ?? null,
            installment_day: plan.installment_day ?? null,
            scheduled_on: plan.scheduled_on ? new Date(plan.scheduled_on) : null,

            number_of_installments: plan.number_of_installments ?? null,
            remaining_installments: plan.remaining_installments ?? null,
            requested_activation_date: plan.requested_activation_date ? new Date(plan.requested_activation_date) : null,
            start_date: plan.start_date ? new Date(plan.start_date) : null,
            end_date: plan.end_date ? new Date(plan.end_date) : null,
            next_installment_date: plan.next_installment_date ? new Date(plan.next_installment_date) : null,
            previous_installment_date: plan.previous_installment_date ? new Date(plan.previous_installment_date) : null,

            state,
            auto_generate_installments: plan.auto_generate_installments ?? true,
            generate_first_installment_now: plan.generate_first_installment_now ?? false,

            payment_method: plan.payment_method ?? null,
            payment_source: plan.payment_source ?? null,
            purpose: plan.purpose ?? null,

            source_ref_id: plan.source_ref_id ?? null,
            partner: plan.partner ?? null,
            gateway: plan.gateway ?? "ondc",
            euin: plan.euin ?? null,
            user_ip: plan.user_ip ?? null,
            server_ip: plan.server_ip ?? null,
            initiated_by: plan.initiated_by ?? null,
            initiated_via: plan.initiated_via ?? null,

            consent_email: plan.consent?.email ?? null,
            consent_isd_code: plan.consent?.isd_code ?? null,
            consent_mobile: plan.consent?.mobile ?? null,

            // Settlement / allotment - null until the RTA processes the order
            traded_on: plan.traded_on ? new Date(plan.traded_on) : null,
            submitted_at: plan.submitted_at ? new Date(plan.submitted_at) : null,
            succeeded_at: plan.succeeded_at ? new Date(plan.succeeded_at) : null,
            allotted_units: plan.allotted_units ?? null,
            allotted_nav_date: plan.allotted_nav_date ? new Date(plan.allotted_nav_date) : null,
            purchased_amount: plan.purchased_amount ?? null,
            purchased_price: plan.purchased_price ?? null,

            fp_created_at: plan.created_at ? new Date(plan.created_at) : null,
            activated_at: plan.activated_at ? new Date(plan.activated_at) : null,
            cancelled_at: plan.cancelled_at ? new Date(plan.cancelled_at) : null,
            cancellation_scheduled_on: plan.cancellation_scheduled_on ? new Date(plan.cancellation_scheduled_on) : null,
            cancellation_code: plan.cancellation_code ?? null,
            auto_cancelled: plan.auto_cancelled ?? null,
            failed_at: plan.failed_at ? new Date(plan.failed_at) : null,
            completed_at: plan.completed_at ? new Date(plan.completed_at) : null,
            reason: plan.reason ?? null,

            raw_response: plan,
        };

        return await db.mfTransactionPlan.upsert({
            where: { fp_id: plan.id },
            create: data,
            update: data,
        });
    }

    /** Records that our own OTP gate was passed and consent was sent to FP - not the OTP value itself. */
    mark_consent_given = async (id: string) => {
        return await db.mfTransactionPlan.update({ where: { id }, data: { consent_given_at: new Date() } });
    }

    /**
     * Stores the payment created against a one-shot order. Written before the order is confirmed,
     * so a retry of the confirm sequence can tell "payment already created" from "not yet" and
     * skip it rather than charging twice.
     */
    set_payment_id = async (id: string, fp_payment_id: string) => {
        return await db.mfTransactionPlan.update({ where: { id }, data: { fp_payment_id } });
    }
}

export const mf_transaction_plan_service = new MfTransactionPlanServiceClass();
