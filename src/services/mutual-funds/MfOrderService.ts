import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";
import { generate_unique_code } from "../../helpers/unique.code.js";
import { env } from "../../lib/config-env.js";
import { Redeem_request_data } from "../../lib/types.js";
import { user_service } from "../user.service.js";
import { mutual_fund_finnsys_service } from "../finnsys/mf.finnsys.service.js";
import { nse_service } from "../nse.service.js";
import { MfHelperService } from "./MfHelperService.js";
import { MfQueryService } from "./MfQueryService.js";

export class MfOrderService {

    constructor(
        private helper: MfHelperService,
        private queryService: MfQueryService
    ) {}

    private async construct_transaction_payload(cart_items: any[], user: any) {
        const primary_bank = this.helper.get_primary_bank_details(user);

        return Promise.all(cart_items.map(async (item: any) => {
            return {
                order_ref_number: await generate_unique_code("ORD"),
                scheme_code: item.prod_code,
                trxn_type: "P",
                buy_sell_type: item.folio ? "ADDITIONAL" : "FRESH",
                client_code: user.nse_client_code,
                demat_physical: "P",
                order_amount: item.txn_amount || item.sip_amt,
                folio_no: item.folio || "",
                remarks: "Velvet Invest App",
                kyc_flag: "Y",
                sub_broker_code: "",
                euin_number: env.EUIN,
                euin_declaration: "Y",
                min_redemption_flag: "N",
                dpc_flag: "Y",
                all_units: "N",
                redemption_units: "",
                sub_broker_arn: "",
                bank_ref_no: "",
                account_no: primary_bank.account_no,
                mobile_no: user.phone_no,
                email: user.email,
                mandate_id: "",

                ...(item.sip_freq ? {
                    sip_st_date: item.sip_st_date,
                    sip_en_date: item.sip_en_date,
                    sip_freq: item.sip_freq,
                    sip_day: item.sip_day,
                    sip_amt: item.sip_amt
                } : {})
            };
        }));
    }

    execute_lumpsum_purchase = async (user_id: string, user_log: string, user_pwd: string, direct_items?: any[]) => {
        const user = await user_service.get_all_user_data(user_id, { user_bank_details: true });
        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
        if (!user.nse_client_code) throw new AppError("Trading account not set up (Client Code missing)", 400, "TRADING_ACCOUNT_MISSING");

        let lumpsum_items: any[];
        if (direct_items && direct_items.length > 0) {
            lumpsum_items = direct_items;
        } else {
            const cart_res = await user_service.get_user_cart_finnsys(user_log, user_pwd);
            if (cart_res.code != 1) {
                throw new AppError("Failed to fetch cart from Finnsys", 502, "CART_FETCH_FAILED");
            }

            lumpsum_items = cart_res.results.filter((item: any) => item.sub_txn_type === "N");

            if (lumpsum_items.length === 0) {
                throw new AppError("No lumpsum items found in cart", 400, "CART_EMPTY");
            }
        }

        const transaction_details = await this.construct_transaction_payload(lumpsum_items, user);

        const payload = {
            arn: env.ARN,
            username: user_log,
            password: user_pwd,
            data: {
                transaction_details
            }
        };

        logger.info(`Executing Lumpsum Purchase for User ${user_id}. Payload ==> `, payload);

        const finnsys_response = await mutual_fund_finnsys_service.purchase_finnsys(payload);
        const short_url = await nse_service.get_short_url("PUR", finnsys_response.data.transaction_details[0].trxn_order_id, user_log, user_pwd);

        if (short_url.code != 1) {
            logger.warn("Failed to generate short URL for lumpsum purchase. Response from NSE ==> ", short_url);
            throw new AppError("Lumpsum purchase initiated but failed to generate short URL, Check your registered mail for order confirmation", 500, "SHORT_URL_ERROR");
        }

        return short_url.data.firstHolderLink;
    }

    private async construct_redeem_payload(prod_code: string, folio_no: string, user: any, redem_data: Redeem_request_data) {
        const primary_bank = this.helper.get_primary_bank_details(user);
        const is_full = redem_data.redem_type === "FULL";

        return {
            order_ref_number: await generate_unique_code("RDM"),
            scheme_code: prod_code,
            trxn_type: "R",
            buy_sell_type: "FRESH",
            client_code: user.nse_client_code,
            demat_physical: "P",
            order_amount: is_full ? "" : (redem_data.redemption_amount ? String(redem_data.redemption_amount) : ""),
            folio_no: folio_no,
            remarks: "Velvet Invest App : Redeem reward",
            kyc_flag: "Y",
            sub_broker_code: "",
            euin_number: env.EUIN,
            euin_declaration: "Y",
            min_redemption_flag: "N",
            dpc_flag: "Y",
            all_units: is_full ? "Y" : "N",
            redemption_units: is_full ? "" : (redem_data.redemption_units ? String(redem_data.redemption_units) : ""),
            sub_broker_arn: "",
            bank_ref_no: "",
            account_no: primary_bank.account_no,
            mobile_no: user.phone_no,
            email: user.email,
            mandate_id: "",
        };
    }

    execute_redemption = async (user_id: string, redem_data: Redeem_request_data, user_log: string, user_pwd: string) => {
        const user = await user_service.get_all_user_data(user_id, { user_bank_details: true });
        if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");

        let prod_code: string;

        if (redem_data.source === "transaction") {
            const mf_product = await this.queryService.get_mutual_fund_by_scheme_id(String(redem_data.scheme_id));
            if (!mf_product) throw new AppError("Scheme not found for given scheme_id", 404, "SCHEME_NOT_FOUND");

            const mf_detail = await this.queryService.get_only_mf_product(mf_product.id);
            if (!mf_detail?.platform_code) throw new AppError("Scheme platform code not configured", 500, "PLATFORM_CODE_MISSING");

            prod_code = mf_detail.nse_scheme_code as string;
        } else {
            prod_code = redem_data.prod_code;
        }

        const transaction_detail = await this.construct_redeem_payload(
            prod_code,
            redem_data.folio_no,
            user,
            redem_data
        );

        const payload = {
            arn: env.ARN,
            username: user.usr,
            password: user_pwd,
            data: { transaction_details: [transaction_detail] }
        };
        logger.info(`Executing Redemption for User ${user_id}. Source: ${redem_data.source}. Payload: ${JSON.stringify(payload)}`);

        const finnsys_response = await mutual_fund_finnsys_service.redeem_finnsys(payload);

        const short_url = await nse_service.get_short_url(
            "RED",
            finnsys_response.data.transaction_details[0].trxn_order_id,
            user_log, user_pwd
        );

        if (short_url.code != 1) {
            logger.warn("Failed to generate short URL for redemption ===> ", short_url);
            throw new AppError(
                "Redemption initiated but failed to generate short URL, check your registered mail for confirmation",
                500,
                "SHORT_URL_ERROR"
            );
        }

        return short_url.data.firstHolderLink;
    }
}
