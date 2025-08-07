import { Request, Response as ExpressResponse, NextFunction } from 'express';
import { AppMode, Config } from '../shared/types';
import { BitGoRequest } from '../types/request';
import { ApiResponseError, AdvancedWalletManagerError } from '../errors';
import {
  BitgoExpressError,
  ValidationError,
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from './errors';
import logger from '../logger';
import { DecodeError } from '@api-ts/superagent-wrapper';

// Extend Express Response to include sendEncoded
interface EncodedResponse extends ExpressResponse {
  sendEncoded(status: number, body: unknown): void;
}

// Define the shape of the Response class based on actual structure
interface ApiResponse {
  type: number;
  payload: unknown;
}

// Generic service function type that works with both express instances
export type ServiceFunction<T extends Config = Config> = (
  req: BitGoRequest<T>,
  res: EncodedResponse,
  next: NextFunction,
) => Promise<ApiResponse> | ApiResponse;

/**
 * Check for specific API connection errors and throw appropriate messages
 */
function checkApiServerRunning(req: BitGoRequest, error: any): void {
  const config = req.config;
  const isMbe = config.appMode === AppMode.MASTER_EXPRESS;

  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ECONNRESET') {
    throw new Error(
      `${
        isMbe ? 'Advanced Wallet Manager' : 'KMS'
      } API service is not running or unreachable. Please check if the service is available.`,
    );
  }

  if (error.code === 'ETIMEDOUT' || error.timeout) {
    throw new Error(
      `${
        isMbe ? 'Advanced Wallet Manager' : 'KMS'
      } API request timed out. The service may be overloaded or unreachable.`,
    );
  }
}

/**
 * Wraps a service function to handle Response objects and errors consistently
 * @param fn Service function that returns a Response object
 * @returns Express middleware function that handles the response encoding
 */
export function responseHandler<T extends Config = Config>(fn: ServiceFunction<T>) {
  return async (req: Request, res: EncodedResponse, next: NextFunction) => {
    try {
      const result = await fn(req as BitGoRequest<T>, res, next);
      return res.sendEncoded(result.type, result.payload);
    } catch (error) {
      // Check for API connection errors first, but don't throw if it's not a connection issue
      try {
        checkApiServerRunning(req as BitGoRequest, error);
      } catch (connectionError) {
        // If checkApiServerRunning throws, use that error message
        const errorBody = {
          error: 'Internal Server Error',
          name: 'ConnectionError',
          details:
            connectionError instanceof Error ? connectionError.message : String(connectionError),
        };
        logger.error('API Connection Error: %s', errorBody.details);
        return res.sendEncoded(500, errorBody);
      }

      // If it's already a Response object (e.g. from Response.error)
      if (error && typeof error === 'object' && 'type' in error && 'payload' in error) {
        const apiError = error as ApiResponse;
        return res.sendEncoded(apiError.type, apiError.payload);
      }

      if ((error as any).name === 'ApiResponseError') {
        const apiError = error as ApiResponseError;
        const body = {
          error: 'BitGoApiResponseError',
          details: apiError.result,
        };
        logger.error(JSON.stringify(apiError.result, null, 2));
        return res.status(apiError.status).json(body);
      }

      // If it's a BitgoExpressError, map to appropriate status code
      if (error instanceof BitgoExpressError) {
        let statusCode = 500;

        if (error instanceof ValidationError) {
          statusCode = 422;
        } else if (error instanceof NotFoundError) {
          statusCode = 404;
        } else if (error instanceof BadRequestError) {
          statusCode = 400;
        } else if (error instanceof UnauthorizedError) {
          statusCode = 401;
        } else if (error instanceof ForbiddenError) {
          statusCode = 403;
        } else if (error instanceof ConflictError) {
          statusCode = 409;
        }

        const errorBody = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
        // Log the error details for debugging
        logger.error(JSON.stringify(errorBody, null, 2));
        logger.error(statusCode);
        return res.sendEncoded(statusCode, {
          error: error.name,
          details: error.message,
        });
      }

      // If it's an AdvancedWalletManagerError, use its status code
      if (error instanceof AdvancedWalletManagerError) {
        return res.sendEncoded(error.status, {
          error: error.message,
          name: error.name,
          details: error.message,
        });
      }

      // If it's an http error from EBE, throw the error upstream
      if (error instanceof DecodeError) {
        const statusCode =
          typeof error.decodedResponse.status === 'number' ? error.decodedResponse.status : 500;
        return res.sendEncoded(statusCode, {
          ...error.decodedResponse.body,
        });
      }

      // Default error response
      const errorBody = {
        error: 'Internal Server Error',
        name: error instanceof Error ? error.name : 'Error',
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
      logger.error(JSON.stringify(errorBody, null, 2));
      return res.sendEncoded(500, errorBody);
    }
  };
}
