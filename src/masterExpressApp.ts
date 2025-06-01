/**
 * @prettier
 */
import express from 'express';
import debug from 'debug';
import https from 'https';
import http from 'http';
import superagent from 'superagent';
import bodyParser from 'body-parser';

import {
  createServer as createExpressApp,
  routeHandler,
  ServiceFunction,
} from '@api-ts/express-wrapper';
import { Response } from '@api-ts/response';
import { BitGo, BitGoOptions } from 'bitgo';
import { BitGoBase } from '@bitgo/sdk-core';
import { version } from 'bitgo/package.json';

import { MasterExpressConfig, config, isMasterExpressConfig } from './config';
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
} from './shared/appUtils';
import { ProxyAgent } from 'proxy-agent';
import pjson from '../package.json';
import { generateMultiSigOnPremWallet } from './masterBitgoExpress/generateWallet';
import { MasterExpressApi, EnclavedPingResponse, GenerateWalletRequest } from './masterExpressApi';

const debugLogger = debug('master-express:express');
const BITGOEXPRESS_USER_AGENT = `BitGoExpress/${pjson.version} BitGoJS/${version}`;

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
// TODO update to use in middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

    const useProxyUrl = process.env.BITGO_USE_PROXY;
    const bitgoConstructorParams: BitGoOptions = {
      env,
      customRootURI: customRootUri,
      accessToken,
      userAgent,
      ...(useProxyUrl
        ? {
            customProxyAgent: new ProxyAgent({
              getProxyForUrl: () => useProxyUrl,
            }),
          }
        : {}),
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

const handlePingEnclavedExpress = async () => {
  const cfg = config() as MasterExpressConfig;
  try {
    console.log('Pinging enclaved express');

    const response = await superagent
      .post(`${cfg.enclavedExpressUrl}/ping`)
      .ca(cfg.enclavedExpressSSLCert)
      .agent(
        new https.Agent({
          rejectUnauthorized: cfg.enableSSL,
          ca: cfg.enclavedExpressSSLCert,
        }),
      )
      .send();

    return Response.ok({
      status: 'Successfully pinged enclaved express',
      enclavedResponse: response.body as EnclavedPingResponse,
    });
  } catch (error) {
    debugLogger('Failed to ping enclaved express:', error);
    return Response.internalError({
      error: 'Failed to ping enclaved express',
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

// Add a new handler for wallet generation
const handleGenerateWallet: ServiceFunction<typeof GenerateWalletRequest> = async ({
  coin,
  enterprise,
  label,
  Authorization,
  multiSigType,
  'user-agent': userAgent,
}) => {
  try {
    const cfg = config() as MasterExpressConfig;

    // Create BitGo instance using request parameters
    const bitgo = new BitGo({
      env: cfg.env,
      customRootURI: cfg.customRootUri,
      accessToken: Authorization?.startsWith('Bearer ') ? Authorization.substring(7) : undefined,
      userAgent: userAgent ? BITGOEXPRESS_USER_AGENT + ' ' + userAgent : BITGOEXPRESS_USER_AGENT,
    });

    switch (multiSigType) {
      case 'onchain': {
        // Call the existing implementation
        return Response.ok(
          await generateMultiSigOnPremWallet({
            bitgo,
            params: {
              coin,
              label,
              enterprise,
            },
          }),
        );
      }
      default:
        return Response.notImplemented({
          error: `Not Implemented for ${multiSigType}`,
          details: undefined,
        });
    }
  } catch (error) {
    debugLogger('Failed to generate wallet:', error);
    if (error instanceof Error && error.message.includes('Bad Request')) {
      return Response.invalidRequest({
        error: 'Failed to generate wallet',
        details: error.message,
      });
    }
    return Response.internalError({
      error: 'Failed to generate wallet',
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Create and configure the express application for master express mode
 */
export function app(cfg: MasterExpressConfig): express.Application {
  debugLogger('master express app is initializing');

  console.log('SSL Enabled:', cfg.enableSSL);
  console.log('Enclaved Express URL:', cfg.enclavedExpressUrl);
  console.log('Certificate exists:', Boolean(cfg.enclavedExpressSSLCert));
  console.log('Certificate length:', cfg.enclavedExpressSSLCert.length);
  console.log('Certificate content:', cfg.enclavedExpressSSLCert);

  const app = createExpressApp(MasterExpressApi, (app) => {
    app.use(parseBody);
    return {
      'api.v1.health.pingMasterExpress': {
        post: routeHandler({
          handler: () =>
            Response.ok({
              status: 'Master Express server is ok',
              timeStamp: new Date().toISOString(),
            }),
        }),
      },
      'api.v1.health.getVersion': {
        get: routeHandler({
          handler: () =>
            Response.ok({
              version: pjson.version,
              name: pjson.name,
            }),
        }),
      },
      'api.v1.pingEnclavedExpress': {
        post: routeHandler({
          handler: handlePingEnclavedExpress,
        }),
      },
      'api.v1.generateWallet': {
        post: routeHandler({
          handler: handleGenerateWallet,
        }),
      },
    };
  });

  debugLogger('Master express routes configured');

  setupLogging(app, cfg);
  debugLogger('logging setup');

  setupDebugNamespaces(cfg.debugNamespace);
  setupCommonMiddleware(app, cfg);

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
