import crypto from "crypto";
import { env } from "./config-env.js";

/**
 * Implements NSE's "Common Authentication For All APIs" scheme (nsemfdesk):
 * - salt/iv: random 16-byte values, hex encoded
 * - key: PBKDF2(memberLicenseKey, salt, 65536 iters, 128-bit) - standard NSE AES128 key derivation
 * - plain_text: `${apiSecret}|${randomNumber}`
 * - encrypted_password: base64(`${iv}::${salt}::${aes_encrypted_val_hex}`)
 * Placeholder credentials (login user id, api secret, member license key, member code)
 * are read from env and need to be filled in once NSE issues them.
 */

const generate_random_number = () => Math.floor(100000000 + Math.random() * 900000000).toString();

export const generate_nse_mfdesk_encrypted_password = (
    api_secret: string = env.NSE_MFDESK_API_SECRET,
    member_license_key: string = env.NSE_MFDESK_MEMBER_LICENSE_KEY
) => {
    const salt = crypto.randomBytes(16).toString("hex");
    const iv = crypto.randomBytes(16).toString("hex");

    const plain_text = `${api_secret}|${generate_random_number()}`;

    const key = crypto.pbkdf2Sync(member_license_key, Buffer.from(salt, "hex"), 65536, 16, "sha1");

    const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.from(iv, "hex"));
    const aes_encrypted_val = Buffer.concat([cipher.update(plain_text, "utf8"), cipher.final()]).toString("hex");

    return Buffer.from(`${iv}::${salt}::${aes_encrypted_val}`).toString("base64");
};

export const generate_nse_mfdesk_auth_header = (
    login_user_id: string = env.NSE_MFDESK_LOGIN_USER_ID,
    encrypted_password: string = generate_nse_mfdesk_encrypted_password()
) => {
    return Buffer.from(`${login_user_id}:${encrypted_password}`).toString("base64");
};
