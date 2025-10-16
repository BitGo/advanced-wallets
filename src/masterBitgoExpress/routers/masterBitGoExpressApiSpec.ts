import { apiSpec, Method as HttpMethod } from '@api-ts/io-ts-http';
import { Response } from '@api-ts/response';
import {
  createRouter,
  TypedRequestHandler,
  type WrappedRouter,
} from '@api-ts/typed-express-router';
import express from 'express';
import { customDecodeErrorFormatter } from '../../shared/errorFormatters';
import { MasterExpressConfig } from '../../shared/types';
import * as utxolib from '@bitgo-beta/utxo-lib';
import { prepareBitGo, responseHandler } from '../../shared/middleware';
import { BitGoRequest } from '../../types/request';
import { handleGenerateWallet } from '../handlers/handleGenerateWallet';
import { handleSendMany } from '../handlers/handleSendMany';
import { validateMasterExpressConfig } from '../middleware/middleware';
import { handleRecoveryWallet } from '../handlers/recoveryWallet';
import { handleConsolidate } from '../handlers/handleConsolidate';
import { handleAccelerate } from '../handlers/handleAccelerate';
import { handleConsolidateUnspents } from '../handlers/handleConsolidateUnspents';
import { handleSignAndSendTxRequest } from '../handlers/handleSignAndSendTxRequest';
import { handleRecoveryConsolidations } from '../handlers/handleRecoveryConsolidations';
import { WalletGenerateRoute } from './generateWalletRoute';
import { AccelerateRoute } from './accelerateRoute';
import { RecoveryRoute } from './recoveryRoute';
import { RecoveryConsolidationsRoute } from './recoveryConsolidationsRoute';
import { SendManyRoute } from './sendManyRoute';
import { ConsolidateRoute } from './consolidateRoute';
import { ConsolidateUnspentsRoute } from './consolidateUnspentsRoute';
import { SignAndSendMpcRoute } from './signAndSendMpcRoute';

export type ScriptType2Of3 = utxolib.bitgo.outputScripts.ScriptType2Of3;

// Middleware functions
export function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  req.headers['content-type'] = req.headers['content-type'] || 'application/json';
  return express.json({ limit: '20mb' })(req, res, next);
}

// API Specification
export const MasterBitGoExpressApiSpec = apiSpec({
  'v1.wallet.generate': {
    post: WalletGenerateRoute,
  },
  'v1.wallet.sendMany': {
    post: SendManyRoute,
  },
  'v1.wallet.txrequest.signAndSend': {
    post: SignAndSendMpcRoute,
  },
  'v1.wallet.recovery': {
    post: RecoveryRoute,
  },
  'v1.wallet.recoveryConsolidations': {
    post: RecoveryConsolidationsRoute,
  },
  'v1.wallet.consolidate': {
    post: ConsolidateRoute,
  },
  'v1.wallet.accelerate': {
    post: AccelerateRoute,
  },
  'v1.wallet.consolidateunspents': {
    post: ConsolidateUnspentsRoute,
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
  const router = createRouter(MasterBitGoExpressApiSpec, {
    decodeErrorFormatter: customDecodeErrorFormatter,
  });

  // Add middleware to all routes
  router.use(parseBody);
  router.use(prepareBitGo(cfg));
  router.use(validateMasterExpressConfig);

  // Generate wallet endpoint handler
  router.post('v1.wallet.generate', [
    responseHandler<MasterExpressConfig>(async (req: express.Request) => {
      const typedReq = req as GenericMasterApiSpecRouteRequest;
      const result = await handleGenerateWallet(typedReq);
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
      const result = await handleRecoveryWallet(typedReq);
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
      const result = await handleRecoveryConsolidations(typedReq);
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
