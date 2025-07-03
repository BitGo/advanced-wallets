import {
  apiSpec,
  Method as HttpMethod,
  httpRequest,
  HttpResponse,
  httpRoute,
  optional,
  optionalized,
} from '@api-ts/io-ts-http';
import { Response } from '@api-ts/response';
import {
  createRouter,
  TypedRequestHandler,
  type WrappedRouter,
} from '@api-ts/typed-express-router';
import express from 'express';
import * as t from 'io-ts';
import { postIndependentKey } from '../../api/enclaved/handlers/postIndependentKey';
import { recoveryMpcTransaction } from '../../api/enclaved/handlers/recoveryMpcTransaction';
import { recoveryMultisigTransaction } from '../../api/enclaved/handlers/recoveryMultisigTransaction';
import { signMpcTransaction } from '../../api/enclaved/handlers/signMpcTransaction';
import { signMultisigTransaction } from '../../api/enclaved/handlers/signMultisigTransaction';
import { eddsaFinalize } from '../../api/enclaved/mpcFinalize';
import { eddsaInitialize } from '../../api/enclaved/mpcInitialize';
import { prepareBitGo, responseHandler } from '../../shared/middleware';
import { EnclavedConfig } from '../../shared/types';
import { BitGoRequest } from '../../types/request';

// Request type for /key/independent endpoint
const IndependentKeyRequest = {
  source: t.string,
  seed: t.union([t.undefined, t.string]),
};

// Response type for /key/independent endpoint
const IndependentKeyResponse: HttpResponse = {
  // TODO: Define proper response type
  200: t.any,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// Request type for /multisig/sign endpoint
const SignMultisigRequest = {
  source: t.string,
  pub: t.string,
  txPrebuild: t.any,
};

// Response type for /multisig/sign endpoint
const SignMultisigResponse: HttpResponse = {
  // TODO: Define proper response type for signed multisig transaction
  200: t.any,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// Request type for /multisig/recovery endpoint
const RecoveryMultisigRequest = {
  userPub: t.string,
  backupPub: t.string,
  bitgoPub: optional(t.string),
  unsignedSweepPrebuildTx: t.any,
  walletContractAddress: optional(t.string),
};

// Response type for /multisig/recovery endpoint
const RecoveryMultisigResponse: HttpResponse = {
  200: t.type({
    txHex: t.string,
  }), // the full signed tx
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// TODO: maybe it's the same req/resp as the musig rec? In that case merge both types
// Request type for /mpc/recovery endpoint
const RecoveryMpcRequest = {
  userPub: t.string,
  backupPub: t.string,
  bitgoPub: optional(t.string),
  unsignedSweepPrebuildTx: t.any,
  walletContractAddress: optional(t.string),
};

// TODO: same type as RecoveryMultisigResponse perhaps, check if can be merge
// Response type for /multisig/recovery endpoint
const RecoveryMpcResponse: HttpResponse = {
  200: t.type({
    txHex: t.string,
  }), // the full signed tx
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// Request type for /mpc/sign endpoint
const SignMpcRequest = {
  source: t.string,
  pub: t.string,
  txRequest: t.any,
  bitgoToUserRShare: t.union([t.undefined, t.any]),
  userToBitgoRShare: t.union([t.undefined, t.any]),
  encryptedUserToBitgoRShare: t.union([t.undefined, t.any]),
  bitgoToUserCommitment: t.union([t.undefined, t.any]),
  bitgoGpgPubKey: t.union([t.undefined, t.string]),
  encryptedDataKey: t.union([t.undefined, t.string]),
};

// Response type for /mpc/sign endpoint
const SignMpcResponse: HttpResponse = {
  // Response type for MPC transaction signing
  200: t.union([
    // Commitment share response
    t.type({
      userToBitgoCommitment: t.any,
      encryptedSignerShare: t.any,
      encryptedUserToBitgoRShare: t.any,
      encryptedDataKey: t.string,
    }),
    // R share response
    t.type({
      rShare: t.any,
    }),
    // G share response
    t.type({
      gShare: t.any,
    }),
  ]),
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

const KeyShare = {
  from: t.union([t.literal('user'), t.literal('backup'), t.literal('bitgo')]),
  to: t.union([t.literal('user'), t.literal('backup'), t.literal('bitgo')]),
  publicShare: t.string,
  privateShare: t.string,
  privateShareProof: t.string,
  vssProof: t.string,
  gpgKey: t.string,
};

const KeyShareType = t.type(KeyShare);
export type KeyShareType = t.TypeOf<typeof KeyShareType>;

const MpcInitializeRequest = {
  source: t.union([t.literal('user'), t.literal('backup')]),
  bitgoGpgPub: t.string,
  counterPartyGpgPub: optional(t.string), // Optional for backup source
};
const MpcInitializeRequestType = optionalized(MpcInitializeRequest);
export type MpcInitializeRequestType = t.TypeOf<typeof MpcInitializeRequestType>;

const MpcInitializeResponse = {
  encryptedDataKey: t.string,
  encryptedData: t.string,
  bitgoPayload: KeyShareType,
  counterPartyKeyShare: optional(KeyShareType),
};
const MpcInitializeResponseType = optionalized(MpcInitializeResponse);
export type MpcInitializeResponseType = t.TypeOf<typeof MpcInitializeResponseType>;

const BitGoKeychainType = t.type({
  id: t.string,
  source: t.literal('bitgo'),
  type: t.literal('tss'),
  commonKeychain: t.string,
  verifiedVssProof: t.boolean,
  // TODO: api-ts does not like optionalized gpgKey
  keyShares: t.array(t.any),
});

const MpcFinalizeRequest = {
  source: t.union([t.literal('user'), t.literal('backup')]),
  encryptedDataKey: t.string,
  encryptedData: t.string,
  counterPartyGpgPub: t.string,
  bitgoKeyChain: BitGoKeychainType,
  coin: t.string,
  counterPartyKeyShare: KeyShareType,
};
const MpcFinalizeRequestType = t.type(MpcFinalizeRequest);
export type MpcFinalizeRequestType = t.TypeOf<typeof MpcFinalizeRequestType>;

const MpcFinalizeResponse = {
  counterpartyKeyShare: optional(KeyShareType),
  source: t.union([t.literal('user'), t.literal('backup')]),
  commonKeychain: t.string,
};
const MpcFinalizeResponseType = optionalized(MpcFinalizeResponse);
export type MpcFinalizeResponseType = t.TypeOf<typeof MpcFinalizeResponseType>;

// API Specification
export const EnclavedAPiSpec = apiSpec({
  'v1.multisig.sign': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/multisig/sign',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: SignMultisigRequest,
      }),
      response: SignMultisigResponse,
      description: 'Sign a multisig transaction',
    }),
  },
  'v1.multisig.recovery': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/multisig/recovery',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: RecoveryMultisigRequest,
      }),
      response: RecoveryMultisigResponse,
      description: 'Recover a multisig transaction',
    }),
  },
  // should we use v1.eddsa.recovery instead?
  'v1.mpc.recovery': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/mpc/recovery',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: RecoveryMpcRequest,
      }),
      response: RecoveryMpcResponse,
      description: 'Recover a mpc transaction',
    }),
  },
  'v1.key.independent': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/key/independent',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: IndependentKeyRequest,
      }),
      response: IndependentKeyResponse,
      description: 'Generate an independent key',
    }),
  },
  'v1.mpc.key.initialize': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/mpc/key/initialize',
      request: httpRequest({
        params: { coin: t.string },
        body: MpcInitializeRequest,
      }),
      response: {
        200: t.type(MpcInitializeResponse),
        500: t.type({
          error: t.string,
          details: t.string,
        }),
      },
      description: 'Initialize MPC for EdDSA key generation',
    }),
  },
  'v1.mpc.sign': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/mpc/sign/{shareType}',
      request: httpRequest({
        params: {
          coin: t.string,
          shareType: t.string,
        },
        body: SignMpcRequest,
      }),
      response: SignMpcResponse,
      description: 'Sign a MPC transaction',
    }),
  },

  'v1.mpc.key.finalize': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/mpc/key/finalize',
      request: httpRequest({
        params: { coin: t.string },
        body: MpcFinalizeRequest,
      }),
      response: {
        200: MpcFinalizeResponseType,
        500: t.type({
          error: t.string,
          details: t.string,
        }),
      },
      description: 'Finalize key generation and confirm commonKeychain',
    }),
  },
});

export type EnclavedApiSpecRouteHandler<
  ApiName extends keyof typeof EnclavedAPiSpec,
  Method extends keyof (typeof EnclavedAPiSpec)[ApiName] & HttpMethod,
> = TypedRequestHandler<typeof EnclavedAPiSpec, ApiName, Method>;

export type EnclavedApiSpecRouteRequest<
  ApiName extends keyof typeof EnclavedAPiSpec,
  Method extends keyof (typeof EnclavedAPiSpec)[ApiName] & HttpMethod,
> = BitGoRequest<EnclavedConfig> & Parameters<EnclavedApiSpecRouteHandler<ApiName, Method>>[0];

export type GenericEnclavedApiSpecRouteRequest = EnclavedApiSpecRouteRequest<any, any>;

// Create router with handlers
export function createKeyGenRouter(config: EnclavedConfig): WrappedRouter<typeof EnclavedAPiSpec> {
  const router = createRouter(EnclavedAPiSpec);
  // Add middleware
  router.use(express.json());
  router.use(prepareBitGo(config));

  // Independent key generation endpoint handler
  router.post('v1.key.independent', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.key.independent', 'post'>;
      const result = await postIndependentKey(typedReq);
      return Response.ok(result);
    }),
  ]);

  // Multisig transaction signing endpoint handler
  router.post('v1.multisig.sign', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.multisig.sign', 'post'>;
      const result = await signMultisigTransaction(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.multisig.recovery', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.multisig.recovery', 'post'>;
      const result = await recoveryMultisigTransaction(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.mpc.recovery', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.mpc.recovery', 'post'>;
      const result = await recoveryMpcTransaction(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.mpc.sign', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.mpc.sign', 'post'>;
      const result = await signMpcTransaction(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.mpc.key.initialize', [
    responseHandler<EnclavedConfig>(async (_req) => {
      try {
        const typedReq = _req as EnclavedApiSpecRouteRequest<'v1.mpc.key.initialize', 'post'>;
        const response = await eddsaInitialize(typedReq);
        return Response.ok(response);
      } catch (error) {
        const err = error as Error;
        return Response.internalError({
          error: err.message,
          details: err.stack || 'No stack trace available',
        });
      }
    }),
  ]);

  router.post('v1.mpc.key.finalize', [
    responseHandler<EnclavedConfig>(async (_req) => {
      try {
        const typedReq = _req as EnclavedApiSpecRouteRequest<'v1.mpc.key.finalize', 'post'>;
        const response = await eddsaFinalize(typedReq);
        return Response.ok(response);
      } catch (error) {
        const err = error as Error;
        return Response.internalError({
          error: err.message,
          details: err.stack || 'No stack trace available',
        });
      }
    }),
  ]);

  return router;
}
