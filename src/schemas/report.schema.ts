import { z } from "zod";

export const report_export_query_schema = z.object({
    type: z.enum(["capital", "portfolio", "tax", "soa"], {
        error: () => ({ message: "type must be one of: capital, portfolio, tax, soa" })
    }),
    year: z.coerce.number().int().positive().optional(),
    group_id: z.coerce.number().int().optional(),
    folio: z.string().optional(),
    expand: z.coerce.number().int().min(0).max(1).optional()
}).refine(
    (data) => {
        // Year is required if type is 'tax'
        if (data.type === "tax" && !data.year) {
            return false;
        }
        return true;
    },
    {
        message: "year is required when type is 'tax'",
        path: ["year"]
    }
).refine(
    (data) => {
        // Folio is required if type is 'soa'
        if (data.type === "soa" && !data.folio) {
            return false;
        }
        return true;
    },
    {
        message: "folio is required when type is 'soa'",
        path: ["folio"]
    }
);

export type ReportExportQueryInput = z.infer<typeof report_export_query_schema>;
