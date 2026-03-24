import axios from "axios";
import { env } from "../lib/config-env.js";
import { TransactionStatus } from "../prisma/generated/prisma/enums.js";
import { FdTransactionCreateInput } from "../prisma/generated/prisma/models.js";
import { db } from "../server.js";
import logger from "../middleware/logger.js";

class FDTransactionServiceClass {

    create_transaction = async (data: FdTransactionCreateInput) => {
        return await db.fdTransaction.create({
            data: data,
        });
    }

    create_transaction_with_purchase_url = async ({ issuer_id, jid, investment_amount, payout_frequency, investment_period, encrypted_text }: any) => {
        try {
            const blostem_url = `${env.BLOSTEM_URL}/purchase/${issuer_id}?sso=${encrypted_text}&jid=${jid}&investmentAmount=${investment_amount}&payoutFrequency=${payout_frequency}&investmentPeriod=${investment_period}`;

            return blostem_url;

        } catch (error) {
            logger.error("Error creating purchase URL with Blostem: ", error);
        }

    }
    // const { product_id }

    //             const issuer_id = req.query.issuer_id as string;
    //             // https://xyz.blostem.info/purchase/<issuer_id>?jid=<jid>&investmentAmount=5000&payoutFrequency=CUMULATIVE&investmentPeriod=7
    //             // const jid = req.query.jid as string;
    //             const investment_amount = req.query.investment_amount as string;
    //             const payout_frequency = req.query.payout_frequency as FdPayoutFrequency;
    //             const investment_period = req.query.investment_period as string;



    update_status_and_details = async (jid: string, transaction_status: TransactionStatus, update_data: any) => {
        return await db.$transaction(async (tx) => {

            // We remove bankDetails from the object before passing to Prisma
            const { userId, ...cleanUpdateData } = update_data;

            return await tx.fdTransaction.update({
                where: { id: jid },
                data: {
                    status: transaction_status,
                    ...cleanUpdateData,
                },
            });
        });
    }

}

export const fd_transaction_service = new FDTransactionServiceClass();