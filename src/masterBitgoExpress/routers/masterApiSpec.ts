import * as t from 'io-ts';
import {
  apiSpec,
  httpRoute,
  httpRequest,
  HttpResponse,
  Method as HttpMethod,
} from '@api-ts/io-ts-http';
import {
  createRouter,
  TypedRequestHandler,
  type WrappedRouter,
} from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import express from 'express';
import { BitGoRequest } from '../../types/request';
import { MasterExpressConfig } from '../../config';
import { handleGenerateWalletOnPrem } from '../generateWallet';
import { prepareBitGo, responseHandler } from '../../shared/middleware';

// Middleware functions
export function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  req.headers['content-type'] = req.headers['content-type'] || 'application/json';
  return express.json({ limit: '20mb' })(req, res, next);
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

export type MasterApiSpec = typeof MasterApiSpec;

export type MasterApiSpecRouteHandler<
  ApiName extends keyof MasterApiSpec,
  Method extends keyof MasterApiSpec[ApiName] & HttpMethod,
> = TypedRequestHandler<MasterApiSpec, ApiName, Method>;

export type MasterApiSpecRouteRequest<
  ApiName extends keyof MasterApiSpec,
  Method extends keyof MasterApiSpec[ApiName] & HttpMethod,
> = BitGoRequest & Parameters<MasterApiSpecRouteHandler<ApiName, Method>>[0];

export type GenericMasterApiSpecRouteRequest = MasterApiSpecRouteRequest<any, any>;

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
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleGenerateWalletOnPrem(typedReq);
      return Response.ok(result);
    }),
  ]);

  return router;
}
