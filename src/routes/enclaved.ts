import express from 'express';
import debug from 'debug';
import pjson from '../../package.json';
import type { BitGoOptions } from 'bitgo';
import { postIndependentKey } from '../api/enclaved/postIndependentKey';
import { promiseWrapper } from './utils';

const debugLogger = debug('enclaved:routes');

/**
 * Handler for express ping to check service health
 */
function handlePingExpress(_req: express.Request) {
  return {
    status: 'enclaved express server is ok!',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Handler for version info
 */
function handleVersionInfo(_req: express.Request) {
  return {
    version: pjson.version,
    name: pjson.name,
  };
}

/**
 * Adds the ping route handlers
 * @param app Express application
 */
function setupPingRoutes(app: express.Application) {
  app.post('/ping', promiseWrapper(handlePingExpress));
  app.get('/version', promiseWrapper(handleVersionInfo));
}

async function prepBitGo(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    // Lazy load BitGo only when needed
    const { BitGo } = await import('bitgo');
    const bitgoConstructorParams: BitGoOptions = {};
    req.body.bitgo = new BitGo(bitgoConstructorParams);
    next();
  } catch (error) {
    next(error);
  }
}

function setupKeyGenRoutes(app: express.Application) {
  app.post('/api/:coin/key/independent', prepBitGo, promiseWrapper(postIndependentKey));
  debugLogger('KeyGen routes configured');
}

/**
 * Setup all routes for the Enclaved Express application
 * @param app Express application
 */
export function setupRoutes(app: express.Application): void {
  // Register health check routes
  setupPingRoutes(app);

  // Register keygen routes
  setupKeyGenRoutes(app);

  // Add a catch-all for unsupported routes
  app.use('*', (_req, res) => {
    res.status(404).json({
      error: 'Route not found or not supported in enclaved mode',
    });
  });

  debugLogger('All routes configured');
}
