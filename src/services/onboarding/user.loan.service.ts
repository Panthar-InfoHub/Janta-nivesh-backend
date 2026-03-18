import { db } from "../../server.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";

type TxClient = Prisma.TransactionClient;

type PaginationOptions = {
    page?: number;
    limit?: number;
};

class UserLoanServiceClass {
    async create(user_id: string, data: any) {
        return await db.userLoan.upsert({
            where: {
                user_loan_type_idx: {
                    user_id: user_id,
                    loan_type: data.loan_type, // Assuming loan_type is unique per user
                }
            },
            update: {
                ...data,
            },
            create: {
                user_id: user_id,
                ...data,
            },
        });
    }

    async update(loan_id: string, user_id: string, data: any) {
        return await db.userLoan.update({
            where: {
                id: loan_id,
                user_id: user_id,
            },
            data: { ...data },
        });
    }

    async getAll(user_id: string, { page = 1, limit = 50 }: PaginationOptions) {

        const [loans, total_loans] = await Promise.all([
            db.userLoan.findMany({
                where: { user_id: user_id },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            db.userLoan.count({
                where: { user_id: user_id },
            }),
        ]);

        return {
            loans,
            pagination: {
                total_loans,
                current_page: page,
                limit,
                total_pages: Math.ceil(total_loans / limit),
            },
        };

    }

    async get_by_id(loan_id: string, user_id: string) {
        return await db.userLoan.findUnique({
            where: {
                id: loan_id,
                user_id: user_id,
            },
        });
    }

    async delete(loan_id: string, user_id: string) {
        return await db.userLoan.delete({
            where: {
                id: loan_id,
                user_id: user_id,
            },
        });
    }

    async delete_all_loans(user_id: string, tx: TxClient | typeof db = db) {
        return await tx.userLoan.deleteMany({
            where: {
                user_id: user_id,
            },
        });
    }


    async sync(user_id: string, loans: any[], tx: TxClient | typeof db = db) {
        await tx.userLoan.deleteMany({ where: { user_id } });
        if (loans.length > 0) {
            await tx.userLoan.createMany({
                data: loans.map((loan) => ({ user_id, ...loan })),
            });
        }
    }
}

export const user_loan_service = new UserLoanServiceClass();
