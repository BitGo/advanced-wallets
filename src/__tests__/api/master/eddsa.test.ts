import 'should';
import nock from 'nock';
import * as sinon from 'sinon';
import {
  BitGoBase,
  EddsaUtils,
  Environments,
  IRequestTracer,
  openpgpUtils,
  RequestTracer,
  TxRequest,
  Wallet,
} from '@bitgo-beta/sdk-core';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { AdvancedWalletManagerClient as AdvancedWalletManagerClient } from '../../../api/master/clients/advancedWalletManagerClient';
import { handleEddsaSigning } from '../../../api/master/handlers/eddsa';
import { readKey } from 'openpgp';

// TODO: Re-enable once using EDDSA Custom signing fns
describe('Eddsa Signing Handler', () => {
  let bitgo: BitGoBase;
  let wallet: Wallet;
  let awmClient: AdvancedWalletManagerClient;
  let reqId: IRequestTracer;
  const bitgoApiUrl = Environments.local.uri;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const coin = 'tbtc';
  const walletId = 'test-wallet-id';

  before(() => {
    // Disable all real network connections
    nock.disableNetConnect();
  });

  beforeEach(() => {
    bitgo = new BitGoAPI({ env: 'local' });
    wallet = {
      id: () => 'test-wallet-id',
    } as Wallet;
    awmClient = new AdvancedWalletManagerClient(
      {
        advancedWalletManagerUrl,
        advancedWalletManagerCert: 'dummy-cert',
        tlsMode: 'disabled',
        clientCertAllowSelfSigned: true,
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
      apiVersion: 'full',
      enterpriseId: 'test-enterprise-id',
      transactions: [
        {
          state: 'pendingSignature',
          unsignedTx: {
            derivationPath: 'm/0',
            signableHex: 'testMessage',
            serializedTxHex: 'testSerializedTxHex',
          },
          signatureShares: [
            {
              share: 'bitgo-to-user-r-share',
              from: 'bitgo',
              to: 'user',
            },
            {
              share: 'user-to-bitgo-r-share',
              from: 'user',
              to: 'bitgo',
            },
          ],
        },
      ],
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
    const signMpcCommitmentNockAwm = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/mpc/sign/commitment`)
      .reply(200, {
        userToBitgoCommitment: { share: 'user-commitment-share' },
        encryptedSignerShare: { share: 'encrypted-signer-share' },
        encryptedUserToBitgoRShare: { share: 'encrypted-user-to-bitgo-r-share' },
        encryptedDataKey: 'test-encrypted-data-key',
      });

    // Mock MPC R-share signing
    const signMpcRShareNockAwm = nock(advancedWalletManagerUrl)
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
    const signMpcGShareNockAwm = nock(advancedWalletManagerUrl)
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

    const result = await handleEddsaSigning(bitgo, wallet, txRequest, awmClient, userPubKey, reqId);

    result.should.eql({
      ...txRequest,
      state: 'signed',
    });

    exchangeCommitmentsNock.done();
    offerRShareNock.done();
    getBitgoRShareNock.done();
    sendGShareNock.done();
    finalGetTxRequestNock.done();
    signMpcCommitmentNockAwm.done();
    signMpcRShareNockAwm.done();
    signMpcGShareNockAwm.done();
  });
});
