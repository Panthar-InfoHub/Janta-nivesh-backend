import { z } from "zod";
import { MF_SECTION_TAGS } from "../../services/mutual-funds/mf-catalogue.service.js";

// GET /api/v2/mf/funds?tag=popular - query params arrive as strings, so coerce before validating.
// Default limit 5 matches the home-screen carousel; the "see all" screen passes a larger one.
export const funds_by_tag_query_schema = z.object({
    tag: z.enum(MF_SECTION_TAGS),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(5),
});

export type FundsByTagQuery = z.infer<typeof funds_by_tag_query_schema>;
