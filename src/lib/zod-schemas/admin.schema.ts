import { z } from "zod";

// Dev-only OTP-bypass login. Either identifier works: phone_no creates the user if it doesn't
// exist yet (matching what req-otp does), email requires an already-existing one - see the
// admin controller for why the two behave differently.
export const admin_login_schema = z.object({
    email: z.string().email().optional(),
    phone_no: z.string().regex(/^[0-9]{10}$/, "Invalid mobile number").optional(),
    fcm_token: z.string().optional(),
}).refine((data) => !!data.email || !!data.phone_no, {
    message: "Either email or phone_no is required",
});

// Bulk import of the curated Cybrilla/FP ISIN list (client's Excel, converted to JSON externally).
// latest_nav/latest_nav_date/img_url are optional - NAV sourcing is a separate, deferred decision,
// and logos may not be known at import time.
export const mf_product_import_schema = z.object({
    products: z.array(z.object({
        name: z.string().min(1),
        isin: z.string().min(1),
        img_url: z.string().url().optional(),
        latest_nav: z.number().positive().optional(),
        latest_nav_date: z.coerce.date().optional(),
    })).min(1, "At least one product is required"),
});
