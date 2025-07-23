import {
  apiSpec,
  httpRequest,
  HttpResponse,
  httpRoute,
  Method as HttpMethod,
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
import { recoveryMultisigTransaction } from '../../api/enclaved/handlers/recoveryMultisigTransaction';
import { signMultisigTransaction } from '../../api/enclaved/handlers/signMultisigTransaction';
import { signMpcTransaction } from '../../api/enclaved/handlers/signMpcTransaction';
import { prepareBitGo, responseHandler } from '../../shared/middleware';
import { EnclavedConfig } from '../../shared/types';
import { BitGoRequest } from '../../types/request';
import { eddsaInitialize } from '../../api/enclaved/mpcInitialize';
import { eddsaFinalize } from '../../api/enclaved/mpcFinalize';
import { DklsDkg, DklsTypes } from '@bitgo-beta/sdk-lib-mpc';
import { ecdsaMPCv2Initialize } from '../../api/enclaved/handlers/ecdsaMPCv2Initialize';
import { ecdsaMPCv2Round } from '../../api/enclaved/handlers/ecdsaMPCv2Round';
import { ecdsaMPCv2Finalize } from '../../api/enclaved/handlers/ecdsaMPCv2Finalize';
import { signEddsaRecoveryTransaction } from '../../api/enclaved/handlers/signEddsaRecoveryTransaction';
import { isEddsaCoin } from '../../shared/coinUtils';
import { MethodNotImplementedError } from '@bitgo-beta/sdk-core';
import coinFactory from '../../shared/coinFactory';

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

const RecoveryMpcRequest = {
  commonKeychain: t.string,
  unsignedSweepPrebuildTx: t.type({
    txRequests: t.array(
      t.type({
        unsignedTx: t.string,
        signableHex: t.string,
        derivationPath: t.string,
      }),
    ),
  }),
};

export type RecoveryMpcRequest = typeof RecoveryMpcRequest;

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
  bitgoPublicGpgKey: t.union([t.undefined, t.string]),
  encryptedDataKey: t.union([t.undefined, t.string]),

  // ECDSA MPCv2 specific fields
  encryptedUserGpgPrvKey: t.union([t.undefined, t.string]),
  encryptedRound1Session: t.union([t.undefined, t.string]),
  encryptedRound2Session: t.union([t.undefined, t.string]),
};

// Response type for /mpc/sign endpoint
const SignMpcResponse: HttpResponse = {
  // Response type for MPC transaction signing
  200: t.union([
    // EDDSA Commitment share response
    t.type({
      userToBitgoCommitment: t.any,
      encryptedSignerShare: t.any,
      encryptedUserToBitgoRShare: t.any,
      encryptedDataKey: t.string,
    }),
    // EDDSA R share response
    t.type({
      rShare: t.any,
    }),
    // EDDSA G share response
    t.type({
      gShare: t.any,
    }),
    // ECDSA MPCv2 Round 1 response
    t.type({
      signatureShareRound1: t.any,
      userGpgPubKey: t.string,
      encryptedRound1Session: t.string,
      encryptedUserGpgPrvKey: t.string,
      encryptedDataKey: t.string,
    }),
    // ECDSA MPCv2 Round 2 response
    t.type({
      signatureShareRound2: t.any,
      encryptedRound2Session: t.string,
    }),
    // ECDSA MPCv2 Round 3 response
    t.type({
      signatureShareRound3: t.any,
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

const MpcV2InitializeRequest = {
  source: t.union([t.literal('user'), t.literal('backup')]),
};
const MpcV2InitializeRequestType = t.type(MpcV2InitializeRequest);
export type MpcV2InitializeRequestType = t.TypeOf<typeof MpcV2InitializeRequestType>;

const MpcV2InitializeResponse = {
  gpgPub: t.string,
  encryptedData: t.string,
  encryptedDataKey: t.string,
};
const MpcV2InitializeResponseType = t.type(MpcV2InitializeResponse);
export type MpcV2InitializeResponseType = t.TypeOf<typeof MpcV2InitializeResponseType>;

export type MpcV2RoundState = {
  round: number;
  sessionData?: DklsDkg.DkgSessionData;
  sourceGpgPrv: DklsTypes.PartyGpgKey;
  bitgoGpgPub?: DklsTypes.PartyGpgKey;
  counterPartyGpgPub?: DklsTypes.PartyGpgKey;
};
const MpcV2RoundMessage = t.type({
  bitgo: t.any,
  counterParty: t.any,
});
const MpcV2RoundRequest = {
  source: t.union([t.literal('user'), t.literal('backup')]),
  encryptedData: t.string,
  encryptedDataKey: t.string,
  round: t.number,
  bitgoGpgPub: optional(t.string),
  counterPartyGpgPub: optional(t.string),
  broadcastMessages: optional(MpcV2RoundMessage),
  p2pMessages: optional(MpcV2RoundMessage),
};
const MpcV2RoundRequestType = t.type(MpcV2RoundRequest);
export type MpcV2RoundRequestType = t.TypeOf<typeof MpcV2RoundRequestType>;

const MpcV2RoundResponse = {
  encryptedData: t.string,
  encryptedDataKey: t.string,
  round: t.number,
  broadcastMessage: optional(t.any),
  p2pMessages: optional(MpcV2RoundMessage),
};
const MpcV2RoundResponseType = optionalized(MpcV2RoundResponse);
export type MpcV2RoundResponseType = t.TypeOf<typeof MpcV2RoundResponseType>;

const MpcV2FinalizeRequest = {
  source: t.union([t.literal('user'), t.literal('backup')]),
  encryptedData: t.string,
  encryptedDataKey: t.string,
  broadcastMessages: MpcV2RoundMessage,
  bitgoCommonKeychain: t.string,
};
const MpcV2FinalizeRequestType = t.type(MpcV2FinalizeRequest);
export type MpcV2FinalizeRequestType = t.TypeOf<typeof MpcV2FinalizeRequestType>;

const MpcV2FinalizeResponse = {
  commonKeychain: t.string,
  source: t.union([t.literal('user'), t.literal('backup')]),
};
const MpcV2FinalizeResponseType = t.type(MpcV2FinalizeResponse);
export type MpcV2FinalizeResponseType = t.TypeOf<typeof MpcV2FinalizeResponseType>;

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
  'v1.mpc.recovery': {
    post: httpRoute({
      method: 'POST',
      path: `/api/{coin}/mpc/recovery`,
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: RecoveryMpcRequest,
      }),
      response: RecoveryMpcResponse,
      description: 'Sign a recovery transaction with EdDSA user & backup keyshares',
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
          shareType: t.union([
            t.literal('commitment'),
            t.literal('r'),
            t.literal('g'),
            t.literal('mpcv2round1'),
            t.literal('mpcv2round2'),
            t.literal('mpcv2round3'),
          ]),
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
  'v1.mpcv2.initialize': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/mpcv2/initialize',
      request: httpRequest({
        params: { coin: t.string },
        body: MpcV2InitializeRequest,
      }),
      response: {
        200: MpcV2InitializeResponseType,
        500: t.type({
          error: t.string,
          details: t.string,
        }),
      },
      description: 'Initialize MPC for EdDSA key generation',
    }),
  },
  'v1.mpcv2.round': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/mpcv2/round',
      request: httpRequest({
        params: { coin: t.string },
        body: MpcV2RoundRequest,
      }),
      response: {
        200: MpcV2RoundResponseType,
        500: t.type({
          error: t.string,
          details: t.string,
        }),
      },
      description: 'Perform a round in the MPC protocol',
    }),
  },
  'v1.mpcv2.finalize': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/mpcv2/finalize',
      request: httpRequest({
        params: { coin: t.string },
        body: MpcV2FinalizeRequest,
      }),
      response: {
        200: MpcV2FinalizeResponseType,
        500: t.type({
          error: t.string,
          details: t.string,
        }),
      },
      description: 'Finalize the MPC protocol',
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

  router.post('v1.mpc.recovery', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.mpc.recovery', 'post'>;
      const coin = await coinFactory.getCoin(typedReq.decoded.coin, typedReq.bitgo);
      if (isEddsaCoin(coin)) {
        const result = await signEddsaRecoveryTransaction({
          sdk: typedReq.bitgo,
          request: {
            commonKeychain: typedReq.decoded.commonKeychain,
            signableHex: typedReq.decoded.unsignedSweepPrebuildTx.txRequests[0].signableHex,
            derivationPath: typedReq.decoded.unsignedSweepPrebuildTx.txRequests[0].derivationPath,
          },
          cfg: typedReq.config,
          coin,
        });
        return Response.ok(result);
      } else {
        throw new MethodNotImplementedError();
      }
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

  router.post('v1.mpcv2.initialize', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.mpcv2.initialize', 'post'>;
      const result = await ecdsaMPCv2Initialize(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.mpcv2.round', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.mpcv2.round', 'post'>;
      const result = await ecdsaMPCv2Round(typedReq);
      return Response.ok(result);
    }),
  ]);

  router.post('v1.mpcv2.finalize', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.mpcv2.finalize', 'post'>;
      const result = await ecdsaMPCv2Finalize(typedReq);
      return Response.ok(result);
    }),
  ]);

  return router;
}
