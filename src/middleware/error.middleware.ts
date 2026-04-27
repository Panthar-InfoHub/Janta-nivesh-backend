import { ErrorRequestHandler } from "express";
import { Prisma } from "../prisma/generated/prisma/client.js";
import logger from "./logger.js";
import { ZodError } from "zod";


class AppError extends Error {
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

        // Backward compatibility: allow the 4th argument to be isOperational boolean.
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
    _req,
    res,
    _next
) => {
    let error = err;

    if (!(error instanceof AppError)) {
        // Mongo duplicate key
        if (error.name === "MongoServerError" && error.code === 11000) {
            error = new AppError(
                `Duplicate field value entered: ${Object.keys(error.keyValue || {})}`,
                409,
                "DuplicateKeyError"
            );
        }

        // Mongo error code 27
        else if (error.name === "MongoServerError" && error.code === 27) {
            error = new AppError(
                `Product not found ==> ${error.errorResponse?.errmsg}`,
                409,
                "MongoError"
            );
        }

        // Mongoose validation error
        else if (error.name === "ValidationError") {
            const message = Object.values(error.errors || {})
                .map((val: any) => `${val.path}: ${val.message}`)
                .join(", ");

            error = new AppError(message, 400, "ValidationError");
        }

        // Zod validation error
        else if (error instanceof ZodError) {
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

        // CastError (invalid ObjectId)
        else if (error.name === "CastError") {
            error = new AppError(
                `Invalid ${error.path}: ${error.value}`,
                400,
                "CastError"
            );
        }

        // JWT errors
        else if (error.name === "JsonWebTokenError") {
            error = new AppError(
                "Invalid token. Please log in again!",
                401,
                "TokenError"
            );
        }

        else if (error.name === "TokenExpiredError") {
            error = new AppError(
                "Your token has expired! Please log in again.",
                401,
                "TokenExpiredError"
            );
        }

        // Prisma known request errors (P2xxx codes)
        else if (error instanceof Prisma.PrismaClientKnownRequestError) {
            switch (error.code) {
                case "P2002":
                    error = new AppError(
                        `Unique constraint violation on field: ${(error.meta?.target as string[])?.join(", ")}`,
                        409,
                        "PrismaUniqueConstraintError"
                    );
                    break;
                case "P2003":
                    error = new AppError(
                        `Foreign key constraint failed on field: ${error.meta?.field_name}`,
                        409,
                        "PrismaForeignKeyError"
                    );
                    break;
                case "P2025":
                    error = new AppError(
                        `Record not found: ${error.meta?.cause ?? "The requested resource does not exist"}`,
                        404,
                        "PrismaNotFoundError"
                    );
                    break;
                case "P2034":
                    error = new AppError(
                        "Transaction conflict, please retry",
                        409,
                        "PrismaTransactionConflict"
                    );
                    break;
                default:
                    error = new AppError(
                        `Database error (${error.code}): ${error.message}`,
                        500,
                        "PrismaKnownError"
                    );
            }
        }

        // Prisma raw query / unknown DB errors (e.g. PostgreSQL code 21000)
        else if (error instanceof Prisma.PrismaClientUnknownRequestError) {
            const rawCode = error.message.match(/Code: `(\w+)`/)?.[1];
            error = new AppError(
                `Raw query failed${rawCode ? ` (DB code: ${rawCode})` : ""}: ${error.message}`,
                500,
                "PrismaRawQueryError"
            );
        }

        // Prisma validation error (wrong types / missing required fields passed to Prisma)
        else if (error instanceof Prisma.PrismaClientValidationError) {
            error = new AppError(
                "Invalid data sent to database",
                400,
                "PrismaValidationError"
            );
        }

        // Prisma connection / initialisation error
        else if (error instanceof Prisma.PrismaClientInitializationError) {
            error = new AppError(
                "Database connection failed",
                503,
                "PrismaConnectionError",
                false
            );
        }

        // Unknown / programming error
        else {
            error = new AppError(
                "Internal Server Error",
                500,
                "ServerError",
                false
            );
        }
    }

    if (!error.isOperational) {
        // logger.error("UNEXPECTED ERROR:", err);
    }

    // 3. Unified response
    res.status(error.statusCode).json({
        success: false,
        error: {
            type: error.errorType,
            message: error.message,
            ...(error.details && { details: error.details }),
            ...(process.env.NODE_ENV === "development" && {
                stack: error.stack
            })
        }
    });
};
