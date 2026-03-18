import { db } from "../../server.js";
import type { Prisma } from "../../prisma/generated/prisma/client.js";

type TxClient = Prisma.TransactionClient;

class userAssetsServiceClass {
    async create(userId: string, data: any, tx: TxClient | typeof db = db) {
        return await tx.userAssets.upsert({
            where: { user_id: userId },
            update: { ...data },
            create: {
                user_id: userId,
                ...data,
            }
        });
    }

    async update(userId: string, data: any) {
        return await db.userAssets.update({
            where: { user_id: userId },
            data: { ...data },
        });
    }

    async get(userId: string) {
        return await db.userAssets.findUnique({
            where: { user_id: userId },
        });
    }

    async delete(userId: string, tx: TxClient | typeof db = db) {
        return await tx.userAssets.delete({
            where: { user_id: userId },
        });
    }
}

export const user_assets_service = new userAssetsServiceClass();
