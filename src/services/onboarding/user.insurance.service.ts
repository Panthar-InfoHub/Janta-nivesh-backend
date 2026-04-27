import { db } from "../../server.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";

type TxClient = Prisma.TransactionClient;

class UserInsuranceServiceClass {
    async create(user_id: string, data: any, tx: TxClient | typeof db = db) {
        return await tx.userInsurance.upsert({
            where: { user_id: user_id },
            update: { ...data },
            create: {
                user_id: user_id,
                ...data,
            },
        });
    }

    async update(user_id: string, data: any) {
        return await db.userInsurance.update({
            where: { user_id: user_id },
            data: { ...data },
        });
    }

    async get_by_user(user_id: string) {
        return await db.userInsurance.findUnique({
            where: { user_id: user_id },
        });
    }

    async delete(userId: string, tx: TxClient | typeof db = db) {
        return await tx.userInsurance.delete({
            where: { user_id: userId },
        });
    }
}

export const user_insurance_service = new UserInsuranceServiceClass();