/**
 * @prettier
 */
import express from 'express';
import debug from 'debug';
import https from 'https';
import http from 'http';
import superagent from 'superagent';

import { MasterExpressConfig, config, isMasterExpressConfig } from './config';
import {
  setupLogging,
  setupDebugNamespaces,
  setupCommonMiddleware,
  createErrorHandler,
  createHttpServer,
  configureServerTimeouts,
  prepareIpc,
  readCertificates,
  setupHealthCheckRoutes,
} from './shared/appUtils';

const debugLogger = debug('master-express:express');

/**
 * Create a startup function which will be run upon server initialization
 */
export function startup(config: MasterExpressConfig, baseUri: string): () => void {
  return function () {
    /* eslint-disable no-console */
    console.log('BitGo Master Express running');
    console.log(`Base URI: ${baseUri}`);
    console.log(`Environment: ${config.env}`);
    console.log(`SSL Enabled: ${config.enableSSL}`);
    console.log(`Proxy Enabled: ${config.enableProxy}`);
    /* eslint-enable no-console */
  };
}

function isSSL(config: MasterExpressConfig): boolean {
  const { keyPath, crtPath, sslKey, sslCert } = config;
  if (!config.enableSSL) return false;
  return Boolean((keyPath && crtPath) || (sslKey && sslCert));
}

async function createHttpsServer(
  app: express.Application,
  config: MasterExpressConfig,
): Promise<https.Server> {
  const { keyPath, crtPath, sslKey, sslCert } = config;
  let key: string;
  let cert: string;

  if (sslKey && sslCert) {
    key = sslKey;
    cert = sslCert;
    console.log('Using SSL key and cert from environment variables');
  } else if (keyPath && crtPath) {
    const certificates = await readCertificates(keyPath, crtPath);
    key = certificates.key;
    cert = certificates.cert;
    console.log(`Using SSL key and cert from files: ${keyPath}, ${crtPath}`);
  } else {
    throw new Error('Failed to get SSL key and certificate');
  }

  const httpsOptions: https.ServerOptions = {
    key,
    cert,
  };

  return https.createServer(httpsOptions, app);
}

export async function createServer(
  config: MasterExpressConfig,
  app: express.Application,
): Promise<https.Server | http.Server> {
  const server = isSSL(config) ? await createHttpsServer(app, config) : createHttpServer(app);
  configureServerTimeouts(server, config);
  return server;
}

export function createBaseUri(config: MasterExpressConfig): string {
  const { bind, port } = config;
  const ssl = isSSL(config);
  const isStandardPort = (port === 80 && !ssl) || (port === 443 && ssl);
  return `http${ssl ? 's' : ''}://${bind}${!isStandardPort ? ':' + port : ''}`;
}

/**
 * Setup master express specific routes
 */
function setupMasterExpressRoutes(app: express.Application): void {
  // Setup common health check routes
  setupHealthCheckRoutes(app, 'master express');

  // Add enclaved express ping route
  app.get('/ping/enclavedExpress', async (req, res) => {
    const cfg = config() as MasterExpressConfig;

    try {
      console.log('Pinging enclaved express');
      console.log('SSL Enabled:', cfg.enableSSL);
      console.log('Enclaved Express URL:', cfg.enclavedExpressUrl);
      console.log('Certificate exists:', Boolean(cfg.enclavedExpressSSLCert));
      console.log('Certificate length:', cfg.enclavedExpressSSLCert.length);
      console.log('Certificate content:', cfg.enclavedExpressSSLCert);
      const response = await superagent
        .get(`${cfg.enclavedExpressUrl}/ping`)
        .ca(cfg.enclavedExpressSSLCert)
        .agent(
          new https.Agent({
            rejectUnauthorized: cfg.enableSSL,
            ca: cfg.enclavedExpressSSLCert,
          }),
        )
        .send();

      res.json({
        status: 'Successfully pinged enclaved express',
        enclavedResponse: response.body,
      });
    } catch (error) {
      debugLogger('Failed to ping enclaved express:', error);
      res.status(500).json({
        error: 'Failed to ping enclaved express',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Add a catch-all for unsupported routes
  app.use('*', (_req, res) => {
    res.status(404).json({
      error: 'Route not found or not supported in master express mode',
    });
  });

  debugLogger('Master express routes configured');
}

/**
 * Create and configure the express application for master express mode
 */
export function app(cfg: MasterExpressConfig): express.Application {
  debugLogger('master express app is initializing');

  const app = express();

  setupLogging(app, cfg);
  debugLogger('logging setup');

  setupDebugNamespaces(cfg.debugNamespace);
  setupCommonMiddleware(app, cfg);

  // Setup master express routes
  setupMasterExpressRoutes(app);

  // Add error handler
  app.use(createErrorHandler(debugLogger));

  return app;
}

export async function init(): Promise<void> {
  const cfg = config();

  // Type-safe validation that we're in master express mode
  if (!isMasterExpressConfig(cfg)) {
    throw new Error(
      `This application only supports master express mode. Current mode: ${cfg.appMode}. Set APP_MODE=master-express to use this application.`,
    );
  }

  const expressApp = app(cfg);
  const server = await createServer(cfg, expressApp);
  const { port, bind, ipc } = cfg;
  const baseUri = createBaseUri(cfg);

  if (ipc) {
    await prepareIpc(ipc);
    server.listen(ipc, startup(cfg, baseUri));
  } else {
    server.listen(port, bind, startup(cfg, baseUri));
  }
}
