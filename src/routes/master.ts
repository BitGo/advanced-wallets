import express from 'express';
import superagent from 'superagent';
import https from 'https';
import { BitGo, BitGoOptions } from 'bitgo';
import { BitGoBase } from '@bitgo/sdk-core';
import { version } from 'bitgo/package.json';
import pjson from '../../package.json';
import { MasterExpressConfig, TlsMode } from '../config';
import { BitGoRequest } from '../types/request';
import { handleGenerateWalletOnPrem } from '../masterBitgoExpress/generateWallet';
import { setupHealthCheckRoutes } from '../shared/appUtils';
import { promiseWrapper } from './utils';
import logger from '../logger';

const BITGOEXPRESS_USER_AGENT = `BitGoExpress/${pjson.version} BitGoJS/${version}`;

/**
 * Perform body parsing here only on routes we want
 */
function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Set the default Content-Type, in case the client doesn't set it.  If
  // Content-Type isn't specified, Express silently refuses to parse the
  // request body.
  req.headers['content-type'] = req.headers['content-type'] || 'application/json';
  return express.json({ limit: '20mb' })(req, res, next);
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

/**
 * Setup master express specific routes
 */
export function setupRoutes(app: express.Application, cfg: MasterExpressConfig): void {
  // Setup common health check routes
  setupHealthCheckRoutes(app, 'master express');

  // Add enclaved express ping route
  app.post('/ping/enclavedExpress', async (req, res) => {
    try {
      logger.debug('Pinging enclaved express');

      let response;
      if (cfg.tlsMode === TlsMode.MTLS) {
        // Use Master Express's own certificate as client cert when connecting to Enclaved Express
        const httpsAgent = new https.Agent({
          rejectUnauthorized: !cfg.allowSelfSigned,
          ca: cfg.enclavedExpressCert,
          // Provide client certificate for mTLS
          key: cfg.tlsKey,
          cert: cfg.tlsCert,
        });

        response = await superagent
          .post(`${cfg.enclavedExpressUrl}/ping`)
          .ca(cfg.enclavedExpressCert)
          .agent(httpsAgent)
          .send();
      } else {
        // When TLS is disabled, use plain HTTP without any TLS configuration
        response = await superagent.post(`${cfg.enclavedExpressUrl}/ping`).send();
      }

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

  // Add a catch-all for unsupported routes
  app.use('*', (_req, res) => {
    res.status(404).json({
      error: 'Route not found or not supported in master express mode',
    });
  });

  logger.debug('Master express routes configured');
}
