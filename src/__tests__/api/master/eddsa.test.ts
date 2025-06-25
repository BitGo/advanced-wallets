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
  EddsaUtils,
  openpgpUtils,
} from '@bitgo/sdk-core';
import { EnclavedExpressClient } from '../../../../src/api/master/clients/enclavedExpressClient';
import { handleEddsaSigning } from '../../../../src/api/master/handlers/eddsa';
import { BitGo } from 'bitgo';
import { readKey } from 'openpgp';

describe('Eddsa Signing Handler', () => {
  let bitgo: BitGoBase;
  let wallet: Wallet;
  let enclavedExpressClient: EnclavedExpressClient;
  let reqId: IRequestTracer;
  const bitgoApiUrl = Environments.local.uri;
  const enclavedExpressUrl = 'http://enclaved.invalid';
  const coin = 'tbtc';
  const walletId = 'test-wallet-id';

  before(() => {
    // Disable all real network connections
    nock.disableNetConnect();
  });

  beforeEach(() => {
    bitgo = new BitGo({ env: 'local' });
    wallet = {
      id: () => 'test-wallet-id',
    } as Wallet;
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

  it('should successfully sign an Eddsa transaction', async () => {
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

    const bitgoGpgKey = await openpgpUtils.generateGPGKeyPair('ed25519');
    const getGPGKeysStub = sinon.stub().resolves([{ pub: bitgoGpgKey.publicKey }]);

    const pgpKey = await readKey({ armoredKey: bitgoGpgKey.publicKey });
    sinon.stub(EddsaUtils.prototype, 'getBitgoPublicGpgKey').resolves(pgpKey);

    // Mock getTxRequest call
    const getTxRequestNock = nock(bitgoApiUrl)
      .get(`/api/v2/wallet/${walletId}/txrequests`)
      .query({ txRequestIds: 'test-tx-request-id', latest: true })
      .matchHeader('any', () => true)
      .reply(200, {
        txRequests: [
          {
            txRequestId: 'test-tx-request-id',
            state: 'signed',
            apiVersion: 'full',
            pendingApprovalId: 'test-pending-approval-id',
            transactions: [
              {
                unsignedTx: {
                  derivationPath: 'm/0',
                  signableHex: 'testMessage',
                },
              },
            ],
          },
        ],
      });

    // Mock exchangeEddsaCommitments call
    const exchangeCommitmentsNock = nock(bitgoApiUrl)
      .post(`/api/v2/wallet/${walletId}/txrequests/test-tx-request-id/transactions/0/commit`)
      .matchHeader('any', () => true)
      .reply(200, {
        commitmentShare: { share: 'bitgo-commitment-share' },
      });

    // Mock offerUserToBitgoRShare call
    const offerRShareNock = nock(bitgoApiUrl)
      .post(
        `/api/v2/wallet/${walletId}/txrequests/test-tx-request-id/transactions/0/signatureshares`,
      )
      .matchHeader('any', () => true)
      .reply(200, {
        share: 'user-to-bitgo-r-share',
        from: 'bitgo',
        to: 'user',
      });

    // Mock getBitgoToUserRShare call
    const getBitgoRShareNock = nock(bitgoApiUrl)
      .get(`/api/v2/wallet/${walletId}/txrequests`)
      .query({ txRequestIds: 'test-tx-request-id', latest: true })
      .matchHeader('any', () => true)
      .reply(200, {
        txRequests: [
          {
            txRequestId: 'test-tx-request-id',
            state: 'signed',
            apiVersion: 'full',
            pendingApprovalId: 'test-pending-approval-id',
            transactions: [
              {
                unsignedTx: {
                  derivationPath: 'm/0',
                  signableHex: 'testMessage',
                },
                signatureShares: [
                  {
                    share: 'bitgo-to-user-r-share',
                    from: 'bitgo',
                    to: 'user',
                    type: 'r',
                  },
                  {
                    share: 'user-to-bitgo-r-share',
                    from: 'user',
                    to: 'bitgo',
                    type: 'r',
                  },
                ],
              },
            ],
          },
        ],
      });

    // Mock sendUserToBitgoGShare call
    const sendGShareNock = nock(bitgoApiUrl)
      .post(
        `/api/v2/wallet/${walletId}/txrequests/test-tx-request-id/transactions/0/signatureshares`,
      )
      .matchHeader('any', () => true)
      .reply(200, {
        share: 'user-to-bitgo-g-share',
        from: 'bitgo',
        to: 'user',
      });

    // Mock final getTxRequest call
    const finalGetTxRequestNock = nock(bitgoApiUrl)
      .get(`/api/v2/wallet/${walletId}/txrequests`)
      .query({ txRequestIds: 'test-tx-request-id', latest: true })
      .matchHeader('any', () => true)
      .reply(200, {
        txRequests: [
          {
            ...txRequest,
            state: 'signed',
          },
        ],
      });

    // Mock MPC commitment signing
    const signMpcCommitmentNockEbe = nock(enclavedExpressUrl)
      .post(`/api/${coin}/mpc/sign/commitment`)
      .reply(200, {
        userToBitgoCommitment: { share: 'user-commitment-share' },
        encryptedSignerShare: { share: 'encrypted-signer-share' },
        encryptedUserToBitgoRShare: { share: 'encrypted-user-to-bitgo-r-share' },
        encryptedDataKey: 'test-encrypted-data-key',
      });

    // Mock MPC R-share signing
    const signMpcRShareNockEbe = nock(enclavedExpressUrl)
      .post(`/api/${coin}/mpc/sign/r`)
      .reply(200, {
        rShare: {
          rShares: [
            { r: 'r-share', R: 'R-share' },
            { r: 'r-share-2', R: 'R-share-2' },
            { r: 'r-share-3', R: 'R-share-3' },
            { r: 'r-share-4', R: 'R-share-4', i: 3, j: 1 },
          ],
        },
      });

    // Mock MPC G-share signing
    const signMpcGShareNockEbe = nock(enclavedExpressUrl)
      .post(`/api/${coin}/mpc/sign/g`)
      .reply(200, {
        gShare: {
          r: 'r',
          gamma: 'gamma',
          i: 1, // USER position
          j: 3, // BITGO position
          n: 4,
        },
      });

    (bitgo as any).getGPGKeys = getGPGKeysStub;

    const result = await handleEddsaSigning(
      bitgo,
      wallet,
      txRequest.txRequestId,
      enclavedExpressClient,
      userPubKey,
      reqId,
    );

    result.should.eql({
      ...txRequest,
      state: 'signed',
    });

    getTxRequestNock.done();
    exchangeCommitmentsNock.done();
    offerRShareNock.done();
    getBitgoRShareNock.done();
    sendGShareNock.done();
    finalGetTxRequestNock.done();
    signMpcCommitmentNockEbe.done();
    signMpcRShareNockEbe.done();
    signMpcGShareNockEbe.done();
  });
});
