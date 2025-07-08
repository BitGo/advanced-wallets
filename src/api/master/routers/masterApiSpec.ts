import {
  apiSpec,
  Method as HttpMethod,
  httpRequest,
  HttpResponse,
  httpRoute,
  optional,
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
import { handleConsolidate } from '../handlers/handleConsolidate';
import { handleAccelerate } from '../handlers/handleAccelerate';
import { handleConsolidateUnspents } from '../handlers/handleConsolidateUnspents';

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
  multisigType: t.union([t.literal('onchain'), t.literal('tss')]),
  enterprise: t.string,
  disableTransactionNotifications: t.union([t.undefined, t.boolean]),
  isDistributedCustody: t.union([t.undefined, t.boolean]),
};

export const SendManyRequest = {
  pubkey: t.union([t.undefined, t.string]),
  // Required for MPC
  type: t.union([
    t.undefined,
    t.literal('transfer'),
    t.literal('acceleration'),
    t.literal('accountSet'),
    t.literal('enabletoken'),
    t.literal('stakingLock'),
    t.literal('stakingUnlock'),
    t.literal('transfertoken'),
    t.literal('trustline'),
  ]),
  commonKeychain: t.union([t.undefined, t.string]),
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

// Request type for /consolidate endpoint
export const ConsolidateRequest = {
  pubkey: t.string,
  source: t.union([t.literal('user'), t.literal('backup')]),
  consolidateAddresses: t.union([t.undefined, t.array(t.string)]),
  apiVersion: t.union([t.undefined, t.literal('full'), t.literal('lite')]),
};

// Response type for /consolidate endpoint
const ConsolidateResponse: HttpResponse = {
  200: t.any,
  400: t.any, // All failed
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// Request type for /accelerate endpoint
export const AccelerateRequest = {
  pubkey: t.string,
  source: t.union([t.literal('user'), t.literal('backup')]),
  cpfpTxIds: t.union([t.undefined, t.array(t.string)]),
  cpfpFeeRate: t.union([t.undefined, t.number]),
  maxFee: t.union([t.undefined, t.number]),
  rbfTxIds: t.union([t.undefined, t.array(t.string)]),
  feeMultiplier: t.union([t.undefined, t.number]),
};

// Response type for /accelerate endpoint
const AccelerateResponse: HttpResponse = {
  // TODO: Get type from public types repo / Wallet Platform
  200: t.type({
    txid: t.string,
    tx: t.string,
  }),
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
  bitgoPub: t.union([t.undefined, t.string]),
  walletContractAddress: t.string,
  recoveryDestinationAddress: t.string,
  apiKey: t.string,
  coinSpecificParams: optional(
    t.partial({
      ignoreAddressTypes: optional(
        t.array(
          t.union([
            t.literal('p2sh'),
            t.literal('p2shP2wsh'),
            t.literal('p2wsh'),
            t.literal('p2tr'),
            t.literal('p2trMusig2'),
          ]),
        ),
      ),
      addressScan: optional(t.number),
      feeRate: optional(t.number),
    }),
  ),
};

export type RecoveryWalletRequest = typeof RecoveryWalletRequest;

export const ConsolidateUnspentsRequest = {
  pubkey: t.string,
  source: t.union([t.literal('user'), t.literal('backup')]),
  feeRate: t.union([t.undefined, t.number]),
  maxFeeRate: t.union([t.undefined, t.number]),
  maxFeePercentage: t.union([t.undefined, t.number]),
  feeTxConfirmTarget: t.union([t.undefined, t.number]),
  bulk: t.union([t.undefined, t.boolean]),
  minValue: t.union([t.undefined, t.union([t.string, t.number])]),
  maxValue: t.union([t.undefined, t.union([t.string, t.number])]),
  minHeight: t.union([t.undefined, t.number]),
  minConfirms: t.union([t.undefined, t.number]),
  enforceMinConfirmsForChange: t.union([t.undefined, t.boolean]),
  limit: t.union([t.undefined, t.number]),
  numUnspentsToMake: t.union([t.undefined, t.number]),
  targetAddress: t.union([t.undefined, t.string]),
  txFormat: t.union([t.undefined, t.literal('legacy'), t.literal('psbt'), t.literal('psbt-lite')]),
};

const ConsolidateUnspentsResponse: HttpResponse = {
  200: t.type({
    tx: t.string,
    txid: t.string,
  }),
  400: t.any,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
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
  'v1.wallet.consolidate': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/{walletId}/consolidate',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
        },
        body: ConsolidateRequest,
      }),
      response: ConsolidateResponse,
      description: 'Consolidate addresses',
    }),
  },
  'v1.wallet.accelerate': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/{walletId}/accelerate',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
        },
        body: AccelerateRequest,
      }),
      response: AccelerateResponse,
      description: 'Accelerate transaction',
    }),
  },
  'v1.wallet.consolidateunspents': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/{walletId}/consolidateunspents',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
        },
        body: ConsolidateUnspentsRequest,
      }),
      response: ConsolidateUnspentsResponse,
      description: 'Consolidate unspents',
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

  router.post('v1.wallet.consolidate', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleConsolidate(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.wallet.accelerate', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleAccelerate(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.wallet.consolidateunspents', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleConsolidateUnspents(typedReq);
      return Response.ok(result);
    }),
  ]);

  return router;
}
