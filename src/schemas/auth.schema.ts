import { z } from "zod";

export const req_otp_schema = z.object({
    mob: z.string().regex(/^[0-9]{10}$/, "Invalid mobile number"),
});

export const validateOtpSchema = z.object({
    mob: z.string().regex(/^[0-9]{10}$/, "Invalid mobile number"),
    otp: z.string().length(4, "OTP must be 4 digits"),
    fcm_token: z.string().optional(),
});

export const deviceParamsSchema = z.object({
    dtyp: z.enum(["A", "I"]),
    dver: z.string(),
    dbn: z.string(),
    did: z.string(),
});
