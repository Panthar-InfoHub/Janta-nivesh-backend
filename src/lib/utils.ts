import { promisify } from "util";
import logger from "../middleware/logger.js";
import { gunzip } from "zlib";
import { MfProductOrderByWithRelationInput, MfProductWhereInput } from "../prisma/generated/prisma/models.js";

export const get_mf_search_query = (params: any): { query: MfProductWhereInput, order: MfProductOrderByWithRelationInput } => {

    const { category, risk, sort_by } = params;

    const query: MfProductWhereInput = {
        ...(category && { asset_type: { equals: category } }),
        ...(risk && { risk_level: { equals: risk } }),
    }

    const order: MfProductOrderByWithRelationInput = {
        ...(sort_by === "3m" && { metrics: { return_90d: 'desc' } }),
        ...(sort_by === "6m" && { metrics: { return_6m: 'desc' } }),
        ...(sort_by === "1y" && { metrics: { return_1y: 'desc' } }),
        ...(sort_by === "3y" && { metrics: { return_3y: 'desc' } }),
    }

    return { query, order };
}


export const chunkArray = (array: any[], size: number): any[][] => {
    const chunked: any[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
};


export const logMemoryUsage = (step: string) => {
    const used = process.memoryUsage();
    // heapUsed is the amount of memory occupied by objects created in JS
    const memoryInMB = Math.round(used.heapUsed / 1024 / 1024 * 100) / 100;

    // Using Winston if you have it, otherwise console.info
    logger.info(`[Memory Check] ${step}: ${memoryInMB} MB`);
};

export const decompressAndFilter = async (buffer: Buffer, period?: string) => {

    const gunzipAsync = promisify(gunzip);
    const decompressed = await gunzipAsync(buffer);

    const nav_history = JSON.parse(decompressed.toString("utf-8"));

    if (period === "all" || !period) return nav_history;

    // Filtering logic based on period : 3,6,1y,3y, 5y, all
    const now = new Date();
    const cutoffDate = new Date();

    switch (period) {
        case "3m": cutoffDate.setMonth(now.getMonth() - 3); break;
        case "6m": cutoffDate.setMonth(now.getMonth() - 6); break;
        case "1y": cutoffDate.setFullYear(now.getFullYear() - 1); break;
        case "3y": cutoffDate.setFullYear(now.getFullYear() - 3); break;
        case "5y": cutoffDate.setFullYear(now.getFullYear() - 5); break;
    }

    const cutoffTimestamp = cutoffDate.getTime();

    return nav_history.filter((entry: any) => {
        return new Date(entry.nav_date).getTime() >= cutoffTimestamp;
    });

}