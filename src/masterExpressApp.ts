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
  setupCommonMiddleware,
  createErrorHandler,
  createHttpServer,
  configureServerTimeouts,
  prepareIpc,
  setupHealthCheckRoutes,
  createMtlsMiddleware,
} from './shared/appUtils';
import bodyParser from 'body-parser';
import { promiseWrapper } from './routes';
import pjson from '../package.json';
import { handleGenerateWalletOnPrem } from './masterBitgoExpress/generateWallet';
import logger from './logger';
import { handleWalletRecovery } from './masterBitgoExpress/recoverWallet';

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
      etherscanApiToken: req.body.etherscanApiToken,
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
 * Setup master express specific routes
 */
function setupMasterExpressRoutes(app: express.Application, cfg: MasterExpressConfig): void {
  // Setup common health check routes
  setupHealthCheckRoutes(app, 'master express');

  // Add enclaved express ping route
  app.post('/ping/enclavedExpress', async (req, res) => {
    try {
      logger.debug('Pinging enclaved express');

      // Use Master Express's own certificate as client cert when connecting to Enclaved Express
      const httpsAgent = new https.Agent({
        rejectUnauthorized: cfg.tlsMode === TlsMode.MTLS && !cfg.allowSelfSigned,
        ca: cfg.enclavedExpressCert,
        // Provide client certificate for mTLS
        key: cfg.tlsKey,
        cert: cfg.tlsCert,
      });

      const response = await superagent
        .post(`${cfg.enclavedExpressUrl}/ping`)
        .ca(cfg.enclavedExpressCert)
        .agent(httpsAgent)
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
    prepareBitGo(cfg),
    promiseWrapper(handleGenerateWalletOnPrem),
  );

  app.post(
    '/api/:coin/wallet/recovery',
    parseBody,
    prepareBitGo(cfg),
    promiseWrapper(handleWalletRecovery),
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

  setupCommonMiddleware(app, cfg);

  // Add mTLS middleware before routes if in mTLS mode
  if (cfg.tlsMode === TlsMode.MTLS) {
    app.use(createMtlsMiddleware(cfg));
  }

  // Setup master express routes
  setupMasterExpressRoutes(app, cfg);

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
