import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import jwt from "jsonwebtoken";
import logger from "./logger.js";
import AppError from "./error.middleware.js";
import { user_service } from "../services/user.service.js";

interface resData {
    id: string;
    email?: string;
    log?: string;
    pwd?: string;
    inv_id?: number;
}

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email?: string;
                log?: string;
                pwd?: string;
                inv_id?: number;
            };
        }
    }
}

export const login_require = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
            logger.warn("No token provided")
            return res.status(401).json({
                success: false,
                message: 'Access token required'
            });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
        let resData: resData = {
            id: "",
            email: "",
            log: "",
            pwd: "",
            inv_id: undefined
        }

        logger.debug("\n Decoded data ==> ", decoded)

        const user = await user_service.get_user_by_id(decoded.id);

        if (!user) {
            throw new AppError('The user belonging to this token no longer exists.', 401, "USER_NOT_FOUND");
        }

        resData.id = user.id;
        resData.email = user.email ?? undefined;
        // resData.log = user.usr ?? undefined;
        // resData.pwd = user.pwd ?? undefined;
        // resData.inv_id = user.inv_id ?? undefined;
        logger.debug("User data from token ==> ", resData)

        req.user = {
            id: resData.id,
            email: resData.email,
            log: resData.log,
            pwd: resData.pwd,
            inv_id: resData.inv_id
        };

        next();
    } catch (error: any) {
        if (error.name === "TokenExpiredError") {
            throw new AppError('Token has expired, please login again.', 401, "TOKEN_EXPIRED");
        }

        logger.error("Error in authjs ==> ", error)
        throw new AppError('Invalid token, please login again.', 401, "INVALID_TOKEN");
    }
};