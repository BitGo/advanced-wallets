import express from 'express';
import { MasterExpressConfig } from '../shared/types';
import { createHealthCheckRouter } from '../api/master/routers/healthCheck';
import { createAwmRouter } from '../api/master/routers/advancedWalletManagerHealth';
import { createMasterApiRouter } from '../api/master/routers/masterApiSpec';

/**
 * Setup master express specific routes
 */
export function setupRoutes(app: express.Application, cfg: MasterExpressConfig): void {
  // Setup health check routes using the new router
  app.use(createHealthCheckRouter('master express'));

  // Add advanced wallet manager routes for pinging the advanced wallet manager server
  // TODO: Add version endpoint to advanced wallet manager
  app.use(createAwmRouter(cfg));

  // Set up the routes for the master API
  app.use(createMasterApiRouter(cfg));
}
