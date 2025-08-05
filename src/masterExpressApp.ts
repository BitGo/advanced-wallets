import express from 'express';
import https from 'https';
import http from 'http';
import { SSL_OP_NO_TLSv1, SSL_OP_NO_TLSv1_1 } from 'constants';

import { MasterExpressConfig, isMasterExpressConfig, TlsMode } from './shared/types';
import { initConfig } from './initConfig';
import {
  setupLogging,
  setupCommonMiddleware,
  createErrorHandler,
  createHttpServer,
  configureServerTimeouts,
  prepareIpc,
  createMtlsMiddleware,
} from './shared/appUtils';
import logger from './logger';
import { setupRoutes } from './routes/masterBitGoExpress';

/**
 * Create a startup function which will be run upon server initialization
 */
export function startup(config: MasterExpressConfig, baseUri: string): () => void {
  return () => {
    logger.info('Master Express server starting...');
    logger.info(`Base URI: ${baseUri}`);
    logger.info(`TLS Mode: ${config.tlsMode}`);
    logger.info(`Port: ${config.port}`);
    logger.info(`Bind: ${config.bind}`);
    logger.info(`Advanced Wallet Manager URL: ${config.advancedWalletManagerUrl}`);
    logger.info('Master Express server started successfully');
  };
}

function isTLS(config: MasterExpressConfig): boolean {
  const { serverTlsKeyPath, serverTlsCertPath, serverTlsKey, serverTlsCert, tlsMode } = config;
  if (tlsMode === TlsMode.DISABLED) return false;
  return Boolean((serverTlsKeyPath && serverTlsCertPath) || (serverTlsKey && serverTlsCert));
}

async function createHttpsServer(
  app: express.Application,
  config: MasterExpressConfig,
): Promise<https.Server> {
  const { serverTlsKey, serverTlsCert, tlsMode } = config;

  if (!serverTlsKey || !serverTlsCert) {
    throw new Error('TLS key and certificate must be provided for HTTPS server');
  }

  const httpsOptions: https.ServerOptions = {
    secureOptions: SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1,
    key: serverTlsKey,
    cert: serverTlsCert,
    // Always request cert if mTLS is enabled
    requestCert: tlsMode === TlsMode.MTLS,
    rejectUnauthorized: false, // Handle authorization in middleware
  };

  const server = https.createServer(httpsOptions, app);

  return server;
}

export async function createServer(
  config: MasterExpressConfig,
  app: express.Application,
): Promise<https.Server | http.Server> {
  const server = isTLS(config) ? await createHttpsServer(app, config) : createHttpServer(app);
  configureServerTimeouts(server, config);
  return server;
}

export function createBaseUri(config: MasterExpressConfig): string {
  const { bind, port } = config;
  const ssl = isTLS(config);
  const isStandardPort = (port === 80 && !ssl) || (port === 443 && ssl);
  return `http${ssl ? 's' : ''}://${bind}${!isStandardPort ? ':' + port : ''}`;
}

/**
 * Create and configure the express application for master express mode
 */
export function app(cfg: MasterExpressConfig): express.Application {
  logger.info('Master express app is initializing');

  const app = express();

  setupLogging(app, cfg);
  setupCommonMiddleware(app, cfg);

  // Add mTLS middleware before routes if in mTLS mode
  if (cfg.tlsMode === TlsMode.MTLS) {
    app.use(createMtlsMiddleware(cfg));
  }

  // Setup master express routes
  setupRoutes(app, cfg);

  // Add error handler
  app.use(createErrorHandler());

  return app;
}

export async function init(): Promise<void> {
  const cfg = initConfig();

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
