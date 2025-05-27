/**
 * @prettier
 */
import express from 'express';
import debug from 'debug';
import https from 'https';
import http from 'http';
import morgan from 'morgan';
import { SSL_OP_NO_TLSv1 } from 'constants';

import { EnclavedConfig, config, TlsMode, isEnclavedConfig } from './config';
import * as routes from './routes';
import {
  setupLogging,
  setupDebugNamespaces,
  setupCommonMiddleware,
  createErrorHandler,
  createHttpServer,
  configureServerTimeouts,
  prepareIpc,
  readCertificates,
} from './shared/appUtils';

const debugLogger = debug('enclaved:express');

/**
 * Create a startup function which will be run upon server initialization
 */
export function startup(config: EnclavedConfig, baseUri: string): () => void {
  return function () {
    /* eslint-disable no-console */
    console.log('BitGo Enclaved Express running');
    console.log(`Base URI: ${baseUri}`);
    console.log(`TLS Mode: ${config.tlsMode}`);
    console.log(`mTLS Enabled: ${config.tlsMode === TlsMode.MTLS}`);
    console.log(`Request Client Cert: ${config.mtlsRequestCert}`);
    console.log(`Reject Unauthorized: ${config.mtlsRejectUnauthorized}`);
    /* eslint-enable no-console */
  };
}

function isTLS(config: EnclavedConfig): boolean {
  const { keyPath, crtPath, tlsKey, tlsCert, tlsMode } = config;
  console.log('TLS Configuration:', {
    tlsMode,
    hasKeyPath: Boolean(keyPath),
    hasCrtPath: Boolean(crtPath),
    hasTlsKey: Boolean(tlsKey),
    hasTlsCert: Boolean(tlsCert),
  });
  if (tlsMode === TlsMode.DISABLED) return false;
  return Boolean((keyPath && crtPath) || (tlsKey && tlsCert));
}

async function createHttpsServer(
  app: express.Application,
  config: EnclavedConfig,
): Promise<https.Server> {
  const { keyPath, crtPath, tlsKey, tlsCert, tlsMode, mtlsRequestCert, mtlsRejectUnauthorized } =
    config;
  let key: string;
  let cert: string;

  if (tlsKey && tlsCert) {
    key = tlsKey;
    cert = tlsCert;
    console.log('Using TLS key and cert from environment variables');
  } else if (keyPath && crtPath) {
    const certificates = await readCertificates(keyPath, crtPath);
    key = certificates.key;
    cert = certificates.cert;
    console.log(`Using TLS key and cert from files: ${keyPath}, ${crtPath}`);
  } else {
    throw new Error('Failed to get TLS key and certificate');
  }

  const httpsOptions: https.ServerOptions = {
    secureOptions: SSL_OP_NO_TLSv1,
    key,
    cert,
    // Add mTLS options if in mTLS mode
    requestCert: tlsMode === TlsMode.MTLS && mtlsRequestCert,
    rejectUnauthorized: tlsMode === TlsMode.MTLS && mtlsRejectUnauthorized,
  };

  const server = https.createServer(httpsOptions, app);

  // Add middleware to validate client certificate fingerprints if in mTLS mode
  if (tlsMode === TlsMode.MTLS && config.mtlsAllowedClientFingerprints?.length) {
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      const clientCert = (req as any).socket?.getPeerCertificate();
      if (!clientCert) {
        return res.status(403).json({ error: 'Client certificate required' });
      }

      const fingerprint = clientCert.fingerprint256?.replace(/:/g, '').toUpperCase();
      if (!fingerprint || !config.mtlsAllowedClientFingerprints?.includes(fingerprint)) {
        return res.status(403).json({ error: 'Invalid client certificate fingerprint' });
      }

      // Store client certificate info for logging
      (req as any).clientCert = clientCert;
      next();
    });
  }

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
  const tls = isTLS(config);
  const isStandardPort = (port === 80 && !tls) || (port === 443 && tls);
  return `http${tls ? 's' : ''}://${bind}${!isStandardPort ? ':' + port : ''}`;
}

/**
 * Create and configure the express application
 */
export function app(cfg: EnclavedConfig): express.Application {
  debugLogger('app is initializing');

  const app = express();

  setupLogging(app, cfg);
  debugLogger('logging setup');

  // Add custom morgan token for mTLS client certificate
  morgan.token('remote-user', function (req: express.Request) {
    return (req as any).clientCert ? (req as any).clientCert.subject.CN : 'unknown';
  });

  setupDebugNamespaces(cfg.debugNamespace);
  setupCommonMiddleware(app, cfg);

  // Setup routes
  routes.setupRoutes(app);

  // Add error handler
  app.use(createErrorHandler(debugLogger));

  return app;
}

export async function init(): Promise<void> {
  const cfg = config();

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
