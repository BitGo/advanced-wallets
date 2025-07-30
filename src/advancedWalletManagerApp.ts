import express from 'express';
import https from 'https';
import http from 'http';
import morgan from 'morgan';
import { SSL_OP_NO_TLSv1, SSL_OP_NO_TLSv1_1 } from 'constants';

import {
  AdvancedWalletManagerConfig,
  TlsMode,
  isAdvancedWalletManagerConfig,
} from './shared/types';
import { initConfig } from './initConfig';
import { setupRoutes } from './routes/advancedWalletManager';
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
export function startup(config: AdvancedWalletManagerConfig, baseUri: string): () => void {
  return () => {
    logger.info('Advanced Wallet Manager server starting...');
    logger.info(`Base URI: ${baseUri}`);
    logger.info(`mTLS Mode: ${config.tlsMode}`);
    if (config.tlsMode === TlsMode.MTLS && config.mtlsAllowedClientFingerprints) {
      logger.info(
        `Allowed client certificate fingerprints: ${config.mtlsAllowedClientFingerprints.join(
          ', ',
        )}`,
      );
    }
    logger.info('Advanced Wallet Manager server started successfully');
  };
}

function isTLS(config: AdvancedWalletManagerConfig): boolean {
  const { keyPath, crtPath, tlsKey, tlsCert, tlsMode } = config;
  if (tlsMode === TlsMode.DISABLED) return false;
  return Boolean((keyPath && crtPath) || (tlsKey && tlsCert));
}

async function createHttpsServer(
  app: express.Application,
  config: AdvancedWalletManagerConfig,
): Promise<https.Server> {
  const { tlsKey, tlsCert, tlsMode } = config;

  if (!tlsKey || !tlsCert) {
    throw new Error('TLS key and certificate must be provided for HTTPS server');
  }

  const httpsOptions: https.ServerOptions = {
    secureOptions: SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1,
    key: tlsKey,
    cert: tlsCert,
    // Always request cert if mTLS is enabled
    requestCert: tlsMode === TlsMode.MTLS,
    rejectUnauthorized: false, // Handle authorization in middleware
  };

  const server = https.createServer(httpsOptions, app);

  return server;
}

export async function createServer(
  config: AdvancedWalletManagerConfig,
  app: express.Application,
): Promise<https.Server | http.Server> {
  const server = isTLS(config) ? await createHttpsServer(app, config) : createHttpServer(app);
  configureServerTimeouts(server, config);
  return server;
}

export function createBaseUri(config: AdvancedWalletManagerConfig): string {
  const { bind, port } = config;
  const tls = config.tlsMode === TlsMode.MTLS;
  const isStandardPort = (port === 80 && !tls) || (port === 443 && tls);
  return `http${tls ? 's' : ''}://${bind}${!isStandardPort ? ':' + port : ''}`;
}

/**
 * The main application function. This is the entry point for the application.
 * It is responsible for initializing the application and starting the server.
 *
 * It is called from the main entry point of the application in `src/app.ts`.
 *
 * This application only supports advanced wallet manager mode.
 * The application will throw an error if the appMode is not `AppMode.ADVANCED_WALLET_MANAGER`.
 *
 * @param cfg The configuration object for the application
 * @returns An express application
 */
export function app(cfg: AdvancedWalletManagerConfig): express.Application {
  // Type-safe validation that we're in advanced wallet manager mode
  if (!isAdvancedWalletManagerConfig(cfg)) {
    throw new Error(
      `This application only supports advanced wallet manager mode. Current mode: ${cfg.appMode}. Set APP_MODE=advanced-wallet-manager to use this application.`,
    );
  }

  const expressApp = express();
  setupLogging(expressApp, cfg);

  // Add custom morgan token for mTLS client certificate
  morgan.token('client-cert', (req: any) => {
    const cert = req.socket.getPeerCertificate();
    if (cert && Object.keys(cert).length) {
      return JSON.stringify({
        subject: cert.subject,
        fingerprint: cert.fingerprint,
      });
    }
    return 'No client certificate provided';
  });

  setupCommonMiddleware(expressApp, cfg);

  // Add mTLS middleware before routes if in mTLS mode
  if (cfg.tlsMode === TlsMode.MTLS) {
    expressApp.use(createMtlsMiddleware(cfg));
  }

  // Setup routes
  setupRoutes(expressApp, cfg);

  // Add error handler
  expressApp.use(createErrorHandler());

  return expressApp;
}

export async function init(): Promise<void> {
  const cfg = initConfig();

  // Type-safe validation that we're in advanced wallet manager mode
  if (!isAdvancedWalletManagerConfig(cfg)) {
    throw new Error(
      `This application only supports advanced wallet manager mode. Current mode: ${cfg.appMode}. Set APP_MODE=advanced-wallet-manager to use this application.`,
    );
  }

  const advancedWalletManagerApp = app(cfg);
  const server = await createServer(cfg, advancedWalletManagerApp);
  const { port, bind, ipc } = cfg;
  const baseUri = createBaseUri(cfg);

  if (ipc) {
    await prepareIpc(ipc);
    server.listen(ipc, startup(cfg, baseUri));
  } else {
    server.listen(port, bind, startup(cfg, baseUri));
  }
}
