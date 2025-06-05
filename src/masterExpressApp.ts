import express from 'express';
import https from 'https';
import http from 'http';
import { SSL_OP_NO_TLSv1, SSL_OP_NO_TLSv1_1 } from 'constants';

import { MasterExpressConfig, config, isMasterExpressConfig, TlsMode } from './config';
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
import { setupRoutes } from './routes/master';

/**
 * Create a startup function which will be run upon server initialization
 */
export function startup(config: MasterExpressConfig, baseUri: string): () => void {
  return function () {
    logger.info('BitGo Master Express running');
    logger.info(`Base URI: ${baseUri}`);
    logger.info(`Environment: ${config.env}`);
    logger.info(`TLS Mode: ${config.tlsMode}`);
    logger.info(`mTLS Enabled: ${config.tlsMode === TlsMode.MTLS}`);
    logger.info(`Request Client Cert: ${config.mtlsRequestCert}`);
    logger.info(`Allow Self-Signed: ${config.allowSelfSigned}`);
    if (config.mtlsAllowedClientFingerprints?.length) {
      logger.info(
        `Allowed Client Fingerprints: ${config.mtlsAllowedClientFingerprints.length} configured`,
      );
    }
  };
}

function isTLS(config: MasterExpressConfig): boolean {
  const { keyPath, crtPath, tlsKey, tlsCert, tlsMode } = config;
  if (tlsMode === TlsMode.DISABLED) return false;
  return Boolean((keyPath && crtPath) || (tlsKey && tlsCert));
}

async function createHttpsServer(
  app: express.Application,
  config: MasterExpressConfig,
): Promise<https.Server> {
  const { tlsKey, tlsCert, tlsMode, mtlsRequestCert } = config;

  if (!tlsKey || !tlsCert) {
    throw new Error('TLS key and certificate must be provided for HTTPS server');
  }

  const httpsOptions: https.ServerOptions = {
    secureOptions: SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1,
    key: tlsKey,
    cert: tlsCert,
    // Only request cert if mTLS is enabled AND we want to request certs
    // This prevents TLS handshake failures when no cert is provided
    requestCert: tlsMode === TlsMode.MTLS && mtlsRequestCert,
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
  logger.debug('master express app is initializing');

  const app = express();

  setupLogging(app, cfg);
  logger.debug('logging setup');

  setupCommonMiddleware(app, cfg);

  // Add mTLS middleware before routes if in mTLS mode
  if (cfg.tlsMode === TlsMode.MTLS) {
    app.use(createMtlsMiddleware(cfg));
  }

  // Setup master express routes
  setupRoutes(app, cfg);
  setupRoutes(app, cfg);

  // Add error handler
  app.use(createErrorHandler());

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
