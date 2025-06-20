import express from 'express';
import debug from 'debug';
import { EnclavedConfig } from '../shared/types';
import { createKeyGenRouter } from '../enclavedBitgoExpress/routers/enclavedApiSpec';
import { createHealthCheckRouter } from '../enclavedBitgoExpress/routers/healthCheck';

const debugLogger = debug('enclaved:routes');
/**
 * Setup all routes for the Enclaved Express application
 * @param app Express application
 * @param config
 */
export function setupRoutes(app: express.Application, config: EnclavedConfig): void {
  // Register health check routes
  app.use(createHealthCheckRouter());

  // Register keygen routes
  app.use(createKeyGenRouter(config));

  app.use('*', (_req, res) => {
    res.status(404).json({
      error: 'Route not found or not supported in enclaved mode',
    });
  });

  debugLogger('All routes configured');
}
