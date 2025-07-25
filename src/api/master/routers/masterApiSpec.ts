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
import {
  BadRequestResponse,
  InternalServerErrorResponse,
  UnprocessableEntityResponse,
  NotFoundResponse,
} from '../../../shared/errors';

export type ScriptType2Of3 = utxolib.bitgo.outputScripts.ScriptType2Of3;

// Recovery parameter types
export const RecoveryParamTypes = {
  // UTXO specific recovery parameters
  utxoRecoveryOptions: t.partial({
    ignoreAddressTypes: t.array(t.string),
    userKeyPath: t.string,
    feeRate: t.number,
    scan: optional(t.number),
  }),

  // ETH-like specific recovery parameters
  ethLikeRecoveryOptions: t.partial({
    gasPrice: t.number,
    gasLimit: t.number,
    eip1559: t.type({
      maxPriorityFeePerGas: t.number,
      maxFeePerGas: t.number,
    }),
    replayProtectionOptions: t.type({
      chain: t.union([t.string, t.number]),
      hardfork: t.string,
    }),
    scan: optional(t.number),
  }),

  // Solana specific recovery parameters
  solanaRecoveryOptions: t.partial({
    durableNonce: optional(
      t.type({
        publicKey: t.string,
        secretKey: t.string,
      }),
    ),
    tokenContractAddress: t.string,
    closeAtaAddress: t.string,
    recoveryDestinationAtaAddress: t.string,
    programId: t.string,
  }),
};

export type EvmRecoveryOptions = typeof RecoveryParamTypes.ethLikeRecoveryOptions._A;
export type UtxoRecoveryOptions = typeof RecoveryParamTypes.utxoRecoveryOptions._A;
export type SolanaRecoveryOptions = typeof RecoveryParamTypes.solanaRecoveryOptions._A;

// Combined coin specific parameters
const CoinSpecificParams = t.partial({
  utxoRecoveryOptions: RecoveryParamTypes.utxoRecoveryOptions,
  evmRecoveryOptions: RecoveryParamTypes.ethLikeRecoveryOptions,
  solanaRecoveryOptions: RecoveryParamTypes.solanaRecoveryOptions,
});

export type CoinSpecificParams = t.TypeOf<typeof CoinSpecificParams>;

// Middleware functions
export function parseBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  req.headers['content-type'] = req.headers['content-type'] || 'application/json';
  return express.json({ limit: '20mb' })(req, res, next);
}

// Response type for /generate endpoint
const GenerateWalletResponse: HttpResponse = {
  // TODO: Get type from public types repo
  200: t.any,
  ...InternalServerErrorResponse,
};

// Request type for /generate endpoint
const GenerateWalletRequest = {
  /**
   * A human-readable label for the wallet
   * This will be displayed in the BitGo dashboard and API responses
   * @example "My Wallet"
   */
  label: t.string,

  /**
   * The type of multisig wallet to create
   * - onchain: Traditional multisig wallets using on-chain scripts
   * - tss: Threshold Signature Scheme wallets using MPC protocols
   * If absent, BitGo uses the default wallet type for the asset
   * @example "tss"
   */
  multisigType: t.union([t.literal('onchain'), t.literal('tss')]),

  /**
   * Enterprise ID - Required for Ethereum wallets
   * Ethereum wallets can only be created under an enterprise
   * Each enterprise has a fee address which will be used to pay for transaction fees
   * Your enterprise ID can be seen by clicking on the "Manage Organization" link on the enterprise dropdown
   * @example "59cd72485007a239fb00282ed480da1f"
   * @pattern ^[0-9a-f]{32}$
   */
  enterprise: t.string,

  /**
   * Flag for disabling wallet transaction notifications
   * When true, BitGo will not send email/SMS notifications for wallet transactions
   * @example false
   */
  disableTransactionNotifications: optional(t.boolean),

  /**
   * True, if the wallet type is a distributed-custodial
   * If passed, you must also pass the 'enterprise' parameter
   * Distributed custody allows multiple parties to share control of the wallet
   * @example false
   */
  isDistributedCustody: optional(t.boolean),

  /**
   * Specify the wallet creation contract version used when creating an Ethereum wallet contract
   * - 0: Old wallet creation (legacy)
   * - 1: New wallet creation, only deployed upon receiving funds
   * - 2: Same functionality as v1 but with NFT support
   * - 3: MPC wallets
   * @example 1
   * @minimum 0
   * @maximum 3
   */
  walletVersion: optional(t.number),
};

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
  ...BadRequestResponse,
  ...NotFoundResponse,
  ...InternalServerErrorResponse,
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
  ...BadRequestResponse, // All failed
  ...InternalServerErrorResponse,
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
  ...InternalServerErrorResponse,
};

// Response type for /recovery endpoint
const RecoveryWalletResponse: HttpResponse = {
  // TODO: Get type from public types repo
  200: t.type({
    txHex: t.string, // the full signed transaction hex
  }),
  ...UnprocessableEntityResponse,
  ...InternalServerErrorResponse,
};

// Request type for /recovery endpoint
const RecoveryWalletRequest = {
  isTssRecovery: t.union([t.undefined, t.boolean]),
  tssRecoveryParams: optional(
    t.type({
      commonKeychain: t.string,
    }),
  ),
  multiSigRecoveryParams: optional(
    t.type({
      userPub: t.string,
      backupPub: t.string,
      bitgoPub: t.string,
      walletContractAddress: t.string,
    }),
  ),
  recoveryDestinationAddress: t.string,
  apiKey: optional(t.string),
  coinSpecificParams: optional(CoinSpecificParams),
};

const RecoveryConsolidationsWalletRequest = {
  userPub: optional(t.string),
  backupPub: optional(t.string),
  bitgoPub: optional(t.string),
  multisigType: t.union([t.literal('onchain'), t.literal('tss')]),
  commonKeychain: optional(t.string),
  tokenContractAddress: optional(t.string),
  startingScanIndex: optional(t.number),
  endingScanIndex: optional(t.number),
  apiKey: optional(t.string),
  durableNonces: optional(
    t.type({
      secretKey: t.string,
      publicKeys: t.array(t.string),
    }),
  ),
};

// Response type for /recoveryconsolidations endpoint
const RecoveryConsolidationsWalletResponse: HttpResponse = {
  200: t.any,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
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
  ...BadRequestResponse,
  ...InternalServerErrorResponse,
};

const SignMpcRequest = {
  source: t.union([t.literal('user'), t.literal('backup')]),
  commonKeychain: t.union([t.undefined, t.string]),
};

const SignMpcResponse: HttpResponse = {
  200: t.any,
  ...InternalServerErrorResponse,
};

// API Specification
export const MasterApiSpec = apiSpec({
  'v1.wallet.generate': {
    post: httpRoute({
      method: 'POST' as const,
      path: '/api/{coin}/wallet/generate',
      request: httpRequest({
        params: {
          /**
           * A cryptocurrency or token ticker symbol
           * This determines the blockchain and wallet type that will be created
           * @example "btc"
           * @example "eth"
           * @example "ltc"
           */
          coin: t.string,
        },
        body: GenerateWalletRequest,
      }),
      response: GenerateWalletResponse,
      description: `
# Generate a New Wallet

This endpoint creates a new cryptocurrency wallet with the specified configuration. The wallet creation process involves several steps that happen automatically:

## Wallet Creation Process

1. **User Keychain Creation**: Creates the user keychain locally on the machine and encrypts it with the provided passphrase (skipped if userKey is provided)
2. **Backup Keychain Creation**: Creates the backup keychain locally on the machine
3. **Keychain Upload**: Uploads the encrypted user keychain and public backup keychain to BitGo
4. **BitGo Key Creation**: Creates the BitGo key (and backup key if backupXpubProvider is set) on the service
5. **Wallet Creation**: Creates the wallet on BitGo with the 3 public keys above

## Important Notes

### Ethereum Wallets
- Ethereum wallets can only be created under an enterprise
- Pass in the ID of the enterprise to associate the wallet with
- Your enterprise ID can be seen by clicking on the "Manage Organization" link on the enterprise dropdown
- Each enterprise has a fee address which will be used to pay for transaction fees on all Ethereum wallets in that enterprise
- The fee address is displayed in the dashboard of the website - please fund it before creating a wallet

### Subtokens
- You cannot generate a wallet by passing in a subtoken as the coin
- Subtokens share wallets with their parent coin and it is not possible to create a wallet specific to one token

### Usage
- This endpoint should be called through BitGo Express if used without the SDK, such as when using cURL
- For SDK usage, the wallet creation process is handled automatically by the SDK

## Query Parameters

- **includeKeychains** (boolean, default: false): Include user, backup and bitgo keychains along with generated wallet

## Response

Returns a wallet object containing the wallet ID, label, coin type, and other configuration details. If includeKeychains is true, the response will also include the keychain information.
      `,
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
  'v1.wallet.recoveryConsolidations': {
    post: httpRoute({
      method: 'POST',
      path: '/api/{coin}/wallet/recoveryconsolidations',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: RecoveryConsolidationsWalletRequest,
      }),
      response: RecoveryConsolidationsWalletResponse,
      description: 'Consolidate and recover an existing wallet',
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
