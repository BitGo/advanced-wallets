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
import { BitGoRequest, isBitGoRequest } from '../../types/request';
import { MasterExpressConfig } from '../../config';
import { handleGenerateWalletOnPrem } from '../generateWallet';
import { prepareBitGo, responseHandler } from '../../shared/middleware';
import { handleSendMany } from '../handleSendMany';

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

export const SendManyRequest = t.intersection([
  t.type({
    pubkey: t.string,
    source: t.union([t.literal('user'), t.literal('backup')]),
    recipients: t.array(
      t.type({
        address: t.string,
        amount: t.union([t.string, t.number]),
        feeLimit: t.union([t.undefined, t.string]),
        data: t.union([t.undefined, t.string]),
        tokenName: t.union([t.undefined, t.string]),
        tokenData: t.union([t.undefined, t.any]),
      }),
    ),
  }),
  t.partial({
    numBlocks: t.number,
    feeRate: t.number,
    feeMultiplier: t.number,
    maxFeeRate: t.number,
    minConfirms: t.number,
    enforceMinConfirmsForChange: t.boolean,
    targetWalletUnspents: t.number,
    message: t.string,
    minValue: t.union([t.number, t.string]),
    maxValue: t.union([t.number, t.string]),
    sequenceId: t.string,
    lastLedgerSequence: t.number,
    ledgerSequenceDelta: t.number,
    gasPrice: t.number,
    noSplitChange: t.boolean,
    unspents: t.array(t.string),
    comment: t.string,
    otp: t.string,
    changeAddress: t.string,
    allowExternalChangeAddress: t.boolean,
    instant: t.boolean,
    memo: t.string,
    transferId: t.number,
    eip1559: t.any,
    gasLimit: t.number,
    custodianTransactionId: t.string,
  }),
]);

export const SendManyResponse: HttpResponse = {
  // TODO: Get type from public types repo / Wallet Platform
  200: t.any,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
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
  'v1.wallet.sendMany': {
    post: httpRoute({
      method: 'POST',
      path: '/{coin}/wallet/{walletId}/sendMany',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
        },
        body: SendManyRequest,
      }),
      response: SendManyResponse,
      description: 'Send many transactions',
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

  router.post('v1.wallet.sendMany', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleSendMany(typedReq);
      return Response.ok(result);
    }),
  ]);

  return router;
}
