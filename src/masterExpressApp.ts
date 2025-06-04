import express from 'express';
import https from 'https';
import http from 'http';
import superagent from 'superagent';
import { BitGo, BitGoOptions } from 'bitgo';
import { BitGoBase } from '@bitgo/sdk-core';
import { version } from 'bitgo/package.json';
import { SSL_OP_NO_TLSv1, SSL_OP_NO_TLSv1_1 } from 'constants';

import { MasterExpressConfig, config, isMasterExpressConfig, TlsMode } from './config';
import { BitGoRequest } from './types/request';
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
import bodyParser from 'body-parser';
import { promiseWrapper } from './routes';
import pjson from '../package.json';
import { handleGenerateWalletOnPrem } from './masterBitgoExpress/generateWallet';
import logger from './logger';

const BITGOEXPRESS_USER_AGENT = `BitGoExpress/${pjson.version} BitGoJS/${version}`;

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
  };
}

function isTLS(config: MasterExpressConfig): boolean {
  const { keyPath, crtPath, tlsKey, tlsCert, tlsMode } = config;
  logger.debug('TLS Configuration:', {
    tlsMode,
    hasKeyPath: Boolean(keyPath),
    hasCrtPath: Boolean(crtPath),
    hasTlsKey: Boolean(tlsKey),
    hasTlsCert: Boolean(tlsCert),
  });
  if (tlsMode === TlsMode.DISABLED) return false;
  return Boolean((keyPath && crtPath) || (tlsKey && tlsCert));
}

const expressJSONParser = bodyParser.json({ limit: '20mb' });

/**
 * Perform body parsing here only on routes we want
 */
function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Set the default Content-Type, in case the client doesn't set it.  If
  // Content-Type isn't specified, Express silently refuses to parse the
  // request body.
  req.headers['content-type'] = req.headers['content-type'] || 'application/json';
  return expressJSONParser(req, res, next);
}

/**
 * Create the bitgo object in the request
 * @param config
 */
function prepareBitGo(config: MasterExpressConfig) {
  const { env, customRootUri } = config;

  return function prepBitGo(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    // Get access token
    let accessToken;
    if (req.headers.authorization) {
      const authSplit = req.headers.authorization.split(' ');
      if (authSplit.length === 2 && authSplit[0].toLowerCase() === 'bearer') {
        accessToken = authSplit[1];
      }
    }
    const userAgent = req.headers['user-agent']
      ? BITGOEXPRESS_USER_AGENT + ' ' + req.headers['user-agent']
      : BITGOEXPRESS_USER_AGENT;

    const bitgoConstructorParams: BitGoOptions = {
      env,
      customRootURI: customRootUri,
      accessToken,
      userAgent,
    };

    (req as BitGoRequest).bitgo = new BitGo(bitgoConstructorParams) as unknown as BitGoBase;
    (req as BitGoRequest).config = config;

    next();
  };
}

async function createHttpsServer(
  app: express.Application,
  config: MasterExpressConfig,
): Promise<https.Server> {
  const { keyPath, crtPath, tlsKey, tlsCert, tlsMode, mtlsRequestCert } = config;
  let key: string;
  let cert: string;

  if (tlsKey && tlsCert) {
    key = tlsKey;
    cert = tlsCert;
    logger.info('Using TLS key and cert from environment variables');
  } else if (keyPath && crtPath) {
    const certificates = await readCertificates(keyPath, crtPath);
    key = certificates.key;
    cert = certificates.cert;
    logger.info(`Using TLS key and cert from files: ${keyPath}, ${crtPath}`);
  } else {
    throw new Error('Failed to get TLS key and certificate');
  }

  const httpsOptions: https.ServerOptions = {
    secureOptions: SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1,
    key,
    cert,
    // Add mTLS options if in mTLS mode
    requestCert: tlsMode === TlsMode.MTLS && mtlsRequestCert,
    rejectUnauthorized: tlsMode === TlsMode.MTLS,
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
 * Setup master express specific routes
 */
function setupMasterExpressRoutes(app: express.Application): void {
  // Setup common health check routes
  setupHealthCheckRoutes(app, 'master express');

  const cfg = config() as MasterExpressConfig;
  logger.debug('TLS Configuration:', {
    tlsMode: cfg.tlsMode,
    enclavedExpressUrl: cfg.enclavedExpressUrl,
    hasCertificate: Boolean(cfg.enclavedExpressCert),
    certificateLength: cfg.enclavedExpressCert.length,
  });

  // Add enclaved express ping route
  app.post('/ping/enclavedExpress', async (req, res) => {
    try {
      logger.debug('Pinging enclaved express');

      const response = await superagent
        .get(`${cfg.enclavedExpressUrl}/ping`)
        .ca(cfg.enclavedExpressCert)
        .agent(
          new https.Agent({
            rejectUnauthorized: cfg.tlsMode === TlsMode.MTLS,
            ca: cfg.enclavedExpressCert,
          }),
        )
        .send();

      res.json({
        status: 'Successfully pinged enclaved express',
        enclavedResponse: response.body,
      });
    } catch (error) {
      logger.error('Failed to ping enclaved express:', { error });
      res.status(500).json({
        error: 'Failed to ping enclaved express',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // TODO: Add api-ts to these new API routes
  app.post(
    '/api/:coin/wallet/generate',
    parseBody,
    prepareBitGo(config() as MasterExpressConfig),
    promiseWrapper(handleGenerateWalletOnPrem),
  );

  // Add a catch-all for unsupported routes
  app.use('*', (_req, res) => {
    res.status(404).json({
      error: 'Route not found or not supported in master express mode',
    });
  });

  logger.debug('Master express routes configured');
}

/**
 * Create and configure the express application for master express mode
 */
export function app(cfg: MasterExpressConfig): express.Application {
  logger.debug('master express app is initializing');

  const app = express();

  setupLogging(app, cfg);
  logger.debug('logging setup');

  setupDebugNamespaces(cfg.debugNamespace);
  setupCommonMiddleware(app, cfg);

  // Setup master express routes
  setupMasterExpressRoutes(app);

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
