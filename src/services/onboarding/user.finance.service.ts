import { db } from "../../server.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";

type TxClient = Prisma.TransactionClient;

class UserFinanceServiceClass {
    async create(user_id: string, data: any, tx: TxClient | typeof db = db) {
        return await tx.userFinance.upsert({
            where: { user_id: user_id },
            update: { ...data },
            create: {
                user_id: user_id,
                ...data,
            },
        });
    }

    async update(user_id: string, data: any) {
        return await db.userFinance.update({
            where: { user_id: user_id },
            data: { ...data },
        });
    }

    async get_by_user(user_id: string) {
        return await db.userFinance.findUnique({
            where: { user_id: user_id },
        });
    }

    async get_income_slab_code(user_id: string): Promise<string> {
        const finance = await this.get_by_user(user_id);
        if (!finance) return "31"; // Default to below 1L

        const income = Number(finance.annual_income);

        if (income < 100000) return "31";        // Below 1L
        if (income < 500000) return "32";        // 1-5L
        if (income < 1000000) return "33";       // 5-10L
        if (income < 2500000) return "34";       // 10-25L
        if (income <= 10000000) return "35";      // 25L-1Cr
        return "36";                            // Above 1Cr
    }

    async delete(user_id: string, tx: TxClient | typeof db = db) {
        return await tx.userFinance.delete({
            where: { user_id: user_id },
        });
    }
}

export const user_finance_service = new UserFinanceServiceClass();
