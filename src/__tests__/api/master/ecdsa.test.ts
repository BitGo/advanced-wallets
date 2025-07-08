import 'should';
import nock from 'nock';
import * as sinon from 'sinon';
import {
  BitGoBase,
  Wallet,
  TxRequest,
  IRequestTracer,
  TxRequestVersion,
  Environments,
  RequestTracer,
  EcdsaMPCv2Utils,
  openpgpUtils,
  SignatureShareRecord,
  SignatureShareType,
  TransactionState,
} from '@bitgo/sdk-core';
import { EnclavedExpressClient } from '../../../../src/api/master/clients/enclavedExpressClient';
import { handleEcdsaMPCv2Signing } from '../../../../src/api/master/handlers/ecdsa';
import { BitGo } from 'bitgo';
import { readKey } from 'openpgp';

describe('Ecdsa Signing Handler', () => {
  let bitgo: BitGoBase;
  let wallet: Wallet;
  let enclavedExpressClient: EnclavedExpressClient;
  let reqId: IRequestTracer;
  const bitgoApiUrl = Environments.local.uri;
  const enclavedExpressUrl = 'http://enclaved.invalid';
  const coin = 'hteth'; // Use hteth for ECDSA testing
  const walletId = 'test-wallet-id';

  before(() => {
    // Disable all real network connections
    nock.disableNetConnect();
  });

  beforeEach(() => {
    bitgo = new BitGo({ env: 'local' });
    wallet = {
      id: () => 'test-wallet-id',
      baseCoin: {
        getMPCAlgorithm: () => 'ecdsa',
      },
      multisigTypeVersion: () => 2,
    } as unknown as Wallet;
    enclavedExpressClient = new EnclavedExpressClient(
      {
        enclavedExpressUrl,
        enclavedExpressCert: 'dummy-cert',
        tlsMode: 'disabled',
        allowSelfSigned: true,
      } as any,
      coin,
    );
    reqId = new RequestTracer();
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  after(() => {
    // Re-enable network connections after tests
    nock.enableNetConnect();
  });

  it('should successfully sign an ECDSA MPCv2 transaction', async () => {
    const txRequest: TxRequest = {
      txRequestId: 'test-tx-request-id',
      apiVersion: '2.0.0' as TxRequestVersion,
      enterpriseId: 'test-enterprise-id',
      transactions: [],
      state: 'pendingUserSignature',
      walletId: 'test-wallet-id',
      walletType: 'hot',
      version: 2,
      date: new Date().toISOString(),
      userId: 'test-user-id',
      intent: {},
      policiesChecked: true,
      unsignedTxs: [],
      latest: true,
    };
    const userPubKey = 'test-user-pub-key';

    const bitgoGpgKey = await openpgpUtils.generateGPGKeyPair('secp256k1');
    const pgpKey = await readKey({ armoredKey: bitgoGpgKey.publicKey });
    sinon.stub(EcdsaMPCv2Utils.prototype, 'getBitgoMpcv2PublicGpgKey').resolves(pgpKey);

    // Mock getTxRequest call
    const getTxRequestNock = nock(bitgoApiUrl)
      .get(`/api/v2/wallet/${walletId}/txrequests`)
      .query({ txRequestIds: 'test-tx-request-id', latest: true })
      .matchHeader('any', () => true)
      .reply(200, {
        txRequests: [txRequest],
      });

    // Mock sendSignatureShareV2 calls for each round
    const round1SignatureShare: SignatureShareRecord = {
      from: SignatureShareType.USER,
      to: SignatureShareType.BITGO,
      share: JSON.stringify({
        type: 'round1Input',
        data: {
          msg1: {
            from: 1,
            message: 'round1-message',
          },
        },
      }),
    };

    const round1TxRequest: TxRequest = {
      ...txRequest,
      transactions: [
        {
          unsignedTx: {
            derivationPath: 'm/0',
            signableHex: 'testMessage',
            serializedTxHex: 'testMessage',
          },
          signatureShares: [round1SignatureShare],
          state: 'pendingSignature' as TransactionState,
        },
      ],
    };

    const sendSignatureShareV2Round1Nock = nock(bitgoApiUrl)
      .post(`/api/v2/wallet/${walletId}/txrequests/test-tx-request-id/transactions/0/sign`)
      .matchHeader('any', () => true)
      .reply(200, {
        ...round1TxRequest,
      });

    const round2SignatureShare: SignatureShareRecord = {
      from: SignatureShareType.USER,
      to: SignatureShareType.BITGO,
      share: JSON.stringify({
        type: 'round2Input',
        data: {
          msg2: {
            from: 1,
            to: 3,
            encryptedMessage: 'round2-encrypted-message',
            signature: 'round2-signature',
          },
          msg3: {
            from: 1,
            to: 3,
            encryptedMessage: 'round3-encrypted-message',
            signature: 'round3-signature',
          },
        },
      }),
    };

    const round2TxRequest: TxRequest = {
      ...round1TxRequest,
      transactions: [
        {
          ...round1TxRequest.transactions![0],
          signatureShares: [round1SignatureShare, round2SignatureShare],
        },
      ],
    };

    const sendSignatureShareV2Round2Nock = nock(bitgoApiUrl)
      .post(`/api/v2/wallet/${walletId}/txrequests/test-tx-request-id/transactions/0/sign`)
      .matchHeader('any', () => true)
      .reply(200, {
        ...round2TxRequest,
      });

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

    const sendSignatureShareV2Round3Nock = nock(bitgoApiUrl)
      .post(`/api/v2/wallet/${walletId}/txrequests/test-tx-request-id/transactions/0/sign`)
      .matchHeader('any', () => true)
      .reply(200, {
        ...round2TxRequest,
        transactions: [
          {
            ...round2TxRequest.transactions![0],
            signatureShares: [round1SignatureShare, round2SignatureShare, round3SignatureShare],
          },
        ],
      });

    // Mock sendTxRequest call
    const sendTxRequestNock = nock(bitgoApiUrl)
      .post(`/api/v2/wallet/${walletId}/txrequests/test-tx-request-id/transactions/0/send`)
      .matchHeader('any', () => true)
      .reply(200, {
        ...txRequest,
        state: 'signed',
      });

    // Mock MPCv2 Round 1 signing
    const signMpcV2Round1NockEbe = nock(enclavedExpressUrl)
      .post(`/api/${coin}/mpc/sign/mpcv2round1`)
      .reply(200, {
        signatureShareRound1: round1SignatureShare,
        userGpgPubKey: bitgoGpgKey.publicKey,
        encryptedRound1Session: 'encrypted-round1-session',
        encryptedUserGpgPrvKey: 'encrypted-user-gpg-prv-key',
        encryptedDataKey: 'test-encrypted-data-key',
      });

    // Mock MPCv2 Round 2 signing
    const signMpcV2Round2NockEbe = nock(enclavedExpressUrl)
      .post(`/api/${coin}/mpc/sign/mpcv2round2`)
      .reply(200, {
        signatureShareRound2: round2SignatureShare,
        encryptedRound2Session: 'encrypted-round2-session',
      });

    // Mock MPCv2 Round 3 signing
    const signMpcV2Round3NockEbe = nock(enclavedExpressUrl)
      .post(`/api/${coin}/mpc/sign/mpcv2round3`)
      .reply(200, {
        signatureShareRound3: round3SignatureShare,
      });

    const result = await handleEcdsaMPCv2Signing(
      bitgo,
      wallet,
      txRequest.txRequestId,
      enclavedExpressClient,
      'user',
      userPubKey,
      reqId,
    );

    result.should.eql({
      ...txRequest,
      state: 'signed',
    });

    getTxRequestNock.done();
    sendSignatureShareV2Round1Nock.done();
    sendSignatureShareV2Round2Nock.done();
    sendSignatureShareV2Round3Nock.done();
    sendTxRequestNock.done();
    signMpcV2Round1NockEbe.done();
    signMpcV2Round2NockEbe.done();
    signMpcV2Round3NockEbe.done();
  });
});
