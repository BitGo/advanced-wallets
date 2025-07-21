import express from 'express';
import debug from 'debug';
import { SecuredExpressConfig } from '../shared/types';
import { createKeyGenRouter } from '../securedBitgoExpress/routers/securedExpressApiSpec';
import { createHealthCheckRouter } from '../securedBitgoExpress/routers/healthCheck';

const debugLogger = debug('secured:routes');
/**
 * Setup all routes for the Secured Express application
 * @param app Express application
 * @param config
 */
export function setupRoutes(app: express.Application, config: SecuredExpressConfig): void {
  // Register health check routes
  app.use(createHealthCheckRouter());

  // Register keygen routes
  app.use(createKeyGenRouter(config));

  app.use('*', (_req, res) => {
    res.status(404).json({
      error: 'Route not found or not supported in secured mode',
    });
  });

  debugLogger('All routes configured');
}
