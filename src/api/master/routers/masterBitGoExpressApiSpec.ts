import {
  apiSpec,
  httpRequest,
  HttpResponse,
  httpRoute,
  Method as HttpMethod,
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
import * as utxolib from '@bitgo-beta/utxo-lib';
import { prepareBitGo, responseHandler } from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';
import { handleGenerateWalletOnPrem } from '../handlers/generateWallet';
import { handleSendMany } from '../handlers/handleSendMany';
import { validateMasterExpressConfig } from '../middleware/middleware';
import { handleRecoveryWalletOnPrem } from '../handlers/recoveryWallet';
import { handleConsolidate } from '../handlers/handleConsolidate';
import { handleAccelerate } from '../handlers/handleAccelerate';
import { handleConsolidateUnspents } from '../handlers/handleConsolidateUnspents';
import { handleSignAndSendTxRequest } from '../handlers/handleSignAndSendTxRequest';
import { handleRecoveryConsolidationsOnPrem } from '../handlers/recoveryConsolidationsWallet';
import { ErrorResponses } from '../../../shared/errors';
import { WalletGenerateRoute } from './generateWalletRoute';
import { AccelerateRoute } from './accelerateRoute';
import { RecoveryRoute } from './recoveryRoute';
import { RecoveryConsolidationsRoute } from './recoveryConsolidationsRoute';

export type ScriptType2Of3 = utxolib.bitgo.outputScripts.ScriptType2Of3;

// Middleware functions
export function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  req.headers['content-type'] = req.headers['content-type'] || 'application/json';
  return express.json({ limit: '20mb' })(req, res, next);
}

export const SendManyRequest = {
  pubkey: t.union([t.undefined, t.string]),
  // Required for MPC
  type: t.union([
    t.undefined,
    t.literal('transfer'),
    t.literal('fillNonce'),
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
  recipients: t.union([t.undefined, t.array(t.any)]),
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
  nonce: t.union([t.undefined, t.string]),
};

export const SendManyResponse: HttpResponse = {
  // TODO: Get type from public types repo / Wallet Platform
  200: t.any,
  ...ErrorResponses,
};

// Request type for /consolidate endpoint
export const ConsolidateRequest = {
  pubkey: t.union([t.undefined, t.string]),
  source: t.union([t.literal('user'), t.literal('backup')]),
  consolidateAddresses: t.union([t.undefined, t.array(t.string)]),
  apiVersion: t.union([t.undefined, t.literal('full'), t.literal('lite')]),
  commonKeychain: t.union([t.undefined, t.string]),
};

// Response type for /consolidate endpoint
const ConsolidateResponse: HttpResponse = {
  200: t.any,
  ...ErrorResponses,
};

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
  ...ErrorResponses,
};

const SignMpcRequest = {
  source: t.union([t.literal('user'), t.literal('backup')]),
  commonKeychain: t.union([t.undefined, t.string]),
};

const SignMpcResponse: HttpResponse = {
  200: t.any,
  ...ErrorResponses,
};

// API Specification
export const MasterBitGoExpressApiSpec = apiSpec({
  'v1.wallet.generate': {
    post: WalletGenerateRoute,
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
  'v1.wallet.txrequest.signAndSend': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/{walletId}/txrequest/{txRequestId}/signAndSend',
      request: httpRequest({
        params: {
          walletId: t.string,
          coin: t.string,
          txRequestId: t.string,
        },
        body: SignMpcRequest,
      }),
      response: SignMpcResponse,
      description: 'Sign MPC with TxRequest',
    }),
  },
  'v1.wallet.recovery': {
    post: RecoveryRoute,
  },
  'v1.wallet.recoveryConsolidations': {
    post: RecoveryConsolidationsRoute,
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
    post: AccelerateRoute,
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

export type MasterApiSpec = typeof MasterBitGoExpressApiSpec;

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
): WrappedRouter<typeof MasterBitGoExpressApiSpec> {
  const router = createRouter(MasterBitGoExpressApiSpec);

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

  router.post('v1.wallet.recoveryConsolidations', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleRecoveryConsolidationsOnPrem(typedReq);
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

  router.post('v1.wallet.txrequest.signAndSend', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleSignAndSendTxRequest(typedReq);
      return Response.ok(result);
    }),
  ]);

  return router;
}
