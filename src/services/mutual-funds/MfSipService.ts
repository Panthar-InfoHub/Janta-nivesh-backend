import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { db } from "../../server.js";
import { env } from "../../lib/config-env.js";
import { Sip_purchase_item } from "../../lib/types.js";
import { user_service } from "../user.service.js";
import { mutual_fund_finnsys_service } from "../finnsys/mf.finnsys.service.js";
import { nse_service } from "../nse.service.js";
import { redis_buffer_client } from "../../lib/redis.js";
import { MfHelperService } from "./MfHelperService.js";

export class MfSipService {

    constructor(private helper: MfHelperService) { }

    private validate_cumulative_sip_limit(cart_items: any[], active_sips: any[], limit: number) {
        let totalInstallment = 0;

        for (const sip of active_sips) {
            if (sip.status === "ACTIVE" || sip.status === "REGISTERED") {
                totalInstallment += parseFloat(sip.installments_amount || "0");
                // StepUp calculations removed as Finnsys doesn't return this data in the report
            }
        }

        for (const item of cart_items) {
            totalInstallment += parseFloat(item.sip_amt || item.txn_amount || "0");
            const step_up_amount = item.step_up_required === "Y" ? parseFloat(item.step_up_amount || "0") : 0;
            if (step_up_amount > 0) {
                totalInstallment += (step_up_amount * 5);
            }
        }

        if (totalInstallment > limit) {
            throw new AppError(
                `Cumulative SIP amount (${totalInstallment.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}) exceeds the mandate limit of ${limit.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}.`,
                400,
                "MANDATE_LIMIT_EXCEEDED"
            );
        }
    }

    initiate_sip_purchase = async (user_id: string, user_log: string, user_pwd: string, direct_items: Sip_purchase_item[]) => {
        const user = await user_service.get_all_user_data(user_id, { user_bank_details: true });

        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
        if (!user.nse_client_code) throw new AppError("Trading account not set up (Client Code missing)", 400, "TRADING_ACCOUNT_MISSING");

        if (!direct_items || direct_items.length === 0) {
            throw new AppError("No SIP items provided", 400, "CART_EMPTY");
        }

        const sip_items = direct_items;

        const { start_date, end_date } = this.helper.extract_date_range_from_sip_items(sip_items);

        let max_incoming_end_date = this.helper.parseDate(start_date) || new Date();
        const incoming_installments = this.helper.calculate_installments_count(sip_items, start_date, end_date);

        logger.debug(`Max incoming end date ==> `, max_incoming_end_date)
        logger.debug(`Incomming Installments ==> `, incoming_installments)

        sip_items.forEach((item: any, index: number) => {
            const raw_installments = incoming_installments[index] || 1;
            logger.debug(`Raw installments --> `, raw_installments)

            const installments = Math.min(raw_installments, 478); // Cap to 478 months (~39.8 years) to fit safely within a 40-year mandate
            const item_start = this.helper.parseDate(item.start_date || start_date) || new Date();

            logger.debug(`Item start --> `, item_start)
            const item_end = new Date(item_start);
            item_end.setMonth(item_end.getMonth() + installments);

            logger.debug(`Item end --> `, item_end)
            if (item_end > max_incoming_end_date) {
                max_incoming_end_date = item_end;
            }
        });
        logger.debug(`Finall Max incoming end date ==> `, max_incoming_end_date)
        const active_mandates = await db.mandate.findMany({
            where: {
                user_id,
                status: "SUCCESS"
            },
            orderBy: {
                createdAt: "desc"
            }
        });

        logger.debug(`User active mandates --> `, active_mandates)

        const activeSipsReport = await mutual_fund_finnsys_service.get_xsip_registration_report({
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                client_code: user.nse_client_code
            }
        });
        const activeSips = activeSipsReport?.code === 1 ? (activeSipsReport.data?.report_data || []) : [];

        let total_required = 0;


        sip_items.forEach((item: any, index: number) => {
            const installment_amount = Number(item.sip_amt);
            const step_up_amount = item.step_up_required === "Y" ? Number(item.step_up_amount || 0) : 0;
            const years = Math.floor((incoming_installments[index] || 1) / 12);

            total_required += installment_amount;
            if (step_up_amount > 0 && years > 0) {
                total_required += (step_up_amount * years);
            }
        });

        activeSips.forEach((sip: any) => {
            if (sip.status === "ACTIVE" || sip.status === "REGISTERED") {
                logger.debug(`Active sip --> ${sip.installments_amount}`)
                total_required += Number(sip.installments_amount || 0);
            }
        });

        let usable_mandate = null;
        for (const mandate of active_mandates) {
            const active_limit = Number(mandate.amount);
            const mandate_end_date = mandate.end_date ? new Date(mandate.end_date) : null;

            logger.debug(`Mandate Details => Limit: ${active_limit}, End Date: ${mandate_end_date}, Required: ${total_required}, Max Incoming End Date: ${max_incoming_end_date} for Mandate id --> ${mandate.id}`)
            if (active_limit >= total_required && mandate_end_date && mandate_end_date >= max_incoming_end_date) {
                usable_mandate = mandate;
                break;
            }
        }

        if (usable_mandate) {
            logger.info(`Reusing existing approved mandate ${usable_mandate.mandate_id} for User ${user_id}. Limit: ${usable_mandate.amount}, Required: ${total_required}`);
            return {
                mandate_id: usable_mandate.mandate_id,
                status: "MANDATE_APPROVED"
            };
        }

        const primary_bank = this.helper.get_primary_bank_details(user);

        let new_mandate_amount = 200000;
        if (total_required > 200000) new_mandate_amount = 500000;
        if (total_required > 500000) new_mandate_amount = 1000000;
        if (total_required > 1000000) {
            new_mandate_amount = Math.ceil(total_required / 500000) * 500000;
        }

        logger.info(`Creating NEW Mandate for User ${user_id}. New Limit: ${new_mandate_amount}, Required: ${total_required}`);

        const mandate_payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                reg_data: [
                    {
                        client_code: user.nse_client_code,
                        amount: new_mandate_amount.toString(),
                        mandate_type: "E" as const,
                        account_no: primary_bank.account_no,
                        ac_type: primary_bank.ac_type || "SB",
                        ifsc_code: primary_bank.ifsc_code,
                        micr_code: primary_bank.micr_code || "",
                        start_date,
                        end_date: this.helper.calculate_mandate_end_date(start_date, 40),
                        member_mandate_no: ""
                    }
                ]
            }
        };

        const mandate_response = await mutual_fund_finnsys_service.create_mandate_registration(mandate_payload);

        const mandate_id = mandate_response.data.reg_data[0]?.reg_id;

        if (!mandate_id) {
            logger.error("Mandate response missing mandate_id: ", mandate_response);
            throw new AppError("Failed to process mandate request, please try again", 500, "MANDATE_ID_MISSING");
        }

        logger.info(`SIP Mandate created successfully. Mandate ID: ${mandate_id}`);

        await db.mandate.create({
            data: {
                user_id,
                mandate_id,
                amount: new_mandate_amount,
                status: "PENDING",
                bank_account: primary_bank.account_no,
                start_date: this.helper.parseDate(start_date) || new Date(),
                end_date: this.helper.parseDate(this.helper.calculate_mandate_end_date(start_date, 40)) || new Date()
            }
        });

        return {
            mandate_id,
            status: "MANDATE_PENDING_APPROVAL"
        };
    }

    execute_xsip_purchase = async (user_id: string, user_log: string, user_pwd: string, mandate_id?: string, direct_items?: Sip_purchase_item[]) => {
        const user = await user_service.get_all_user_data(user_id, { user_bank_details: true });
        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
        if (!user.nse_client_code) throw new AppError("Trading account not set up", 400, "TRADING_ACCOUNT_MISSING");

        let selected_mandate_id = mandate_id;
        if (!selected_mandate_id) {
            const active_mandate = await db.mandate.findFirst({
                where: {
                    user_id,
                    status: "SUCCESS"
                },
                orderBy: {
                    createdAt: "desc"
                }
            });
            if (!active_mandate) {
                throw new AppError("No approved mandate found. Please register and approve a mandate first.", 400, "MANDATE_MISSING");
            }
            selected_mandate_id = active_mandate.mandate_id;
        }

        let sip_items: any[];
        if (direct_items && direct_items.length > 0) {
            sip_items = direct_items;

            const active_mandate = await db.mandate.findUnique({
                where: {
                    mandate_id: selected_mandate_id
                }
            });
            const limitAmount = active_mandate ? Number(active_mandate.amount) : 200000;

            const activeSipsReport = await mutual_fund_finnsys_service.get_xsip_registration_report({
                arn: env.ARN,
                username: user_log,
                password: user_pwd,
                data: {
                    client_code: user.nse_client_code
                }
            });
            const activeSips = activeSipsReport?.code === 1 ? (activeSipsReport.data?.report_data || []) : [];
            this.validate_cumulative_sip_limit(sip_items, activeSips, limitAmount);
        } else {
            const cart_res = await user_service.get_user_cart_finnsys(user_log, user_pwd);
            if (cart_res.code != 1) {
                throw new AppError("Failed to fetch cart from Finnsys", 502, "CART_FETCH_FAILED");
            }

            sip_items = cart_res.results.filter((item: any) => item.sub_txn_type === "S");

            if (sip_items.length === 0) {
                throw new AppError("No SIP items found in cart", 400, "CART_EMPTY");
            }
        }

        const { start_date, end_date } = this.helper.extract_date_range_from_sip_items(sip_items);
        const installment_counts = this.helper.calculate_installments_count(sip_items, start_date, end_date);

        const primary_bank = this.helper.get_primary_bank_details(user);

        const reg_data = await Promise.all(
            sip_items.map(async (item: any, index: number) => ({
                amc_code: item.amc_code || "",
                sch_code: item.prod_code || "",
                client_code: user.nse_client_code,
                bank_ref_no: primary_bank.account_no || "",
                trans_mode: "P",
                dp_txn_mode: "P",
                start_date,
                frequency_type: this.helper.map_frequency_code_to_type(item.sip_freq),
                frequency_allowed: "1",
                installment_amount: (item.sip_amt || item.txn_amount).toString(),
                status: "1",
                member_code: env.NSE_MEMBER_ID,
                folio_no: item.folio || "",
                sip_remarks: "VELVET INVEST APP",
                installment_no: Math.min(installment_counts[index] || 1, 478),
                xsip_mandate_id: selected_mandate_id,
                sub_broker_code: "",
                euin_number: env.EUIN || "",
                euin_declaration: "Y",
                dpc_flag: "Y",
                first_order_today: "N",
                sub_broker_arn: "",
                end_date: "",
                primary_holder_mobile: user.phone_no || "",
                primary_holder_email: user.email || "",
                step_up_required: item.step_up_required || "N",
                step_up_start_date: item.step_up_start_date || "",
                step_up_end_date: item.step_up_end_date || "",
                step_up_frequency: item.step_up_required === "Y" ? "Annual" : "",
                step_up_amount: item.step_up_amount || "",
                filler_1: "",
                filler_2: "",
                filler_3: "",
                filler_4: "",
                filler_5: ""
            }))
        );

        const xsip_payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                reg_data
            }
        };

        logger.info(`Creating xSIP orders for User ${user_id}. Mandate ID: ${selected_mandate_id}, Items: ${sip_items.length}`);

        const xsip_response = await mutual_fund_finnsys_service.create_xsip_purchase(xsip_payload);

        const order_id = xsip_response.data?.reg_data?.[0]?.reg_id || xsip_response.data?.orderId;

        if (!order_id) {
            logger.error("xSIP response missing order ID: ", xsip_response);
            throw new AppError("xSIP created but order ID not found in response", 500, "XSIP_ORDER_ID_MISSING");
        }

        logger.info(`xSIP orders created successfully. Order ID: ${order_id}`);
        
        if (user.nse_client_code) {
            const cache_key = `mf_xsip:finnsys:${user.nse_client_code}`;
            await redis_buffer_client.del(cache_key);
            logger.debug(`Invalidated xSIP cache for user: ${user.nse_client_code}`);
        }

        const xsip_url_res = await nse_service.get_short_url('XSIP_REG', order_id, user_log, user_pwd);
        logger.debug("xSIP short URL response ==> ", xsip_url_res);

        return {
            xsip_short_url: xsip_url_res.data?.firstHolderLink || "",
            order_id
        };
    }

    check_mandate_status = async (mandate_id: string, user_log: string, user_pwd: string, user_id: string) => {
        const user = await user_service.get_user_by_id(user_id);

        const mandate_status_payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                mandate_id: mandate_id,
                client_code: user.nse_client_code
            }
        };

        logger.info(`Checking mandate status for User ${user_id}, Mandate ID: ${mandate_id}`);

        const mandate_status_res = await mutual_fund_finnsys_service.check_mandate_status(mandate_status_payload);

        logger.info(`Mandate status response for User ${user_id}, Mandate ID: ${mandate_id} ==> `, mandate_status_res);

        const enachStatus = mandate_status_res.data?.report_data?.[0]?.enachStatus;
        const umrnNo = mandate_status_res.data?.report_data?.[0]?.umrnNo;

        if (enachStatus) {
            let dbStatus = "PENDING";
            if (enachStatus === "SUCCESS" || enachStatus === "APPROVED") {
                dbStatus = "SUCCESS";
            } else if (enachStatus === "FAILED" || enachStatus === "REJECTED" || enachStatus === "REJECT") {
                dbStatus = "FAILED";
            }

            const existingMandate = await db.mandate.findUnique({
                where: { mandate_id: mandate_id }
            });

            if (existingMandate) {
                await db.mandate.update({
                    where: { mandate_id: mandate_id },
                    data: {
                        status: dbStatus as any,
                        umrn: umrnNo || null
                    }
                });
            }
        }

        return mandate_status_res;
    }

    cancel_xsip = async (user_id: string, user_log: string, user_pwd: string, xsip_reg_no: string) => {
        const user = await user_service.get_user_by_id(user_id);
        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
        if (!user.nse_client_code) throw new AppError("Trading account not set up (Client Code missing)", 400, "TRADING_ACCOUNT_MISSING");

        const payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                can_data: [
                    {
                        client_code: user.nse_client_code,
                        xsip_reg_no,
                        remarks: "13:Velvet Invest App: xSIP Cancelled"
                    }
                ]
            }
        };

        logger.info(`Executing xSIP Cancellation for User ${user_id}. xSIP Reg No: ${xsip_reg_no}`);

        const finnsys_response = await mutual_fund_finnsys_service.cancel_xsip_finnsys(payload);

        if (user.nse_client_code) {
            const cache_key = `mf_xsip:finnsys:${user.nse_client_code}`;
            await redis_buffer_client.del(cache_key);
            logger.debug(`Invalidated xSIP cache for user: ${user.nse_client_code} after cancellation`);
        }

        return finnsys_response;
    }
}
