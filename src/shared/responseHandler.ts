import { Request, Response as ExpressResponse, NextFunction } from 'express';
import { Config } from '../types';
import { BitGoRequest } from '../types/request';

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
      // Log the error
      console.error('Error in service function:', error);

      // If it's already a Response object (e.g. from Response.error)
      if (error && typeof error === 'object' && 'type' in error && 'payload' in error) {
        const apiError = error as ApiResponse;
        return res.sendEncoded(apiError.type, apiError.payload);
      }

      // Default error response
      return res.sendEncoded(500, {
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    }
  };
}
