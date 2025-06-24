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
} from '@bitgo/sdk-core';
import { EnclavedExpressClient } from '../../../../src/api/master/clients/enclavedExpressClient';
import { handleEddsaSigning } from '../../../../src/api/master/handlers/eddsa';
import { BitGo } from 'bitgo';

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

    const getGPGKeysStub = sinon.stub().resolves([{ pub: 'test-gpg-key' }]);

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
              },
            ],
            signatureShares: [
              {
                share: 'bitgo-to-user-r-share',
                from: 'bitgo',
                to: 'user',
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
      .reply(200, txRequest);

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
        rShare: { share: 'r-share' },
      });

    // Mock MPC G-share signing
    const signMpcGShareNockEbe = nock(enclavedExpressUrl)
      .post(`/api/${coin}/mpc/sign/g`)
      .reply(200, {
        gShare: { share: 'g-share' },
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

    result.should.eql(txRequest);

    sinon.assert.calledWith(getGPGKeysStub);
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
