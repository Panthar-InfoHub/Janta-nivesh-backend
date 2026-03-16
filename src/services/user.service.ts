import axios from "axios";
import { UserWithAllData } from "../lib/types.js";
import { UserCreateInput, UserInclude } from "../prisma/generated/prisma/models.js";
import { db } from "../server.js";
import { env } from "../lib/config-env.js";



class UserServiceClass {

    private finnsys_base_url: string;

    constructor() {
        this.finnsys_base_url = `${env.finsys_base_api}`;
    }

    async create_user(data: UserCreateInput) {

        return await db.user.upsert({
            where: {
                phone_no: data.phone_no ?? "",
            },
            update: {
                ...data
            },
            create: {
                ...data
            }
        });
    }

    async update_user(user_id: string, data: Partial<UserCreateInput>) {
        return await db.user.update({
            where: {
                id: user_id
            },
            data: {
                ...data
            }
        });
    }

    async get_user_by_phone(phone_no: string) {
        return await db.user.findUnique({
            where: {
                phone_no: phone_no
            }
        });
    }

    async get_user_by_invId(inv_id: number) {
        return await db.user.findUnique({
            where: {
                inv_id: inv_id
            }
        });
    }

    async get_user_by_id(user_id: string) {
        return await db.user.findUnique({
            where: {
                id: user_id
            }
        });
    }


    async get_user_by_usr(usr: string) {
        return await db.user.findUnique({
            where: {
                usr: usr
            }
        });
    }


    async delete_user(user_id: string) {
        return await db.user.delete({
            where: {
                id: user_id
            }
        });
    }


    async get_all_user_data(user_id: string, options?: Partial<Record<keyof UserInclude, boolean>>): Promise<UserWithAllData | null> {
        return await db.user.findUnique({
            where: {
                id: user_id
            },
            include: {
                user_finance: options?.user_finance ?? false,
                user_assets: options?.user_assets ?? false,
                user_insurance: options?.user_insurance ?? false,
                user_loan: options?.user_loan ?? false,
                user_goals: options?.user_goals ?? false,
            }
        });
    }


    async get_user_cart_finnsys(user_log: string, user_pwd: string) {
        const response = await axios.get(`${this.finnsys_base_url}/finnsys/app/master.service.asp`, {
            params: {
                log: user_log,
                pwd: user_pwd,
                svc: "getcart"
            }
        })
        return response.data;
    }
}

export const user_service = new UserServiceClass();