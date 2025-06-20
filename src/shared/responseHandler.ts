import { Request, Response as ExpressResponse, NextFunction } from 'express';
import { Config } from '../initConfig';
import { BitGoRequest } from '../types/request';
import { EnclavedError } from '../errors';

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

      // If it's an EnclavedError, use its status code
      if (error instanceof EnclavedError) {
        return res.sendEncoded(error.status, {
          error: error.message,
          name: error.name,
          details: error.message,
        });
      }

      // Default error response
      return res.sendEncoded(500, {
        error: 'Internal Server Error',
        name: error instanceof Error ? error.name : 'Error',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
