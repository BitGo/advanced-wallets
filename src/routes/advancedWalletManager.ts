import express from 'express';
import debug from 'debug';
import { AdvancedWalletManagerConfig } from '../shared/types';
import { createKeyGenRouter } from '../advancedWalletManager/routers/advancedWalletManagerApiSpec';
import { createHealthCheckRouter } from '../advancedWalletManager/routers/healthCheck';

const debugLogger = debug('advanced-wallet-manager:routes');
/**
 * Setup all routes for the Advanced Wallet Manager application
 * @param app Express application
 * @param config
 */
export function setupRoutes(app: express.Application, config: AdvancedWalletManagerConfig): void {
  // Log all incoming requests
  debugLogger(`Setting up routes`);

  app.use(createHealthCheckRouter());
  app.use('/api/:coin', createKeyGenRouter(config));

  // Catch all unhandled routes
  app.use((req, res) => {
    res.status(404).json({
      error: 'Route not found or not supported in advanced wallet manager mode',
    });
  });
}
