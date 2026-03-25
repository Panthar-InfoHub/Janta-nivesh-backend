import axios from "axios";
import { env } from "../lib/config-env.js";
import logger from "../middleware/logger.js";


type UserFinnsysDetails = {
    invname?: string;
    invemail?: string;
    invdob?: string;
    invpan?: string;
    invmobile?: string;
    add1?: string;
    add2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    gender?: "M" | "F";
    aadhaar?: string;
    income?: number;
}

class UserFinnsysServiceClass {

    private finnsys_base_url: string;

    constructor() {
        this.finnsys_base_url = `${env.finsys_base_api}`;
    }


    get_user_iin_finnsys = async (user_log: string, user_pwd: string) => {
        try {
            const res = await axios.get(`${this.finnsys_base_url}/finnsys/app/master.service.asp`, {
                params: {
                    log: user_log,
                    pwd: user_pwd,
                    svc: "gettxngw",
                }
            });
            return res.data;

        } catch (error) {
            logger.error(`Error fetching user cart from Finnsys ==> `, error)
            throw error;
        }
    }


    update_user_finnsys_details = async (user_log: string, user_pwd: string, data: UserFinnsysDetails) => {
        logger.debug("Updating user finnsys details with data ==> ", data);
        try {
            const res = await axios.post(`${this.finnsys_base_url}/finnsys/app/master.service.asp`, null, {
                params: {
                    log: user_log,
                    pwd: user_pwd,
                    svc: "updateinvestor",
                    ...data
                }
            });
            return res.data;
        } catch (error) {
            logger.error(`Error updating user finnsys details ==> `, error)
            throw error;
        }
    }



    delete_user_finnsys_goal = async (user_log: string, user_pwd: string, goal_id: number) => {
        logger.debug(`Deleting user finnsys goal with goal_id ${goal_id}`);
        try {
            const res = await axios.post(`${this.finnsys_base_url}/finnsys/app/master.service.asp`, null, {
                params: {
                    log: user_log,
                    pwd: user_pwd,
                    svc: "deletegoal",
                    tojson: 1,
                    deletegoal: 1,
                    gid: goal_id,
                }
            });
            return res.data;
        } catch (error) {
            logger.error(`Error deleting user finnsys goal with goal_type_id ${goal_id} ==> `, error)
            throw error;
        }

    }
}

export const user_finnsys_service = new UserFinnsysServiceClass();