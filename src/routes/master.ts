import express from 'express';
import { MasterExpressConfig } from '../shared/types';
import { createHealthCheckRouter } from '../api/master/routers/healthCheck';
import { createEnclavedExpressRouter } from '../api/master/routers/enclavedExpressHealth';
import logger from '../logger';
import { createMasterApiRouter } from '../api/master/routers/masterApiSpec';

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
