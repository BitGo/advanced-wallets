/**
 * Common base error class for the Advanced Wallet Manager application
 */
export class AdvancedWalletManagerError extends Error {
  public status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error for API responses
 */
export class ApiResponseError extends AdvancedWalletManagerError {
  public result: any;

  constructor(message: string, status = 500, result?: any) {
    super(message, status);
    this.result = result;
  }
}

/**
 * Error for configuration issues
 */
export class ConfigurationError extends AdvancedWalletManagerError {
  constructor(message: string) {
    super(message, 500);
  }
}

/**
 * Error for service connection issues
 */
export class ServiceConnectionError extends AdvancedWalletManagerError {
  constructor(message: string) {
    super(message, 502);
  }
}

/**
 * Error for unsupported operations
 */
export class UnsupportedOperationError extends AdvancedWalletManagerError {
  constructor(message: string) {
    super(message, 400);
  }
}
