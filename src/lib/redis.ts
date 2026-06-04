import { createClient, RedisClientType, RESP_TYPES } from 'redis';
import logger from '../middleware/logger.js';
import { env } from './config-env.js';

class RedisService {
    private static instance: RedisClientType;

    public static async getInstance(): Promise<RedisClientType> {
        if (!RedisService.instance) {
            const client = createClient({
                url: `${env.REDIS_TYPE}://${env.REDIS_USERNAME}:${env.REDIS_PASS}@${env.REDIS_HOST}:${env.REDIS_PORT}`,
                socket: {
                    connectTimeout: 10000,
                    reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
                },
                // database: env.ENVIRONMENT === "dev" ? 0 : 1
            }) as RedisClientType;

            client.on('error', (err) => logger.error('Redis Client Error', err));
            client.on('connect', () => logger.info('Redis Connecting...'));
            client.on('ready', () => logger.info('Redis Connected & Ready!!!'));

            await client.connect();
            RedisService.instance = client;
        }
        return RedisService.instance;
    }
}

export const redis = await RedisService.getInstance();
export const redis_buffer_client = redis.withTypeMapping({
    [RESP_TYPES.BLOB_STRING]: Buffer
});
