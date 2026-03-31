import axios from "axios";
import { UserWithAllData } from "../lib/types.js";
import {
    FdTransactionOrderByWithRelationInput,
    FdTransactionWhereInput,
    UserCreateInput
} from "../prisma/generated/prisma/models.js";
import { db } from "../server.js";
import { env } from "../lib/config-env.js";
import { user_finance_service } from "./onboarding/user.finance.service.js";
import { user_assets_service } from "./onboarding/user.assets.service.js";
import { user_insurance_service } from "./onboarding/user.insurance.service.js";
import { user_loan_service } from "./onboarding/user.loan.service.js";
import { user_goal_service } from "./onboarding/user.goal.service.js";
import { pagination } from "./mutual-fund.service.js";


type GetUserFdDataInput = {
    pagination?: pagination;
    user_id: string;
    order?: FdTransactionOrderByWithRelationInput | FdTransactionOrderByWithRelationInput[];
    query?: FdTransactionWhereInput;
}

type GetAllUserDataOptions = {
    user_finance?: boolean;
    user_assets?: boolean;
    user_insurance?: boolean;
    user_loan?: boolean;
    user_goals?: boolean;
    user_bank_details?: boolean;
    kyc_types?: boolean;
    mfKycIdentities?: boolean;
}



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
        return await db.user.upsert({
            where: {
                id: user_id
            },
            update: {
                ...data
            },
            create: {
                ...data
            }
        });
    }

    async get_user_by_phone(phone_no: string) {
        return await db.user.findUnique({
            where: { phone_no: phone_no },
            include: {
                user_bank_details: {
                    orderBy: [
                        { is_primary: 'desc' },
                        { updatedAt: 'desc' }
                    ]
                },
                mfKycIdentities: true,
            }
        });
    }

    get_user_by_refresh_token(refresh_token: string) {
        return db.user.findFirst({
            where: {
                refresh_token: refresh_token
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


    async get_all_user_data(user_id: string, options?: GetAllUserDataOptions): Promise<UserWithAllData | null> {
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
                user_bank_details: options?.user_bank_details ?? false,
                kyc_types: options?.kyc_types ? {
                    select: {
                        kyc_type: true,
                        status: true,
                    }
                } : false,
                mfKycIdentities: options?.mfKycIdentities ?? false,
            }
        });
    }

    async discard_user_onboarding(user_id: string) {
        await db.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: user_id },
                data: {
                    full_name: null,
                    city: null,
                    dob: null,
                    email: null,
                    meta_data: {
                        onboarding_stage: 0,
                        is_onboarding_completed: false,
                    },
                },
            });

            await user_finance_service.delete(user_id, tx);
            await user_assets_service.delete(user_id, tx);
            await user_insurance_service.delete(user_id, tx);
            await user_loan_service.delete_all_loans(user_id, tx);
            await user_goal_service.delete_all_goals(user_id, tx);
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


    async get_user_fd_data({ pagination, user_id, order, query }: GetUserFdDataInput) {
        // const { page, limit } = pagination;
        const page = pagination?.page ?? 1;
        const limit = pagination?.limit ?? 50;
        const offset = (page - 1) * limit;

        const where: FdTransactionWhereInput = {
            ...(query ?? {}),
            user_id,
        };

        const [total, fd_transactions] = await Promise.all([
            db.fdTransaction.count({ where }),
            db.fdTransaction.findMany({
                where,
                select: {
                    id: true,
                    amount: true,
                    roi_at_booking: true,
                    tenure_at_booking: true,
                    fd_issued_at: true,
                    status: true,
                    maturity_amount: true,
                    user: {
                        select: {
                            id: true,
                            full_name: true,
                            email: true,
                        }
                    },
                    product: {
                        select: {
                            issuer: {
                                select: {
                                    logo_url: true,
                                    display_name: true,
                                }
                            }
                        }
                    }
                },
                skip: offset,
                take: limit,
                orderBy: order ?? { fd_issued_at: 'desc' }
            })
        ]);

        return {
            fd_transactions,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            }
        };
    }



    async get_user_fd_transaction_by_id({ user_id, transaction_id }: { user_id: string, transaction_id: string }) {
        return await db.fdTransaction.findFirst({
            where: {
                id: transaction_id,
                user_id: user_id,
            },
            include: {
                product: {
                    include: {
                        issuer: true
                    }
                }
            }
        });
    }
}

export const user_service = new UserServiceClass();