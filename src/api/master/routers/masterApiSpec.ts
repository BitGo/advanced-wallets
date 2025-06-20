import {
  apiSpec,
  Method as HttpMethod,
  httpRequest,
  HttpResponse,
  httpRoute,
} from '@api-ts/io-ts-http';
import { Response } from '@api-ts/response';
import {
  createRouter,
  TypedRequestHandler,
  type WrappedRouter,
} from '@api-ts/typed-express-router';
import express from 'express';
import * as t from 'io-ts';
import { MasterExpressConfig } from '../../../shared/types';
import { prepareBitGo, responseHandler } from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';
import { handleGenerateWalletOnPrem } from '../handlers/generateWallet';
import { handleSendMany } from '../handlers/handleSendMany';
import { validateMasterExpressConfig } from '../middleware/middleware';
import { handleRecoveryWalletOnPrem } from '../handlers/recoveryWallet';

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

export const SendManyRequest = {
  pubkey: t.string,
  source: t.union([t.literal('user'), t.literal('backup')]),
  recipients: t.array(t.any),
  numBlocks: t.union([t.undefined, t.number]),
  feeRate: t.union([t.undefined, t.number]),
  feeMultiplier: t.union([t.undefined, t.number]),
  maxFeeRate: t.union([t.undefined, t.number]),
  minConfirms: t.union([t.undefined, t.number]),
  enforceMinConfirmsForChange: t.union([t.undefined, t.boolean]),
  targetWalletUnspents: t.union([t.undefined, t.number]),
  message: t.union([t.undefined, t.string]),
  minValue: t.union([t.undefined, t.union([t.number, t.string])]),
  maxValue: t.union([t.undefined, t.union([t.number, t.string])]),
  sequenceId: t.union([t.undefined, t.string]),
  lastLedgerSequence: t.union([t.undefined, t.number]),
  ledgerSequenceDelta: t.union([t.undefined, t.number]),
  gasPrice: t.union([t.undefined, t.number]),
  noSplitChange: t.union([t.undefined, t.boolean]),
  unspents: t.union([t.undefined, t.array(t.string)]),
  comment: t.union([t.undefined, t.string]),
  otp: t.union([t.undefined, t.string]),
  changeAddress: t.union([t.undefined, t.string]),
  allowExternalChangeAddress: t.union([t.undefined, t.boolean]),
  instant: t.union([t.undefined, t.boolean]),
  memo: t.union([t.undefined, t.string]),
  transferId: t.union([t.undefined, t.number]),
  eip1559: t.union([t.undefined, t.any]),
  gasLimit: t.union([t.undefined, t.number]),
  custodianTransactionId: t.union([t.undefined, t.string]),
};

export const SendManyResponse: HttpResponse = {
  // TODO: Get type from public types repo / Wallet Platform
  200: t.any,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// Response type for /recovery endpoint
const RecoveryWalletResponse: HttpResponse = {
  // TODO: Get type from public types repo
  200: t.type({
    txHex: t.string, // the full signed transaction hex
  }),
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// Request type for /recovery endpoint
const RecoveryWalletRequest = {
  userPub: t.string,
  backupPub: t.string,
  walletContractAddress: t.string,
  recoveryDestinationAddress: t.string,
  apiKey: t.string,
  coinSpecificParams: t.union([
    t.undefined,
    t.partial({
      bitgoPub: t.union([t.undefined, t.string]),
      ignoreAddressTypes: t.union([t.undefined, t.array(t.string)]),
    }),
  ]),
};

// API Specification
export const MasterApiSpec = apiSpec({
  'v1.wallet.generate': {
    post: httpRoute({
      method: 'POST' as const,
      path: '/api/{coin}/wallet/generate',
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
      path: '/api/{coin}/wallet/{walletId}/sendMany',
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
  'v1.wallet.recovery': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/recovery',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: RecoveryWalletRequest,
      }),
      response: RecoveryWalletResponse,
      description: 'Recover an existing wallet',
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
  router.use(validateMasterExpressConfig);

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

  router.post('v1.wallet.recovery', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleRecoveryWalletOnPrem(typedReq);
      return Response.ok(result);
    }),
  ]);

  return router;
}
