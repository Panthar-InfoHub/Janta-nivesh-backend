import { z } from "zod";

export const reqOtpSchema = z.object({
    mob: z.string().regex(/^[0-9]{10}$/, "Invalid mobile number"),
});

export const validateOtpSchema = z.object({
    mob: z.string().regex(/^[0-9]{10}$/, "Invalid mobile number"),
    otp: z.string().length(4, "OTP must be 4 digits"),
});

export const deviceParamsSchema = z.object({
    dtyp: z.enum(["A", "I"]),
    dver: z.string(),
    dbn: z.string(),
    did: z.string(),
});
