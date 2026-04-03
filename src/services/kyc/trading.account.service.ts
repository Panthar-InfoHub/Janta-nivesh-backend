import axios from "axios";
import logger from "../../middleware/logger.js";
import { NSEServiceClass } from "../nse.service.js";
import { user_finance_service } from "../onboarding/user.finance.service.js";
import { env } from "../../lib/config-env.js";

class TradingAccountServiceClass extends NSEServiceClass {

    constructor() {
        super();
    }


    // Implement trading account related methods here
    client_registration = async (user_id: string, data: any, username: string, pwd: string) => {

        const response = await axios.post(`${this.finnsys_base_url}/nse/v2/registration/client-registration`, {
            arn: env.ARN,
            username: username,
            password: pwd,
            data: {
                reg_details: [data]
            }
        }, {
            headers: {
                "Content-Type": "application/json"
            }
        });

        logger.debug("Client registration response from NSE API ==> ", response.data.code);


        if (response.data.code != 1) {
            logger.warn("Client registration failed with NSE API. Response ==> ", response.data);
            throw new Error("Client registration failed with NSE API, Reason : " + response.data.data.reg_details[0].reg_remark);
        }

        logger.debug("Proceeding with FATCA registration...");
        // Call fatca registration API
        const fatca_data = await this.extract_fatca_data(user_id, data);
        const fatca_res = await axios.post(`${this.finnsys_base_url}/nse/v2/registration/fatca-registration`, {
            arn: env.ARN,
            username: username,
            password: pwd,
            data: {
                reg_details: [fatca_data]
            }
        }, {
            headers: {
                // ...headers,
                "Content-Type": "application/json"
            }
        });

        logger.debug("FATCA registration response from NSE API ==> ", fatca_res.data);

        if (fatca_res.data.code != 1) {
            logger.warn("FATCA registration failed with NSE API. Response ==> ", fatca_res.data);
            throw new Error("FATCA registration failed with NSE API, Reason : " + fatca_res.data.data.reg_details[0].reg_remark);
        }

        return response.data;
    }





    private async extract_fatca_data(user_id: string, user_input: any) {
        const income_slab = await user_finance_service.get_income_slab_code(user_id);
        const full_name = [
            user_input.primary_holder_first_name,
            user_input.primary_holder_middle_name,
            user_input.primary_holder_last_name
        ]
            .filter(Boolean)
            .join(" ");


        return {
            // --- 1. PREFILLED DATA (Mapped from input) ---
            pan_rp: user_input.primary_holder_pan || "",
            inv_name: full_name || "",
            dob: user_input.primary_holder_dob_incorporation || "",
            co_bir_inc: user_input.co_bir_inc || "IN",
            tpin1: user_input.primary_holder_pan || "",
            log_name: full_name,

            // --- 2. USER INPUTS (Requested from UI) ---
            addr_type: user_input.addr_type || "1",
            po_bir_inc: user_input.po_bir_inc || "", // Place of birth for individual clients, country of incorporation for non-individual clients
            srce_wealt: user_input.srce_wealt || "", // 01 : Salary | 02 : Business Income | 03 : Gift | 04 : Ancestral Property | 05 : Rental Income | 06 : Prize Money | 07 : Royalty | 08 : Other
            inc_slab: income_slab, // Auto-calculated from user_finance
            occ_code: user_input.occupation_code || "", // store from user kyc process | TODO : user model should have occupation code field to store this data | Don't ask user
            occ_type: user_input.occ_type || "", // S - Service; B - Business, O - Others; X - Not Categorized
            pep_flag: user_input.pep_flag || "N",

            // --- 3. SYSTEM CONSTANTS (Do not change) ---
            tax_status: user_input.tax_status || "01",
            data_src: "E",
            id1_type: "C",
            tax_res1: "IN",
            exch_name: "O",
            ubo_appl: "N",
            ubo_df: "N",

            // --- 4. OPTIONAL/EMPTY FIELDS (Keep structural integrity) ---
            pekrn: user_input.pekrn || "",
            fr_name: user_input.fr_name || "",
            sp_name: user_input.sp_name || "",
            tax_res2: "", tpin2: "", id2_type: "",
            tax_res3: "", tpin3: "", id3_type: "",
            tax_res4: "", tpin4: "", id4_type: "",
            corp_servs: "", net_worth: "", nw_date: "",
            exemp_code: "", ffi_drnfe: "", giin_no: "",
            spr_entity: "", giin_na: "", giin_exemc: "",
            nffe_catg: "", act_nfe_sc: "", nature_bus: "",
            rel_listed: "", ubo_count: "", ubo_name: "",
            ubo_pan: "", ubo_nation: "", ubo_add1: "",
            ubo_add2: "", ubo_add3: "", ubo_city: "",
            ubo_pin: "", ubo_state: "", ubo_cntry: "",
            ubo_add_ty: "", ubo_ctr: "", ubo_tin: "",
            ubo_id_ty: "", ubo_cob: "", ubo_dob: "",
            ubo_gender: "", ubo_fr_nam: "", ubo_occ: "",
            ubo_occ_ty: "", ubo_tel: "", ubo_mobile: "",
            ubo_code: "", ubo_hol_pc: "", sdf_flag: "",
            aadhaar_rp: "", new_change: "", filler1: "", filler2: ""
        };
    }
}

export const trading_account_service = new TradingAccountServiceClass();