import * as t from 'io-ts';
/**
 * Custom error classes for specific error types
 */

/**
 * Base custom error class with common setup
 */
export class BitgoExpressError extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * ValidationError represents a client error due to invalid input parameters
 * Should result in a 422 Unprocessable Entity HTTP status code
 */
export class ValidationError extends BitgoExpressError {
  constructor(message: string) {
    super(message, 'ValidationError');
  }
}

/**
 * NotFoundError represents a resource that could not be found
 * Should result in a 404 Not Found HTTP status code
 */
export class NotFoundError extends BitgoExpressError {
  constructor(message: string) {
    super(message, 'NotFoundError');
  }
}

/**
 * BadRequestError represents a client error due to invalid request format
 * Should result in a 400 Bad Request HTTP status code
 */
export class BadRequestError extends BitgoExpressError {
  constructor(message: string) {
    super(message, 'BadRequestError');
  }
}

/**
 * UnauthorizedError represents an authentication failure
 * Should result in a 401 Unauthorized HTTP status code
 */
export class UnauthorizedError extends BitgoExpressError {
  constructor(message: string) {
    super(message, 'UnauthorizedError');
  }
}

/**
 * ForbiddenError represents an authorization failure
 * Should result in a 403 Forbidden HTTP status code
 */
export class ForbiddenError extends BitgoExpressError {
  constructor(message: string) {
    super(message, 'ForbiddenError');
  }
}

/**
 * ConflictError represents a conflict with the current state of the resource
 * Should result in a 409 Conflict HTTP status code
 */
export class ConflictError extends BitgoExpressError {
  constructor(message: string) {
    super(message, 'ConflictError');
  }
}

/**
 * NotImplementedError represents a feature that is not implemented
 * Should result in a 501 Not Implemented HTTP status code
 */
export class NotImplementedError extends BitgoExpressError {
  constructor(message: string) {
    super(message, 'NotImplementedError');
  }
}

// Define specific HTTP error responses

// Common error response types
const ErrorResponse = t.type({
  /**
   * The error name
   */
  error: t.string,
  /**
   * Error details
   */
  details: t.string,
});
export const BadRequestResponse = { 400: ErrorResponse };
export const NotFoundResponse = { 404: ErrorResponse };
export const ConflictErrorResponse = { 409: ErrorResponse };
export const UnprocessableEntityResponse = { 422: ErrorResponse };
export const InternalServerErrorResponse = { 500: ErrorResponse };
export const NotImplementedResponse = { 501: ErrorResponse };

export const ErrorResponses = {
  ...BadRequestResponse,
  ...NotFoundResponse,
  ...ConflictErrorResponse,
  ...UnprocessableEntityResponse,
  ...InternalServerErrorResponse,
  ...NotImplementedResponse,
};
