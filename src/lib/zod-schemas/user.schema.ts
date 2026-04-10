import { z } from "zod";

export const user_patch_schema = z.object({
    full_name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    city: z.string().min(1).optional(),
    dob: z.coerce.date().optional(),
    mpin: z.string().length(4).regex(/^\d+$/, "MPIN must be 4 digits").optional(),
    fcm_token: z.string().optional(),
});

export const verify_mpin_schema = z.object({
    mpin: z.string().length(4).regex(/^\d+$/, "MPIN must be 4 digits"),
});

export type UserPatchInput = z.infer<typeof user_patch_schema>;
export type VerifyMpinInput = z.infer<typeof verify_mpin_schema>;
