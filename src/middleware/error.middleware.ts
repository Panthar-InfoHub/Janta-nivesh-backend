import { ErrorRequestHandler } from "express";
import { Prisma } from "../prisma/generated/prisma/client.js";
import logger from "./logger.js";
import { ZodError } from "zod";
import { capture_exception } from "../lib/posthog.js";
import { env } from "../lib/config-env.js";

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly errorType: string;
    public readonly isOperational: boolean;
    public readonly details?: unknown;

    constructor(
        message: string,
        statusCode = 500,
        errorType = "ApplicationError",
        details?: unknown,
        isOperational = true
    ) {
        super(message);

        if (typeof details === "boolean") {
            isOperational = details;
            details = undefined;
        }

        this.statusCode = statusCode;
        this.errorType = errorType;
        this.isOperational = isOperational;
        this.details = details;

        Error.captureStackTrace(this, this.constructor);
    }
}

export default AppError;

export const errorHandler: ErrorRequestHandler = (
    err,
    req,
    res,
    _next
) => {
    let error = err;

    if (!(error instanceof AppError)) {
        // Zod validation error
        if (error instanceof ZodError) {
            error = new AppError(
                "Validation failed",
                400,
                "VALIDATION_ERROR",
                error.issues.map((issue) => ({
                    path: issue.path.join("."),
                    message: issue.message,
                    code: issue.code,
                }))
            );
        }
        // Body parser invalid JSON syntax error
        else if (error instanceof SyntaxError && "body" in error) {
            error = new AppError(
                "Malformed JSON request body",
                400,
                "INVALID_JSON_SYNTAX"
            );
        }
            // Prisma known errors
        else if (error instanceof Prisma.PrismaClientKnownRequestError) {
            switch (error.code) {
                case "P2002": {
                    const target = (error.meta?.target as string[])?.join(", ") || "field";
                    error = new AppError(
                        `Unique constraint failed on: ${target}`,
                        409,
                        "DUPLICATE_KEY_ERROR",
                        { target }
                    );
                    break;
                }
                case "P2025": {
                    error = new AppError(
                        (error.meta?.cause as string) || "Record not found",
                        404,
                        "NOT_FOUND"
                    );
                    break;
                }
                case "P2003": {
                    const field = error.meta?.field_name as string;
                    error = new AppError(
                        `Foreign key constraint failed${field ? ` on field ${field}` : ""}`,
                        400,
                        "FOREIGN_KEY_VIOLATION"
                    );
                    break;
                }
                default:
                    error = new AppError(
                        `Database operation failed: ${error.message}`,
                        500,
                        "DATABASE_ERROR"
                    );
            }
        }
            // Prisma validation error
        else if (error instanceof Prisma.PrismaClientValidationError) {
            error = new AppError(
                "Invalid parameters sent to database",
                400,
                "DATABASE_VALIDATION_ERROR"
            );
        }
            // Prisma connection error
        else if (error instanceof Prisma.PrismaClientInitializationError) {
            error = new AppError(
                "Database connection unavailable",
                503,
                "DATABASE_CONNECTION_ERROR",
                false
            );
        }
            // Unknown unexpected server error
        else {
            error = new AppError(
                error.message || "Internal Server Error",
                error.status || error.statusCode || 500,
                "INTERNAL_SERVER_ERROR",
                undefined,
                false
            );
        }
    }

    if (!error.isOperational) {
        logger.error("UNEXPECTED SYSTEM ERROR ==> ", err);
    }

    const distinctId =
        req.user?.id ||
        (req.headers["x-forwarded-for"] as string) ||
        req.ip ||
        "anonymous";

    capture_exception(err, distinctId, {
        path: req.originalUrl || req.url,
        method: req.method,
        errorType: error.errorType,
        message: error.message,
        statusCode: error.statusCode,
    });

    res.status(error.statusCode).json({
        success: false,
        message: error.message,
        data: null,
        errorCode: error.errorType,
        ...(error.details ? { details: error.details } : {}),
        ...(env.ENVIRONMENT === "dev" ? { stack: error.stack } : {}),
    });
};
