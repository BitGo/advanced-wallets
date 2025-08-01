import express from 'express';
import debug from 'debug';
import { AdvancedWalletManagerConfig } from '../shared/types';
import { createKeyGenRouter } from '../advancedWalletManager/routers/advancedWalletManagerApiSpec';
import { createHealthCheckRouter } from '../advancedWalletManager/routers/healthCheck';

const debugLogger = debug('advancedWalletManager:routes');
/**
 * Setup all routes for the Advanced Wallet Manager application
 * @param app Express application
 * @param config
 */
export function setupRoutes(app: express.Application, config: AdvancedWalletManagerConfig): void {
  // Register health check routes
  app.use(createHealthCheckRouter());

  // Register keygen routes
  app.use(createKeyGenRouter(config));

  app.use('*', (_req, res) => {
    res.status(404).json({
      error: 'Route not found or not supported in advanced wallet manager mode',
    });
  });

  debugLogger('All routes configured');
}
