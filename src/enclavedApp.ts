import express from 'express';
import https from 'https';
import http from 'http';
import morgan from 'morgan';
import { SSL_OP_NO_TLSv1, SSL_OP_NO_TLSv1_1 } from 'constants';

import { EnclavedConfig, initConfig, TlsMode, isEnclavedConfig } from './initConfig';
import { setupRoutes } from './routes/enclaved';
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

/**
 * Create a startup function which will be run upon server initialization
 */
export function startup(config: EnclavedConfig, baseUri: string): () => void {
  return function () {
    logger.info('BitGo Enclaved Express running');
    logger.info(`Base URI: ${baseUri}`);
    logger.info(`TLS Mode: ${config.tlsMode}`);
    logger.info(`mTLS Enabled: ${config.tlsMode === TlsMode.MTLS}`);
    logger.info(`Request Client Cert: ${config.mtlsRequestCert}`);
    logger.info(`Allow Self-Signed: ${config.allowSelfSigned}`);
    logger.info(`KMS URL: ${config.kmsUrl}`);
    if (config.mtlsAllowedClientFingerprints?.length) {
      logger.info(
        `Allowed Client Fingerprints: ${config.mtlsAllowedClientFingerprints.length} configured`,
      );
    }
  };
}

function isTLS(config: EnclavedConfig): boolean {
  const { keyPath, crtPath, tlsKey, tlsCert, tlsMode } = config;
  if (tlsMode === TlsMode.DISABLED) return false;
  return Boolean((keyPath && crtPath) || (tlsKey && tlsCert));
}

async function createHttpsServer(
  app: express.Application,
  config: EnclavedConfig,
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
  config: EnclavedConfig,
  app: express.Application,
): Promise<https.Server | http.Server> {
  const server = isTLS(config) ? await createHttpsServer(app, config) : createHttpServer(app);
  configureServerTimeouts(server, config);
  return server;
}

export function createBaseUri(config: EnclavedConfig): string {
  const { bind, port } = config;
  const tls = config.tlsMode === TlsMode.MTLS;
  const isStandardPort = (port === 80 && !tls) || (port === 443 && tls);
  return `http${tls ? 's' : ''}://${bind}${!isStandardPort ? ':' + port : ''}`;
}

/**
 * Create and configure the express application
 */
export function app(cfg: EnclavedConfig): express.Application {
  logger.debug('app is initializing');

  const app = express();

  setupLogging(app, cfg);
  logger.debug('logging setup');

  // Add custom morgan token for mTLS client certificate
  morgan.token('remote-user', function (req: express.Request) {
    return (req as any).clientCert ? (req as any).clientCert.subject.CN : 'unknown';
  });

  setupCommonMiddleware(app, cfg);

  // Add mTLS middleware before routes if in mTLS mode
  if (cfg.tlsMode === TlsMode.MTLS) {
    app.use(createMtlsMiddleware(cfg));
  }

  // Setup routes
  setupRoutes(app, cfg);

  // Add error handler
  app.use(createErrorHandler());

  return app;
}

export async function init(): Promise<void> {
  const cfg = initConfig();

  // Type-safe validation that we're in enclaved mode
  if (!isEnclavedConfig(cfg)) {
    throw new Error(
      `This application only supports enclaved mode. Current mode: ${cfg.appMode}. Set APP_MODE=enclaved to use this application.`,
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
