import crypto from "crypto";
import { env } from "./config-env.js";

const ALGORITHM = "aes-256-gcm";

export function encrypt(text: string | null | undefined): string | null {
    if (text === null || text === undefined) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(env.DB_ENCRYPTION_KEY, "hex"), iv);
    let encrypted = cipher.update(text, "utf8", "base64");
    encrypted += cipher.final("base64");
    const tag = cipher.getAuthTag().toString("base64");
    return `${iv.toString("base64")}:${encrypted}:${tag}`;
}

export function decrypt(encryptedData: string | null | undefined): string | null {
    if (!encryptedData) return null;
    const parts = encryptedData.split(":");
    if (parts.length !== 3) {
        // Return original if it's not encrypted (allows compatibility with unencrypted migration data)
        return encryptedData;
    }
    try {
        const [ivStr, ciphertextStr, tagStr] = parts;
        const iv = Buffer.from(ivStr, "base64");
        const tag = Buffer.from(tagStr, "base64");
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(env.DB_ENCRYPTION_KEY, "hex"), iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(ciphertextStr, "base64", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    } catch (e) {
        // Fallback to original text if decryption fails (e.g. for pre-existing unencrypted entries)
        return encryptedData;
    }
}

export function generateBlindIndex(text: string | null | undefined): string | null {
    if (text === null || text === undefined) return null;
    const normalized = text.trim().toLowerCase();
    return crypto
        .createHmac("sha256", Buffer.from(env.BLIND_INDEX_KEY, "hex"))
        .update(normalized)
        .digest("hex");
}
