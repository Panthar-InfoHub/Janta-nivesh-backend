import { db } from "../server.js";
import logger from "../middleware/logger.js";

export type MfPlanType = "PURCHASE" | "REDEMPTION" | "SWITCH";

// One ledger for every systematic plan (SIP/SWP/STP). The FP payloads for purchase and
// redemption plans are near-identical, so one upsert handles both - type-specific fields
// just come back undefined for the type that doesn't use them.
class MfTransactionPlanServiceClass {

    get_all = async (user_id: string, plan_type?: MfPlanType) => {
        return await db.mfTransactionPlan.findMany({
            where: { user_id, ...(plan_type ? { plan_type } : {}) },
            orderBy: { createdAt: "desc" }
        });
    }

    get_by_fp_id = async (user_id: string, fp_plan_id: string) => {
        return await db.mfTransactionPlan.findFirst({ where: { user_id, fp_plan_id } });
    }

    /**
     * Upserts from an FP plan payload (create/fetch/update all return the same shape),
     * keyed on fp_plan_id so repeated syncs just refresh the row.
     */
    upsert_from_fp = async (user_id: string, plan_type: MfPlanType, plan: any) => {
        logger.debug("Persisting mf transaction plan", { user_id, plan_type, fp_plan_id: plan?.id, state: plan?.state });

        const data = {
            user_id,
            plan_type,
            fp_plan_id: plan.id,
            mf_investment_account: plan.mf_investment_account,
            scheme: plan.scheme,
            folio_number: plan.folio_number ?? null,
            amount: plan.amount,
            systematic: plan.systematic ?? true,
            frequency: plan.frequency,
            installment_day: plan.installment_day ?? null,

            number_of_installments: plan.number_of_installments,
            remaining_installments: plan.remaining_installments ?? null,
            requested_activation_date: plan.requested_activation_date ? new Date(plan.requested_activation_date) : null,
            start_date: plan.start_date ? new Date(plan.start_date) : null,
            end_date: plan.end_date ? new Date(plan.end_date) : null,
            next_installment_date: plan.next_installment_date ? new Date(plan.next_installment_date) : null,
            previous_installment_date: plan.previous_installment_date ? new Date(plan.previous_installment_date) : null,

            state: plan.state,
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
            where: { fp_plan_id: plan.id },
            create: data,
            update: data,
        });
    }

    /** Records that our own OTP gate was passed and consent was sent to FP - not the OTP value itself. */
    mark_consent_given = async (id: string) => {
        return await db.mfTransactionPlan.update({ where: { id }, data: { consent_given_at: new Date() } });
    }
}

export const mf_transaction_plan_service = new MfTransactionPlanServiceClass();
