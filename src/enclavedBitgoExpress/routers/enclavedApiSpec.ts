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
import { postIndependentKey } from '../../api/enclaved/handlers/postIndependentKey';
import { recoveryMultisigTransaction } from '../../api/enclaved/handlers/recoveryMultisigTransaction';
import { signMultisigTransaction } from '../../api/enclaved/handlers/signMultisigTransaction';
import { signMpcTransaction } from '../../api/enclaved/handlers/signMpcTransaction';
import { prepareBitGo, responseHandler } from '../../shared/middleware';
import { EnclavedConfig } from '../../shared/types';
import { BitGoRequest } from '../../types/request';
import { NotImplementedError } from 'bitgo';
import { eddsaInitialize } from '../../api/enclaved/eddsaInitialize';

// Request type for /key/independent endpoint
const IndependentKeyRequest = {
  source: t.string,
  seed: t.union([t.undefined, t.string]),
};

const keySharePayloadType = t.type({
  from: t.union([t.literal('user'), t.literal('backup'), t.literal('bitgo')]),
  to: t.union([t.literal('user'), t.literal('backup'), t.literal('bitgo')]),
  publicShare: t.string,
  privateShare: t.string,
  privateShareProof: t.string,
  vssProof: t.string,
  gpgKey: t.string, // GPG public key of the sender
});

export type KeySharePayloadType = t.TypeOf<typeof keySharePayloadType>;

// Types for /mpc/finalize endpoint
const BitGoKeychainType = t.type({
  id: t.string,
  source: t.literal('bitgo'),
  type: t.literal('tss'),
  commonKeychain: t.string,
  verifiedVssProof: t.boolean,
});

const FinalizeKeyGenerationRequest = {
  encryptedDataKey: t.string,
  encryptedData: t.string,
  bitGoKeychain: BitGoKeychainType,
  source: t.union([t.literal('user'), t.literal('backup')]),
};

const FinalizeKeyGenerationResponse = t.type({
  commonKeychain: t.string,
  enclavedExpressKeyId: t.string,
  source: t.union([t.literal('user'), t.literal('backup')]),
});

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
  apiKey: t.string,
  unsignedSweepPrebuildTx: t.any,
  walletContractAddress: t.string,
  coinSpecificParams: t.union([
    t.undefined,
    t.partial({
      bitgoPub: t.union([t.undefined, t.string]),
      ignoreAddressTypes: t.union([t.undefined, t.array(t.string)]),
    }),
  ]),
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

// Request type for /mpc/sign endpoint
const SignMpcRequest = {
  source: t.string,
  pub: t.string,
  txRequest: t.union([t.undefined, t.any]),
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

export const InitEddsaKeyGenerationRequest = {
  source: t.union([t.literal('user'), t.literal('backup')]),
  bitgoGpgKey: t.string,
  userGpgKey: t.union([t.undefined, t.string]),
};

export const InitEddsaKeyGenerationResponse = t.type({
  encryptedDataKey: t.string,
  encryptedData: t.string,
  bitgoPayload: keySharePayloadType,
  userPayload: t.union([keySharePayloadType, t.undefined]),
});

export type InitEddsaKeyGenerationResponse = t.TypeOf<typeof InitEddsaKeyGenerationResponse>;

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
  'v1.key.mpc.init': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/mpc/initialize',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: InitEddsaKeyGenerationRequest,
      }),
      response: {
        200: InitEddsaKeyGenerationResponse,
        500: t.type({
          error: t.string,
          details: t.string,
        }),
      },
      description: 'Initialize Eddsa key generation',
    }),
  },
  'v1.mpc.finalize': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/mpc/finalize',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: FinalizeKeyGenerationRequest,
      }),
      response: {
        200: FinalizeKeyGenerationResponse,
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

  router.post('v1.mpc.sign', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.mpc.sign', 'post'>;
      const result = await signMpcTransaction(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.key.mpc.init', [
    responseHandler<EnclavedConfig>(async (_req) => {
      try {
        const typedReq = _req as EnclavedApiSpecRouteRequest<'v1.key.mpc.init', 'post'>;
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

  router.post('v1.mpc.finalize', [
    responseHandler<EnclavedConfig>(async (_req) => {
      throw new NotImplementedError('MPC key finalization is not implemented yet');
    }),
  ]);

  return router;
}
