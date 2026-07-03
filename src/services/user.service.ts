import axios from "axios";
import { UserFireReportData, UserWithAllData } from "../lib/types.js";
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
import { hash_mpin, compare_mpin } from "../lib/utils.js";
import { generate_JWT } from "../middleware/jwt.js";


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

    async patch_user(user_id: string, data: any) {
        if (data.mpin) {
            data.mpin = await hash_mpin(data.mpin);
        }
        const updated_user = await db.user.update({
            where: { id: user_id },
            data: { ...data },
        });
        delete updated_user.pwd;
        delete updated_user.mpin;
        return updated_user;
    }

    async verify_mpin(user_id: string, mpin: string): Promise<{ is_verified: boolean; token: string; refresh_token: string; }> {
        const user = await db.user.findUnique({
            where: { id: user_id },
        });

        if (!user || !user.mpin) return {
            is_verified: false,
            token: "",
            refresh_token: ""
        };

        const refresh_token = generate_JWT(user, "30d");

        const updated_user = await user_service.update_user(user_id, {
            refresh_token: refresh_token
        });
        const token = generate_JWT(updated_user);



        return {
            is_verified: await compare_mpin(mpin, user.mpin),
            token: token,
            refresh_token: refresh_token
        }
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


    async get_user_fire_report_data(user_id: string): Promise<UserFireReportData | null> {
        return await db.user.findUnique({
            where: { id: user_id },
            include: {
                user_finance: true,
                user_assets: {
                    select: {
                        id: true,
                        user_id: true,
                        mutual_funds: true,
                        stocks: true,
                        fd: true,
                        gold: true,
                        cash_saving: true,
                    }
                },
                user_insurance: true,
                user_loan: true,
                user_goals: true,
            }
        });
    }


    async get_all_user_data(user_id: string, options?: GetAllUserDataOptions): Promise<UserWithAllData | null> {
        const user = await db.user.findUnique({
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

        delete user?.pwd;
        delete user?.mpin;
        return user
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

            await user_finance_service.delete(user_id, tx as any);
            await user_assets_service.delete(user_id, tx as any);
            await user_insurance_service.delete(user_id, tx as any);
            await user_loan_service.delete_all_loans(user_id, tx as any);
            await user_goal_service.delete_all_goals(user_id, tx as any);
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
            status: { in: ["PAYMENT_SUCCESS", "VKYC_COMPLETED", "FD_CREATED", "MATURED", "PREMATURE_WITHDRAWN"] }
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
                    maturity_date: true,
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
            select: {
                id: true,
                user_id: true,
                payment_completed_at: true,
                is_vkyc_pending: true,
                amount: true,
                roi_at_booking: true,
                tenure_at_booking: true,
                payout_frequency: true,
                status: true,
                maturity_amount: true,
                maturity_date: true,
                maturity_instruction: true,
                payment_tx_id: true,
                fd_account_number: true,
                onboarded_at: true,
                vkyc_completed_at: true,
                fd_issued_at: true,
                refund_date: true,
                vkyc_failure_reason: true,
                failure_reason: true,
                createdAt: true,
                updatedAt: true,
                product: {
                    select: {
                        id: true,
                        issuer_id: true,
                        issuer: {
                            select: {
                                id: true,
                                full_name: true,
                                display_name: true,
                                issuer_type: true,
                                logo_url: true,
                                banner_url: true,
                                rating_text: true
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Aggregates portfolio data from MF and FD investments
     * Calculates total values, returns, and allocation percentages
     */
    aggregate_portfolio_data = (mf_investment_data: any, fd_transactions: any[] = []) => {
        const mf_current_value = mf_investment_data?.current_value || 0;
        const mf_invested_amount = mf_investment_data?.invested_amount || 0;
        const mf_total_returns = mf_investment_data?.total_returns || 0;
        const mf_return_percent = mf_investment_data?.return_percent || 0;

        // Calculate FD aggregates
        const fd_aggregates = fd_transactions.reduce(
            (acc: any, fd: any) => {
                const fd_amount = Number(fd.amount) || 0;
                const fd_maturity = Number(fd.maturity_amount) || 0;
                const fd_returns = fd_maturity - fd_amount;

                acc.invested_amount += fd_amount;
                acc.current_value += fd_maturity;
                acc.total_returns += fd_returns;
                acc.count += 1;
                return acc;
            },
            {
                invested_amount: 0,
                current_value: 0,
                total_returns: 0,
                count: 0,
            }
        );

        // Calculate totals
        const total_invested = mf_invested_amount + fd_aggregates.invested_amount;
        const total_current_value = mf_current_value + fd_aggregates.current_value;
        const total_returns = mf_total_returns + fd_aggregates.total_returns;
        const total_items_count = (mf_investment_data?.items_count || 0) + fd_aggregates.count;

        // Calculate allocation percentages (avoid division by zero)
        const mf_allocation_percent =
            total_current_value > 0
                ? Number(((mf_current_value / total_current_value) * 100).toFixed(2))
                : 0;

        const fd_allocation_percent =
            total_current_value > 0
                ? Number(((fd_aggregates.current_value / total_current_value) * 100).toFixed(2))
                : 0;

        const total_return_percent =
            total_invested > 0
                ? Number(((total_returns / total_invested) * 100).toFixed(2))
                : 0;

        return {
            total_investments: {
                current_value: Number(total_current_value.toFixed(2)),
                total_returns: Number(total_returns.toFixed(2)),
                return_percent: total_return_percent,
                allocation: {
                    mutual_funds: {
                        value: Number(mf_current_value.toFixed(2)),
                        percent: mf_allocation_percent,
                    },
                    fixed_deposits: {
                        value: Number(fd_aggregates.current_value.toFixed(2)),
                        percent: fd_allocation_percent,
                    },
                },
            },
            invested_amount_breakdown: {
                invested_amount: Number(total_invested.toFixed(2)),
                invested_items_count: total_items_count,
                returns_amount: Number(total_returns.toFixed(2)),
                returns_percent: total_return_percent,
            },
        };
    };
}

export const user_service = new UserServiceClass();