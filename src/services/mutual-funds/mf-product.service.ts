import { db } from "../../server.js";

type MfProductImportRow = {
    name: string;
    isin: string;
    img_url?: string;
    latest_nav?: number;
    latest_nav_date?: Date;
};

// Backs the curated-catalogue import (POST /api/v2/admin/mf-product-import). At curated-list
// scale (hundreds of funds, not the old ~30k Finnsys dump) a plain upsert loop is fine - no need
// for the raw-SQL bulk-upsert trick job.service.ts used for the discarded mf-daily job.
class MfProductServiceClass {

    /** Catalogue lookup by our own id - how the transaction flows resolve the ISIN to send FP. */
    get_by_id = async (id: string) => {
        return await db.mfProduct.findUnique({ where: { id } });
    }

    bulk_upsert = async (products: MfProductImportRow[]) => {
        const isins = products.map(p => p.isin);
        const existing = await db.mfProduct.findMany({
            where: { isin: { in: isins } },
            select: { isin: true },
        });
        const existing_isins = new Set(existing.map(p => p.isin));

        let created = 0;
        let updated = 0;

        for (const product of products) {
            const data = {
                name: product.name,
                img_url: product.img_url,
                latest_nav: product.latest_nav,
                latest_nav_date: product.latest_nav_date,
            };

            await db.mfProduct.upsert({
                where: { isin: product.isin },
                create: { isin: product.isin, ...data },
                update: data,
            });

            if (existing_isins.has(product.isin)) updated++;
            else created++;
        }

        return { created, updated, total: products.length };
    }
}

export const mf_product_service = new MfProductServiceClass();
