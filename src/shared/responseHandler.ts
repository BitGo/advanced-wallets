import { Request, Response as ExpressResponse, NextFunction } from 'express';
import { Config } from '../shared/types';
import { BitGoRequest } from '../types/request';
import { ApiResponseError } from 'bitgo';

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
      // If it's already a Response object (e.g. from Response.error)
      if (error && typeof error === 'object' && 'type' in error && 'payload' in error) {
        const apiError = error as ApiResponse;
        return res.sendEncoded(apiError.type, apiError.payload);
      }

      if ((error as any).name === 'ApiResponseError') {
        const apiError = error as ApiResponseError;
        const body = {
          error: apiError.name,
          details: apiError.result,
        };
        return res.sendEncoded(apiError.status, body);
      }

      // Handle all other errors
      const errorObj = error as any;
      const status = errorObj.status || errorObj.statusCode || 500;

      // For error status codes (400+), ensure we match the expected schema
      if (status >= 400) {
        const body = {
          error: errorObj.name || errorObj.error || 'Internal Server Error',
          details: errorObj.details || errorObj.message || String(error),
        };
        return res.sendEncoded(status, body);
      }

      // For non-error status codes, return the error object as-is
      const body = errorObj.result || errorObj.body || errorObj;
      return res.sendEncoded(status, body);
    }
  };
}
