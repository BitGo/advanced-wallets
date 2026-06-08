import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { SignatureShareRecord, SignatureShareType } from '@bitgo-beta/sdk-core';
import nock from 'nock';
import { AsyncModeConfig } from '../../../shared/types';

export const DEFAULT_ASYNC_MODE_CONFIG: AsyncModeConfig = {
  enabled: false,
  awmAsyncUrl: '',
  pollIntervalInMs: 30000,
  jobTtlInSeconds: 3600,
  jobTtlMpcInSeconds: 7200,
};

export class BitGoAPITestHarness extends BitGoAPI {
  static clearConstantsCache(): void {
    BitGoAPI._constants = {};
    BitGoAPI._constantsExpire = {};
  }
}

export const DEFAULT_ECDSA_MPCV2_WALLET_ID = 'test-wallet-id';
export const DEFAULT_ECDSA_MPCV2_TX_REQUEST_ID = 'test-tx-request-id';

export function createEcdsaMpcv2SignatureShares(): {
  round1SignatureShare: SignatureShareRecord;
  round2SignatureShare: SignatureShareRecord;
  round3SignatureShare: SignatureShareRecord;
} {
  const round1SignatureShare: SignatureShareRecord = {
    from: SignatureShareType.USER,
    to: SignatureShareType.BITGO,
    share: JSON.stringify({
      type: 'round1Input',
      data: { msg1: { from: 1, message: 'round1-message' } },
    }),
  };
  const round2SignatureShare: SignatureShareRecord = {
    from: SignatureShareType.USER,
    to: SignatureShareType.BITGO,
    share: JSON.stringify({
      type: 'round2Input',
      data: {
        msg2: { from: 1, to: 3, encryptedMessage: 'round2-message', signature: 'round2-signature' },
        msg3: { from: 1, to: 3, encryptedMessage: 'round3-message', signature: 'round3-signature' },
      },
    }),
  };
  const round3SignatureShare: SignatureShareRecord = {
    from: SignatureShareType.USER,
    to: SignatureShareType.BITGO,
    share: JSON.stringify({
      type: 'round3Input',
      data: {
        msg4: {
          from: 1,
          message: 'round4-message',
          signature: 'round4-signature',
          signatureR: 'round4-signature-r',
        },
      },
    }),
  };
  return { round1SignatureShare, round2SignatureShare, round3SignatureShare };
}

export function buildEcdsaMpcv2TxRequest(
  state: string,
  options: {
    walletId?: string;
    txRequestId?: string;
    serializedTxHex?: string;
    extra?: Record<string, unknown>;
  } = {},
) {
  const walletId = options.walletId ?? DEFAULT_ECDSA_MPCV2_WALLET_ID;
  const txRequestId = options.txRequestId ?? DEFAULT_ECDSA_MPCV2_TX_REQUEST_ID;
  const serializedTxHex = options.serializedTxHex ?? 'testMessage';

  return {
    txRequestId,
    apiVersion: 'full',
    enterpriseId: 'test-enterprise-id',
    transactions: [
      {
        unsignedTx: {
          derivationPath: 'm/0',
          signableHex: 'testMessage',
          serializedTxHex,
        },
        state: 'pendingSignature',
        signatureShares: [] as SignatureShareRecord[],
      },
    ],
    state,
    walletId,
    walletType: 'hot',
    version: 2,
    date: new Date().toISOString(),
    userId: 'test-user-id',
    intent: {},
    policiesChecked: true,
    unsignedTxs: [],
    latest: true,
    ...options.extra,
  };
}

export function buildSignedEcdsaMpcv2TxRequest(
  options: {
    walletId?: string;
    txRequestId?: string;
    serializedTxHex?: string;
    signedTxId?: string;
    signedTxHex?: string;
  } = {},
) {
  const pending = buildEcdsaMpcv2TxRequest('pendingUserSignature', options);
  return {
    ...pending,
    state: 'signed',
    transactions: [
      {
        ...pending.transactions[0],
        state: 'signed',
        signedTx: {
          id: options.signedTxId ?? 'test-tx-id',
          tx: options.signedTxHex ?? 'signed-transaction',
        },
      },
    ],
  };
}

export interface NockEcdsaMpcv2SigningFlowOptions {
  coin: string;
  bitgoApiUrl: string;
  advancedWalletManagerUrl: string;
  sendResponse: ReturnType<typeof buildEcdsaMpcv2TxRequest>;
  walletId?: string;
  txRequestId?: string;
  userGpgPubKey?: string;
  commonKeychain?: string;
  /** When true, nocks GET bitgo keychain (required for pickBitgoPubGpgKeyForSigning in test env). */
  includeBitgoKeychainNock?: boolean;
  /** Base tx request for BitGo sign round replies. */
  pendingTxRequest?: ReturnType<typeof buildEcdsaMpcv2TxRequest>;
}

/**
 * Nocks BitGo sign/send and AWM mpcv2round1/2/3 for ECDSA MPCv2 external signing.
 */
export function nockEcdsaMpcv2SigningFlow(options: NockEcdsaMpcv2SigningFlowOptions) {
  const walletId = options.walletId ?? DEFAULT_ECDSA_MPCV2_WALLET_ID;
  const txRequestId = options.txRequestId ?? DEFAULT_ECDSA_MPCV2_TX_REQUEST_ID;
  const userGpgPubKey = options.userGpgPubKey ?? 'user-gpg-pub-key';
  const commonKeychain = options.commonKeychain ?? 'common-keychain-123';

  const { round1SignatureShare, round2SignatureShare, round3SignatureShare } =
    createEcdsaMpcv2SignatureShares();

  const pending =
    options.pendingTxRequest ??
    buildEcdsaMpcv2TxRequest('pendingUserSignature', { walletId, txRequestId });

  if (options.includeBitgoKeychainNock) {
    nock(options.bitgoApiUrl)
      .get(`/api/v2/${options.coin}/key/bitgo-key-id`)
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'bitgo-key-id',
        pub: 'xpub_bitgo',
        commonKeychain,
        source: 'bitgo',
        type: 'tss',
        hsmType: 'institutional',
      });
  }

  const round1SignNock = nock(options.bitgoApiUrl)
    .post(`/api/v2/wallet/${walletId}/txrequests/${txRequestId}/transactions/0/sign`)
    .matchHeader('any', () => true)
    .reply(200, {
      ...pending,
      transactions: [{ ...pending.transactions[0], signatureShares: [round1SignatureShare] }],
    });

  const round2SignNock = nock(options.bitgoApiUrl)
    .post(`/api/v2/wallet/${walletId}/txrequests/${txRequestId}/transactions/0/sign`)
    .matchHeader('any', () => true)
    .reply(200, {
      ...pending,
      transactions: [
        {
          ...pending.transactions[0],
          signatureShares: [round1SignatureShare, round2SignatureShare],
        },
      ],
    });

  const round3SignNock = nock(options.bitgoApiUrl)
    .post(`/api/v2/wallet/${walletId}/txrequests/${txRequestId}/transactions/0/sign`)
    .matchHeader('any', () => true)
    .reply(200, {
      ...pending,
      transactions: [
        {
          ...pending.transactions[0],
          signatureShares: [round1SignatureShare, round2SignatureShare, round3SignatureShare],
        },
      ],
    });

  const sendTxNock = nock(options.bitgoApiUrl)
    .post(`/api/v2/wallet/${walletId}/txrequests/${txRequestId}/transactions/0/send`)
    .matchHeader('any', () => true)
    .reply(200, options.sendResponse);

  const awmRound1Nock = nock(options.advancedWalletManagerUrl)
    .post(`/api/${options.coin}/mpc/sign/mpcv2round1`)
    .reply(200, {
      signatureShareRound1: round1SignatureShare,
      userGpgPubKey,
      encryptedRound1Session: 'encrypted-round1-session',
      encryptedUserGpgPrvKey: 'encrypted-user-gpg-prv-key',
      encryptedDataKey: 'test-encrypted-data-key',
    });

  const awmRound2Nock = nock(options.advancedWalletManagerUrl)
    .post(`/api/${options.coin}/mpc/sign/mpcv2round2`)
    .reply(200, {
      signatureShareRound2: round2SignatureShare,
      encryptedRound2Session: 'encrypted-round2-session',
    });

  const awmRound3Nock = nock(options.advancedWalletManagerUrl)
    .post(`/api/${options.coin}/mpc/sign/mpcv2round3`)
    .reply(200, { signatureShareRound3: round3SignatureShare });

  return {
    round1SignNock,
    round2SignNock,
    round3SignNock,
    sendTxNock,
    awmRound1Nock,
    awmRound2Nock,
    awmRound3Nock,
  };
}

export interface NockEcdsaMpcv2SendManySigningFlowOptions {
  coin: string;
  walletId: string;
  bitgoApiUrl: string;
  advancedWalletManagerUrl: string;
  txRequestId?: string;
  serializedTxHex?: string;
  commonKeychain?: string;
}

/**
 * Nocks ECDSA MPCv2 flow for sendMany (create tx request, persist getTxRequest, transfer, etc.).
 */
export function nockEcdsaMpcv2SendManySigningFlow(
  options: NockEcdsaMpcv2SendManySigningFlowOptions,
) {
  const txRequestId = options.txRequestId ?? DEFAULT_ECDSA_MPCV2_TX_REQUEST_ID;
  const serializedTxHex = options.serializedTxHex ?? 'testSerializedTxHex';
  const commonKeychain = options.commonKeychain ?? 'test-common-keychain';

  const pendingTxRequest = buildEcdsaMpcv2TxRequest('pendingUserSignature', {
    walletId: options.walletId,
    txRequestId,
    serializedTxHex,
  });
  const signedTxRequest = buildSignedEcdsaMpcv2TxRequest({
    walletId: options.walletId,
    txRequestId,
    serializedTxHex,
  });

  nock(options.bitgoApiUrl)
    .persist()
    .get(`/api/v2/${options.coin}/key/user-key-id`)
    .matchHeader('any', () => true)
    .reply(200, {
      id: 'user-key-id',
      pub: 'xpub_user',
      commonKeychain,
      source: 'user',
      type: 'tss',
    });

  const createTxRequestNock = nock(options.bitgoApiUrl)
    .post(`/api/v2/wallet/${options.walletId}/txrequests`)
    .matchHeader('any', () => true)
    .reply(200, pendingTxRequest);

  nock(options.bitgoApiUrl)
    .persist()
    .get(`/api/v2/wallet/${options.walletId}/txrequests`)
    .query(true)
    .matchHeader('any', () => true)
    .reply(200, { txRequests: [signedTxRequest] });

  const transferNock = nock(options.bitgoApiUrl)
    .post(`/api/v2/wallet/${options.walletId}/txrequests/${txRequestId}/transfers`)
    .matchHeader('any', () => true)
    .reply(200, { state: 'signed' });

  const signingNocks = nockEcdsaMpcv2SigningFlow({
    coin: options.coin,
    bitgoApiUrl: options.bitgoApiUrl,
    advancedWalletManagerUrl: options.advancedWalletManagerUrl,
    walletId: options.walletId,
    txRequestId,
    sendResponse: pendingTxRequest,
    pendingTxRequest,
    includeBitgoKeychainNock: true,
    commonKeychain,
  });

  return {
    createTxRequestNock,
    transferNock,
    ...signingNocks,
  };
}
