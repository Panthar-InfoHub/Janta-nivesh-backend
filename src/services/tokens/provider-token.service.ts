import axios from "axios";
import { env } from "../../lib/config-env.js";
import { redis } from "../../lib/redis.js";
import logger from "../../middleware/logger.js";
import AppError from "../../middleware/error.middleware.js";

// Both Cybrilla and Fintech Primitives issue client_credentials tokens valid for 30 min.
// Cache slightly under that so we never hand out a token that's about to expire mid-request.
const TOKEN_CACHE_TTL_SECONDS = 25 * 60;

type Provider = "cybrilla" | "fintech_primitive";

type ProviderTokenConfig = {
    token_url: string;
    client_id: string;
    client_secret: string;
};

// Sorted flow per provider: Redis first -> fetch + cache on miss/expiry.
// One generic engine backs both getters since the fetch-and-cache shape is identical -
// only the URL/creds differ.
class ProviderTokenServiceClass {

    private configs: Record<Provider, ProviderTokenConfig>;

    constructor() {
        this.configs = {
            cybrilla: {
                token_url: env.CYBRILLA_TOKEN_URL,
                client_id: env.CYBRILLA_CLIENT_ID,
                client_secret: env.CYBRILLA_CLIENT_SECRET,
            },
            fintech_primitive: {
                token_url: env.FINTECH_PRIMITIVE_TOKEN_URL,
                client_id: env.FINTECH_PRIMITIVE_CLIENT_ID,
                client_secret: env.FINTECH_PRIMITIVE_CLIENT_SECRET,
            },
        };
    }

    private redis_key = (provider: Provider) => `provider_token:${provider}`;

    private fetch_and_cache_token = async (provider: Provider): Promise<string> => {
        const config = this.configs[provider];

        logger.debug(`Fetching fresh ${provider} token`, { token_url: config.token_url });

        try {
            const response = await axios.post(
                config.token_url,
                new URLSearchParams({
                    client_id: config.client_id,
                    client_secret: config.client_secret,
                    grant_type: "client_credentials",
                }),
                { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
            );

            const token = response.data?.access_token;
            if (!token) {
                logger.error(`No access_token in ${provider} token response ==> `, response.data);
                throw new AppError(`Failed to obtain ${provider} token`, 502, "PROVIDER_TOKEN_FETCH_FAILED");
            }

            await redis.set(this.redis_key(provider), token, { EX: TOKEN_CACHE_TTL_SECONDS });
            logger.debug(`Cached fresh ${provider} token`, { ttl_seconds: TOKEN_CACHE_TTL_SECONDS });
            return token;
        } catch (error: any) {
            logger.error(`Error fetching ${provider} token ==> `, error?.response?.data || error.message);
            throw error;
        }
    }

    private get_token = async (provider: Provider): Promise<string> => {
        const cached = await redis.get(this.redis_key(provider));
        if (typeof cached === "string" && cached) {
            logger.debug(`Cache hit for ${provider} token`);
            return cached;
        }

        logger.debug(`Cache miss for ${provider} token, fetching a fresh one`);
        return this.fetch_and_cache_token(provider);
    }

    get_cybrilla_token = (): Promise<string> => this.get_token("cybrilla");

    get_fintech_primitive_token = (): Promise<string> => this.get_token("fintech_primitive");
}

export const provider_token_service = new ProviderTokenServiceClass();
