import express from 'express';
import { MasterExpressConfig } from '../types';
import { createHealthCheckRouter } from '../masterBitgoExpress/routers/healthCheck';
import { createEnclavedExpressRouter } from '../masterBitgoExpress/routers/enclavedExpressHealth';
import logger from '../logger';
import { createMasterApiRouter } from '../masterBitgoExpress/routers/masterApiSpec';

/**
 * Setup master express specific routes
 */
export function setupRoutes(app: express.Application, cfg: MasterExpressConfig): void {
  // Setup health check routes using the new router
  app.use(createHealthCheckRouter('master express'));

  // Add enclaved express routes for pinging the enclaved express server
  // TODO: Add version endpoint to enclaved express
  app.use(createEnclavedExpressRouter(cfg));

  app.use(createMasterApiRouter(cfg));

  logger.debug('Master express routes configured');
}
