/**
 * @prettier
 */
import express from 'express';
import debug from 'debug';
import pjson from '../package.json';

const debugLogger = debug('enclaved:routes');

/**
 * Handler for express ping to check service health
 */
function handlePingExpress(_req: express.Request) {
  console.log('handlePingExpress');
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

function setupKeyGenRoutes() {
  // Register additional routes here as needed
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
  setupKeyGenRoutes();

  // Add a catch-all for unsupported routes
  app.use('*', (_req, res) => {
    res.status(404).json({
      error: 'Route not found or not supported in enclaved mode',
    });
  });

  debugLogger('All routes configured');
}

// promiseWrapper implementation
export function promiseWrapper(promiseRequestHandler: any) {
  return async function promWrapper(req: any, res: any, next: any) {
    debugLogger(`handle: ${req.method} ${req.originalUrl}`);
    try {
      const result = await promiseRequestHandler(req, res, next);
      if (typeof result === 'object' && result !== null && 'body' in result && 'status' in result) {
        const { status, body } = result as { status: number; body: unknown };
        res.status(status).send(body);
      } else {
        res.status(200).send(result);
      }
    } catch (e) {
      const err = e as any;
      res.status(500).json({ error: err.message || String(err) });
    }
  };
}
