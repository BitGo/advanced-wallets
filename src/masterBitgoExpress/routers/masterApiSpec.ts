import * as t from 'io-ts';
import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import express, { Request } from 'express';
import { BitGo } from 'bitgo';
import { BitGoRequest, isBitGoRequest } from '../../types/request';
import { MasterExpressConfig } from '../../config';
import { handleGenerateWalletOnPrem } from '../generateWallet';
import { withResponseHandler } from '../../shared/responseHandler';

// Middleware functions
export function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  req.headers['content-type'] = req.headers['content-type'] || 'application/json';
  return express.json({ limit: '20mb' })(req, res, next);
}

export function prepareBitGo(config: MasterExpressConfig) {
  const { env, customRootUri } = config;
  const BITGOEXPRESS_USER_AGENT = `BitGoExpress/${process.env.npm_package_version}`;

  return function prepBitGo(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
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

    const bitgoConstructorParams = {
      env,
      customRootURI: customRootUri,
      accessToken,
      userAgent,
    };

    (req as BitGoRequest).bitgo = new BitGo(bitgoConstructorParams);
    (req as BitGoRequest).config = config;

    next();
  };
}

// Response type for /generate endpoint
const GenerateWalletResponse: HttpResponse = {
  // TODO: Get type from public types repo
  200: t.any,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// Request type for /generate endpoint
const GenerateWalletRequest = {
  label: t.string,
  multisigType: t.union([t.undefined, t.literal('onchain'), t.literal('tss')]),
  enterprise: t.string,
  disableTransactionNotifications: t.union([t.undefined, t.boolean]),
  isDistributedCustody: t.union([t.undefined, t.boolean]),
};

// API Specification
export const MasterApiSpec = apiSpec({
  'v1.wallet.generate': {
    post: httpRoute({
      method: 'POST',
      path: '/{coin}/wallet/generate',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: GenerateWalletRequest,
      }),
      response: GenerateWalletResponse,
      description: 'Generate a new wallet',
    }),
  },
});

// Create router with handlers
export function createMasterApiRouter(
  cfg: MasterExpressConfig,
): WrappedRouter<typeof MasterApiSpec> {
  const router = createRouter(MasterApiSpec);

  // Add middleware to all routes
  router.use(parseBody);
  router.use(prepareBitGo(cfg));

  // Generate wallet endpoint handler
  router.post('v1.wallet.generate', [
    withResponseHandler(async (req: BitGoRequest | Request) => {
      if (!isBitGoRequest(req)) {
        throw new Error('Invalid request type');
      }
      const result = await handleGenerateWalletOnPrem(req);
      return Response.ok(result);
    }),
  ]);

  return router;
}
