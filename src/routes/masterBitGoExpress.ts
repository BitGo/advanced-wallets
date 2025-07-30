import express from 'express';
import { MasterExpressConfig } from '../shared/types';
import { createHealthCheckRouter } from '../api/master/routers/healthCheck';
import { createAdvancedWalletManagerHealthRouter } from '../api/master/routers/awmExpressHealth';
import { createMasterApiRouter } from '../api/master/routers/masterBitGoExpressApiSpec';

/**
 * Setup master express specific routes
 */
export function setupRoutes(app: express.Application, cfg: MasterExpressConfig): void {
  // Setup health check routes using the new router
  app.use(createHealthCheckRouter('master express'));

  // Add advanced wallet manager routes for pinging the advanced wallet manager server
  // TODO: Add version endpoint to advanced wallet manager
  app.use(createAdvancedWalletManagerHealthRouter(cfg));

  app.use(createMasterApiRouter(cfg));
}
