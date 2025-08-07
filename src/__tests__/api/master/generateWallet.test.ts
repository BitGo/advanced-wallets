import 'should';
import assert from 'assert';

import * as request from 'supertest';
import nock from 'nock';
import sinon from 'sinon';
import { app as expressApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { Environments } from '@bitgo-beta/sdk-core';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import * as middleware from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';

/**
 * This test suite demonstrates how to mock the BitGo SDK's fetchConstants method
 * instead of using nock to intercept HTTP requests to the constants endpoint.
 *
 * By using sinon to stub the fetchConstants method directly, we make the tests more
 * focused on behavior rather than implementation details, and less brittle to changes
 * in how the constants are fetched.
 */

describe('POST /api/:coin/wallet/generate', () => {
  let agent: request.SuperAgentTest;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const bitgoApiUrl = Environments.test.uri;
  const coin = 'tbtc';
  const eddsaCoin = 'tsol';
  const ecdsaCoin = 'hteth';
  const accessToken = 'test-token';

  let bitgo: BitGoAPI;

  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // Create a BitGo instance that we'll use for stubbing
    bitgo = new BitGoAPI({ env: 'test' });

    const config: MasterExpressConfig = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl: advancedWalletManagerUrl,
      advancedWalletManagerCert: 'dummy-cert',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    // Setup middleware stubs before creating app
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<MasterExpressConfig>).bitgo = bitgo;
      (req as BitGoRequest<MasterExpressConfig>).config = config;
      next();
    });

    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should generate a wallet by calling the advanced wallet manager service', async () => {
    const userKeychainNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/key/independent`, {
        source: 'user',
      })
      .reply(200, {
        pub: 'xpub_user',
        source: 'user',
        type: 'independent',
      });

    const backupKeychainNock = nock(advancedWalletManagerUrl)
      .post(`/api/${coin}/key/independent`, {
        source: 'backup',
      })
      .reply(200, {
        pub: 'xpub_backup',
        source: 'backup',
        type: 'independent',
      });

    const bitgoAddUserKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/key`, {
        pub: 'xpub_user',
        keyType: 'independent',
        source: 'user',
      })
      .matchHeader('any', () => true)
      .reply(200, { id: 'user-key-id', pub: 'xpub_user' });

    const bitgoAddBackupKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/key`, {
        pub: 'xpub_backup',
        keyType: 'independent',
        source: 'backup',
      })
      .matchHeader('any', () => true)
      .reply(200, { id: 'backup-key-id', pub: 'xpub_backup' });

    const bitgoAddBitGoKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/key`, {
        source: 'bitgo',
        keyType: 'independent',
        enterprise: 'test_enterprise',
      })
      .reply(200, { id: 'bitgo-key-id', pub: 'xpub_bitgo' });

    const bitgoAddWalletNock = nock(bitgoApiUrl)
      .post(`/api/v2/${coin}/wallet/add`, {
        label: 'test_wallet',
        m: 2,
        n: 3,
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        type: 'cold',
        subType: 'onPrem',
        multisigType: 'onchain',
        enterprise: 'test_enterprise',
      })
      .matchHeader('any', () => true)
      .reply(200, {
        id: 'new-wallet-id',
        multisigType: 'onchain',
        type: 'cold',
        subType: 'onPrem',
      });

    const response = await agent
      .post(`/api/${coin}/wallet/generate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'test_wallet',
        enterprise: 'test_enterprise',
        multisigType: 'onchain',
      });

    response.status.should.equal(200);
    response.body.should.have.property('wallet');
    response.body.wallet.should.have.properties({
      id: 'new-wallet-id',
      multisigType: 'onchain',
      type: 'cold',
      subType: 'onPrem',
    });
    response.body.should.have.propertyByPath('userKeychain', 'pub').eql('xpub_user');
    response.body.should.have.propertyByPath('backupKeychain', 'pub').eql('xpub_backup');
    response.body.should.have.propertyByPath('bitgoKeychain', 'pub').eql('xpub_bitgo');

    userKeychainNock.done();
    backupKeychainNock.done();
    bitgoAddUserKeyNock.done();
    bitgoAddBackupKeyNock.done();
    bitgoAddBitGoKeyNock.done();
    bitgoAddWalletNock.done();
  });

  it('should generate a TSS MPC v1 wallet by calling the advanced wallet manager service', async () => {
    // Mock fetchConstants instead of using nock for URL mocking
    sinon.stub(bitgo, 'fetchConstants').resolves({
      mpc: {
        bitgoPublicKey: 'test-bitgo-public-key',
      },
    });

    const userInitNock = nock(advancedWalletManagerUrl)
      .post(`/api/${eddsaCoin}/mpc/key/initialize`, {
        source: 'user',
        bitgoGpgPub: 'test-bitgo-public-key',
      })
      .reply(200, {
        encryptedDataKey: 'key',
        encryptedData: 'data',
        bitgoPayload: {
          from: 'user',
          to: 'bitgo',
          publicShare: 'public-share-user',
          privateShare: 'private-share-user-to-bitgo',
          privateShareProof: 'proof',
          vssProof: 'proof',
          gpgKey: 'user-key',
        },
      });

    const backupInitNock = nock(advancedWalletManagerUrl)
      .post(`/api/${eddsaCoin}/mpc/key/initialize`, {
        source: 'backup',
        bitgoGpgPub: 'test-bitgo-public-key',
        counterPartyGpgPub: 'user-key',
      })
      .reply(200, {
        encryptedDataKey: 'key',
        encryptedData: 'data',
        bitgoPayload: {
          from: 'backup',
          to: 'bitgo',
          publicShare: 'public-share-backup',
          privateShare: 'private-share-backup-to-bitgo',
          privateShareProof: 'proof',
          vssProof: 'proof',
          gpgKey: 'backup-key',
        },
        counterPartyKeyShare: {
          from: 'backup',
          to: 'user',
          publicShare: 'public-share-backup',
          privateShare: 'private-share-backup-to-user',
          privateShareProof: 'proof',
          vssProof: 'proof',
          gpgKey: 'backup-key',
        },
      });

    const bitgoAddKeychainNock = nock(bitgoApiUrl)
      .post(`/api/v2/${eddsaCoin}/key`, {
        keyType: 'tss',
        source: 'bitgo',
        enterprise: 'test_enterprise',
        keyShares: [
          {
            from: 'user',
            to: 'bitgo',
            publicShare: 'public-share-user',
            privateShare: 'private-share-user-to-bitgo',
            privateShareProof: 'proof',
            vssProof: 'proof',
            gpgKey: 'user-key',
          },
          {
            from: 'backup',
            to: 'bitgo',
            publicShare: 'public-share-backup',
            privateShare: 'private-share-backup-to-bitgo',
            privateShareProof: 'proof',
            vssProof: 'proof',
            gpgKey: 'backup-key',
          },
        ],
        userGPGPublicKey: 'user-key',
        backupGPGPublicKey: 'backup-key',
      })
      .reply(200, {
        id: 'id',
        source: 'bitgo',
        type: 'tss',
        commonKeychain: 'commonKeychain',
        verifiedVssProof: true,
        isBitGo: true,
        isTrust: true,
        hsmType: 'institutional',
        keyShares: [
          {
            from: 'bitgo',
            to: 'user',
            publicShare: 'publicShare',
            privateShare: 'privateShare',
            vssProof: 'true',
            gpgKey: 'bitgo-key',
          },
          {
            from: 'bitgo',
            to: 'backup',
            publicShare: 'publicShare',
            privateShare: 'privateShare',
            vssProof: 'true',
            gpgKey: 'bitgo-key',
          },
        ],
        walletHSMGPGPublicKeySigs: 'hsm-sig',
      });

    const userFinalizeNock = nock(advancedWalletManagerUrl)
      .post(`/api/${eddsaCoin}/mpc/key/finalize`, {
        source: 'user',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        counterPartyGpgPub: 'backup-key',
        bitgoKeyChain: {
          id: 'id',
          source: 'bitgo',
          type: 'tss',
          commonKeychain: 'commonKeychain',
          verifiedVssProof: true,
          isBitGo: true,
          isTrust: false,
          hsmType: 'institutional',
          keyShares: [
            {
              from: 'bitgo',
              to: 'user',
              publicShare: 'publicShare',
              privateShare: 'privateShare',
              vssProof: 'true',
              gpgKey: 'bitgo-key',
            },
            {
              from: 'bitgo',
              to: 'backup',
              publicShare: 'publicShare',
              privateShare: 'privateShare',
              vssProof: 'true',
              gpgKey: 'bitgo-key',
            },
          ],
          walletHSMGPGPublicKeySigs: 'hsm-sig',
        },
        coin: 'tsol',
        counterPartyKeyShare: {
          from: 'backup',
          to: 'user',
          publicShare: 'public-share-backup',
          privateShare: 'private-share-backup-to-user',
          privateShareProof: 'proof',
          vssProof: 'proof',
          gpgKey: 'backup-key',
        },
      })
      .reply(200, {
        counterpartyKeyShare: {
          from: 'user',
          to: 'backup',
          publicShare: 'publicShare',
          privateShare: 'privateShare',
          privateShareProof: 'privateShareProof',
          vssProof: 'vssProof',
          gpgKey: 'user-key',
        },
        source: 'user',
        commonKeychain: 'commonKeychain',
      });
    const addUserKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${eddsaCoin}/key`, {
        commonKeychain: 'commonKeychain',
        source: 'user',
        type: 'tss',
      })
      .reply(200, {
        id: 'id',
        source: 'user',
        type: 'tss',
        commonKeychain: 'commonKeychain',
      });
    const backupFinalizeNock = nock(advancedWalletManagerUrl)
      .post(`/api/${eddsaCoin}/mpc/key/finalize`, {
        source: 'backup',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        counterPartyGpgPub: 'user-key',
        bitgoKeyChain: {
          id: 'id',
          source: 'bitgo',
          type: 'tss',
          commonKeychain: 'commonKeychain',
          verifiedVssProof: true,
          isBitGo: true,
          isTrust: false,
          hsmType: 'institutional',
          keyShares: [
            {
              from: 'bitgo',
              to: 'user',
              publicShare: 'publicShare',
              privateShare: 'privateShare',
              vssProof: 'true',
              gpgKey: 'bitgo-key',
            },
            {
              from: 'bitgo',
              to: 'backup',
              publicShare: 'publicShare',
              privateShare: 'privateShare',
              vssProof: 'true',
              gpgKey: 'bitgo-key',
            },
          ],
          walletHSMGPGPublicKeySigs: 'hsm-sig',
        },
        coin: 'tsol',
        counterPartyKeyShare: {
          from: 'user',
          to: 'backup',
          publicShare: 'publicShare',
          privateShare: 'privateShare',
          privateShareProof: 'privateShareProof',
          vssProof: 'vssProof',
          gpgKey: 'user-key',
        },
      })
      .reply(200, {
        source: 'backup',
        commonKeychain: 'commonKeychain',
      });

    const addBackupKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${eddsaCoin}/key`, {
        source: 'backup',
        type: 'tss',
        commonKeychain: 'commonKeychain',
      })
      .reply(200, {
        id: 'id',
        source: 'backup',
        type: 'tss',
        commonKeychain: 'commonKeychain',
      });

    const addWalletNock = nock(bitgoApiUrl)
      .post(`/api/v2/${eddsaCoin}/wallet/add`, {
        label: 'test_wallet',
        m: 2,
        n: 3,
        keys: ['id', 'id', 'id'],
        type: 'cold',
        subType: 'onPrem',
        multisigType: 'tss',
        enterprise: 'test_enterprise',
      })
      .reply(200, {
        id: '685cb53debcd0bcb5ab4fe80d2b74be2',
        users: [['Object']],
        coin: 'tsol',
        label: 'OnPrem eddsa sendMany test 2025-06-26T02:49:18.622Z',
        m: 2,
        n: 3,
        keys: [
          '685cb5393d57687bdf0a464594ca9e36',
          '685cb53a3d57687bdf0a4657b5f1f364',
          '685cb536f21050339163a75dd04d41bf',
        ],
        keySignatures: {},
        enterprise: '6750c2d327511bc4e5f83ccfcfe1b3eb',
        organization: '6750c2e027511bc4e5f83d251248fc14',
        bitgoOrg: 'BitGo Trust',
        tags: ['685cb53debcd0bcb5ab4fe80d2b74be2', '6750c2d327511bc4e5f83ccfcfe1b3eb'],
        disableTransactionNotifications: false,
        freeze: {},
        deleted: false,
        approvalsRequired: 1,
        isCold: true,
        coinSpecific: {
          rootAddress: '74AUHib3F6Fq5eVm2ywP5ik9iQjviwAfZXWnGM9JHhJ4',
          pendingChainInitialization: true,
          minimumFunding: 2447136,
          lastChainIndex: ['Object'],
          nonceExpiresAt: '2025-06-25T23:00:12.019Z',
          trustedTokens: [],
        },
        admin: {
          policy: ['Object'],
        },
        clientFlags: [],
        walletFlags: [],
        allowBackupKeySigning: false,
        recoverable: false,
        startDate: '2025-06-26T02:49:33.000Z',
        type: 'cold',
        buildDefaults: {},
        customChangeKeySignatures: {},
        hasLargeNumberOfAddresses: false,
        multisigType: 'tss',
        hasReceiveTransferPolicy: false,
        creator: '63f512adc61d7100088e99bf1deece73',
        subType: 'onPrem',
        config: {},
        pendingChainInitialization: true,
        balanceString: '0',
        confirmedBalanceString: '0',
        spendableBalanceString: '0',
        reservedBalanceString: '0',
        receiveAddress: {
          id: '685cb53eebcd0bcb5ab4fe8ed214d5b9',
          address: '74AUHib3F6Fq5eVm2ywP5ik9iQjviwAfZXWnGM9JHhJ4',
          chain: 0,
          index: 0,
          coin: 'tsol',
          wallet: '685cb53debcd0bcb5ab4fe80d2b74be2',
          coinSpecific: ['Object'],
        },
      });

    const response = await agent
      .post(`/api/${eddsaCoin}/wallet/generate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'test_wallet',
        enterprise: 'test_enterprise',
        multisigType: 'tss',
      });

    // No need to check constantsNock since we're using sinon stub
    userInitNock.done();
    backupInitNock.done();
    bitgoAddKeychainNock.done();
    userFinalizeNock.done();
    addUserKeyNock.done();
    backupFinalizeNock.done();
    addBackupKeyNock.done();
    addWalletNock.done();
    response.status.should.equal(200);
  });

  it('should generate a TSS MPC v2 wallet by calling the advanced wallet manager service', async () => {
    // Mock fetchConstants instead of using nock for URL mocking
    sinon.stub(bitgo, 'fetchConstants').resolves({
      mpc: {
        bitgoMPCv2PublicKey: 'test-bitgo-public-key',
      },
    });
    // init round
    const userInitNock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/initialize`, {
        source: 'user',
      })
      .reply(200, {
        encryptedDataKey: 'key',
        encryptedData: 'data',
        gpgPub: 'test-user-public-key',
      });

    const backupInitNock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/initialize`, {
        source: 'backup',
      })
      .reply(200, {
        encryptedDataKey: 'key',
        encryptedData: 'data',
        gpgPub: 'test-backup-public-key',
      });

    const userRound1Nock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/round`, {
        source: 'user',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        round: 1,
        bitgoGpgPub: 'test-bitgo-public-key',
        counterPartyGpgPub: 'test-backup-public-key',
      })
      .reply(200, {
        round: 2,
        encryptedDataKey: 'key',
        encryptedData: 'data',
        broadcastMessage: {
          from: 0,
          payload: {
            message: 'test-broadcast-message-user-1',
            signature: 'test-signature-user-1',
          },
        },
      });

    const backupRound1Nock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/round`, {
        source: 'backup',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        round: 1,
        bitgoGpgPub: 'test-bitgo-public-key',
        counterPartyGpgPub: 'test-user-public-key',
      })
      .reply(200, {
        round: 2,
        encryptedDataKey: 'key',
        encryptedData: 'data',
        broadcastMessage: {
          from: 1,
          payload: {
            message: 'test-broadcast-message-backup-1',
            signature: 'test-signature-backup-1',
          },
        },
      });

    const bitgoRound1And2Nock = nock(bitgoApiUrl)
      .post(`/api/v2/mpc/generatekey`, {
        enterprise: 'test-enterprise', // ?
        type: 'MPCv2',
        round: 'MPCv2-R1',
        payload: {
          userGpgPublicKey: 'test-user-public-key',
          backupGpgPublicKey: 'test-backup-public-key',
          userMsg1: {
            from: 0,
            message: 'test-broadcast-message-user-1',
            signature: 'test-signature-user-1',
          },
          backupMsg1: {
            from: 1,
            message: 'test-broadcast-message-backup-1',
            signature: 'test-signature-backup-1',
          },
          walletId: undefined,
        },
      })
      .reply(200, {
        walletGpgPubKeySigs: 'test-wallet-gpg-pub-key-sigs',
        sessionId: 'test-session-id',
        bitgoMsg1: {
          from: 2,
          message: 'test-broadcast-message-bitgo-1',
          signature: 'test-signature-bitgo-1',
        },
        bitgoToUserMsg2: {
          from: 2,
          to: 0,
          encryptedMessage: 'test-p2p-message-bitgo-to-user-2',
          signature: 'test-signature-bitgo-to-user-2',
        },
        bitgoToBackupMsg2: {
          from: 2,
          to: 1,
          encryptedMessage: 'test-p2p-message-bitgo-to-backup-2',
          signature: 'test-signature-bitgo-to-backup-2',
        },
      });

    const userRound2Nock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/round`, {
        source: 'user',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        round: 2,
        broadcastMessages: {
          bitgo: {
            from: 2,
            payload: {
              message: 'test-broadcast-message-bitgo-1',
              signature: 'test-signature-bitgo-1',
            },
          },
          counterParty: {
            from: 1,
            payload: {
              message: 'test-broadcast-message-backup-1',
              signature: 'test-signature-backup-1',
            },
          },
        },
      })
      .reply(200, {
        round: 3,
        encryptedDataKey: 'key',
        encryptedData: 'data',
        p2pMessages: {
          bitgo: {
            from: 0,
            to: 2,
            payload: {
              encryptedMessage: 'test-p2p-message-user-to-bitgo-2',
              signature: 'test-signature-user-to-bitgo-2',
            },
            commitment: 'test-commitment-user-2',
          },
          counterParty: {
            from: 0,
            to: 1,
            payload: {
              encryptedMessage: 'test-p2p-message-user-to-backup-2',
              signature: 'test-signature-user-to-backup-2',
            },
            commitment: 'test-commitment-user-2',
          },
        },
      });

    const backupRound2Nock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/round`, {
        source: 'backup',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        round: 2,
        broadcastMessages: {
          bitgo: {
            from: 2,
            payload: {
              message: 'test-broadcast-message-bitgo-1',
              signature: 'test-signature-bitgo-1',
            },
          },
          counterParty: {
            from: 0,
            payload: {
              message: 'test-broadcast-message-user-1',
              signature: 'test-signature-user-1',
            },
          },
        },
      })
      .reply(200, {
        round: 3,
        encryptedDataKey: 'key',
        encryptedData: 'data',
        p2pMessages: {
          bitgo: {
            from: 1,
            to: 2,
            payload: {
              encryptedMessage: 'test-p2p-message-backup-to-bitgo-2',
              signature: 'test-signature-backup-to-bitgo-2',
            },
            commitment: 'test-commitment-backup-2',
          },
          counterParty: {
            from: 1,
            to: 0,
            payload: {
              encryptedMessage: 'test-p2p-message-backup-to-user-2',
              signature: 'test-signature-backup-to-user-2',
            },
            commitment: 'test-commitment-backup-2',
          },
        },
      });

    const userRound3Nock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/round`, {
        source: 'user',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        round: 3,
        p2pMessages: {
          bitgo: {
            from: 2,
            to: 0,
            payload: {
              encryptedMessage: 'test-p2p-message-bitgo-to-user-2',
              signature: 'test-signature-bitgo-to-user-2',
            },
            // commitment: undefined,
          },
          counterParty: {
            from: 1,
            to: 0,
            payload: {
              encryptedMessage: 'test-p2p-message-backup-to-user-2',
              signature: 'test-signature-backup-to-user-2',
            },
            commitment: 'test-commitment-backup-2',
          },
        },
      })
      .reply(200, {
        round: 4,
        encryptedDataKey: 'key',
        encryptedData: 'data',
        p2pMessages: {
          bitgo: {
            from: 0,
            to: 2,
            payload: {
              encryptedMessage: 'test-p2p-message-user-to-bitgo-3',
              signature: 'test-signature-user-to-bitgo-3',
            },
            commitment: 'test-commitment-user-3',
          },
          counterParty: {
            from: 0,
            to: 1,
            payload: {
              encryptedMessage: 'test-p2p-message-user-to-backup-3',
              signature: 'test-signature-user-to-backup-3',
            },
            commitment: 'test-commitment-user-3',
          },
        },
      });

    const backupRound3Nock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/round`, {
        source: 'backup',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        round: 3,
        p2pMessages: {
          bitgo: {
            from: 2,
            to: 1,
            payload: {
              encryptedMessage: 'test-p2p-message-bitgo-to-backup-2',
              signature: 'test-signature-bitgo-to-backup-2',
            },
            // commitment: undefined,
          },
          counterParty: {
            from: 0,
            to: 1,
            payload: {
              encryptedMessage: 'test-p2p-message-user-to-backup-2',
              signature: 'test-signature-user-to-backup-2',
            },
            commitment: 'test-commitment-user-2',
          },
        },
      })
      .reply(200, {
        round: 4,
        encryptedDataKey: 'key',
        encryptedData: 'data',
        p2pMessages: {
          bitgo: {
            from: 1,
            to: 2,
            payload: {
              encryptedMessage: 'test-p2p-message-backup-to-bitgo-3',
              signature: 'test-signature-backup-to-bitgo-3',
            },
            commitment: 'test-commitment-backup-3',
          },
          counterParty: {
            from: 1,
            to: 0,
            payload: {
              encryptedMessage: 'test-p2p-message-backup-to-user-3',
              signature: 'test-signature-backup-to-user-3',
            },
            commitment: 'test-commitment-backup-3',
          },
        },
      });

    const bitgoRound3Nock = nock(bitgoApiUrl)
      .post(`/api/v2/mpc/generatekey`, {
        enterprise: 'test-enterprise',
        type: 'MPCv2',
        round: 'MPCv2-R2',
        payload: {
          sessionId: 'test-session-id',
          userMsg2: {
            from: 0,
            to: 2,
            encryptedMessage: 'test-p2p-message-user-to-bitgo-2',
            signature: 'test-signature-user-to-bitgo-2',
          },
          userCommitment2: 'test-commitment-user-2',
          backupMsg2: {
            from: 1,
            to: 2,
            encryptedMessage: 'test-p2p-message-backup-to-bitgo-2',
            signature: 'test-signature-backup-to-bitgo-2',
          },
          backupCommitment2: 'test-commitment-backup-2',
        },
      })
      .reply(200, {
        sessionId: 'test-session-id',
        bitgoCommitment2: 'test-commitment-bitgo-2',
        bitgoToUserMsg3: {
          from: 2,
          to: 0,
          encryptedMessage: 'test-p2p-message-bitgo-to-user-3',
          signature: 'test-signature-bitgo-to-user-3',
        },
        bitgoToBackupMsg3: {
          from: 2,
          to: 1,
          encryptedMessage: 'test-p2p-message-bitgo-to-backup-3',
          signature: 'test-signature-bitgo-to-backup-3',
        },
      });

    const userRound4Nock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/round`, {
        source: 'user',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        round: 4,
        p2pMessages: {
          bitgo: {
            from: 2,
            to: 0,
            payload: {
              encryptedMessage: 'test-p2p-message-bitgo-to-user-3',
              signature: 'test-signature-bitgo-to-user-3',
            },
            commitment: 'test-commitment-bitgo-2', // not a typo
          },
          counterParty: {
            from: 1,
            to: 0,
            payload: {
              encryptedMessage: 'test-p2p-message-backup-to-user-3',
              signature: 'test-signature-backup-to-user-3',
            },
            commitment: 'test-commitment-backup-3',
          },
        },
      })
      .reply(200, {
        round: 5,
        encryptedDataKey: 'key',
        encryptedData: 'data',
        broadcastMessage: {
          from: 0,
          payload: {
            message: 'test-broadcast-message-user-4',
            signature: 'test-signature-user-4',
          },
        },
      });

    const backupRound4Nock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/round`, {
        source: 'backup',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        round: 4,
        p2pMessages: {
          bitgo: {
            from: 2,
            to: 1,
            payload: {
              encryptedMessage: 'test-p2p-message-bitgo-to-backup-3',
              signature: 'test-signature-bitgo-to-backup-3',
            },
            commitment: 'test-commitment-bitgo-2', // not a typo
          },
          counterParty: {
            from: 0,
            to: 1,
            payload: {
              encryptedMessage: 'test-p2p-message-user-to-backup-3',
              signature: 'test-signature-user-to-backup-3',
            },
            commitment: 'test-commitment-user-3',
          },
        },
      })
      .reply(200, {
        round: 5,
        encryptedDataKey: 'key',
        encryptedData: 'data',
        broadcastMessage: {
          from: 1,
          payload: {
            message: 'test-broadcast-message-backup-4',
            signature: 'test-signature-backup-4',
          },
        },
      });

    const bitgoRound4Nock = nock(bitgoApiUrl)
      .post(`/api/v2/mpc/generatekey`, {
        enterprise: 'test-enterprise',
        type: 'MPCv2',
        round: 'MPCv2-R3',
        payload: {
          sessionId: 'test-session-id',
          userMsg3: {
            from: 0,
            to: 2,
            encryptedMessage: 'test-p2p-message-user-to-bitgo-3',
            signature: 'test-signature-user-to-bitgo-3',
          },
          backupMsg3: {
            from: 1,
            to: 2,
            encryptedMessage: 'test-p2p-message-backup-to-bitgo-3',
            signature: 'test-signature-backup-to-bitgo-3',
          },
          userMsg4: {
            from: 0,
            message: 'test-broadcast-message-user-4',
            signature: 'test-signature-user-4',
          },
          backupMsg4: {
            from: 1,
            message: 'test-broadcast-message-backup-4',
            signature: 'test-signature-backup-4',
          },
        },
      })
      .reply(200, {
        sessionId: 'test-session-id',
        commonKeychain: 'commonKeychain',
        bitgoMsg4: {
          from: 2,
          message: 'test-broadcast-message-bitgo-4',
          signature: 'test-signature-bitgo-4',
        },
      });

    const userFinalizeNock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/finalize`, {
        source: 'user',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        broadcastMessages: {
          bitgo: {
            from: 2,
            payload: {
              message: 'test-broadcast-message-bitgo-4',
              signature: 'test-signature-bitgo-4',
            },
          },
          counterParty: {
            from: 1,
            payload: {
              message: 'test-broadcast-message-backup-4',
              signature: 'test-signature-backup-4',
            },
          },
        },
        bitgoCommonKeychain: 'commonKeychain',
      })
      .reply(200, {
        source: 'user',
        commonKeychain: 'commonKeychain',
      });

    const backupFinalizeNock = nock(advancedWalletManagerUrl)
      .post(`/api/${ecdsaCoin}/mpcv2/finalize`, {
        source: 'backup',
        encryptedDataKey: 'key',
        encryptedData: 'data',
        broadcastMessages: {
          bitgo: {
            from: 2,
            payload: {
              message: 'test-broadcast-message-bitgo-4',
              signature: 'test-signature-bitgo-4',
            },
          },
          counterParty: {
            from: 0,
            payload: {
              message: 'test-broadcast-message-user-4',
              signature: 'test-signature-user-4',
            },
          },
        },
        bitgoCommonKeychain: 'commonKeychain',
      })
      .reply(200, {
        source: 'backup',
        commonKeychain: 'commonKeychain',
      });

    const bitgoAddUserKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${ecdsaCoin}/key`, {
        commonKeychain: 'commonKeychain',
        source: 'user',
        type: 'tss',
        isMPCv2: true,
      })
      .reply(200, { id: 'user-key-id' });

    const bitgoAddBackupKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${ecdsaCoin}/key`, {
        commonKeychain: 'commonKeychain',
        source: 'backup',
        type: 'tss',
        isMPCv2: true,
      })
      .reply(200, { id: 'backup-key-id' });

    const bitgoAddBitGoKeyNock = nock(bitgoApiUrl)
      .post(`/api/v2/${ecdsaCoin}/key`, {
        commonKeychain: 'commonKeychain',
        source: 'bitgo',
        type: 'tss',
        isMPCv2: true,
      })
      .reply(200, { id: 'bitgo-key-id' });

    const bitgoAddWalletNock = nock(bitgoApiUrl)
      .post(`/api/v2/${ecdsaCoin}/wallet/add`, {
        label: 'test-wallet', // ?
        m: 2,
        n: 3,
        keys: ['user-key-id', 'backup-key-id', 'bitgo-key-id'],
        type: 'cold',
        subType: 'onPrem',
        multisigType: 'tss',
        enterprise: 'test-enterprise',
      })
      .reply(200, {
        id: 'new-wallet-id',
        multisigType: 'tss',
        type: 'cold',
        subType: 'onPrem',
      });

    const response = await agent
      .post(`/api/${ecdsaCoin}/wallet/generate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'test-wallet',
        enterprise: 'test-enterprise',
        multisigType: 'tss',
      });

    response.status.should.equal(200);
    response.body.should.have.property('wallet');
    response.body.wallet.should.have.properties({
      id: 'new-wallet-id',
      multisigType: 'tss',
      type: 'cold',
      subType: 'onPrem',
    });

    // No need to check constantsNock since we're using sinon stub
    userInitNock.done();
    backupInitNock.done();
    userRound1Nock.done();
    backupRound1Nock.done();
    bitgoRound1And2Nock.done();
    userRound2Nock.done();
    backupRound2Nock.done();
    userRound3Nock.done();
    backupRound3Nock.done();
    bitgoRound3Nock.done();
    userRound4Nock.done();
    backupRound4Nock.done();
    bitgoRound4Nock.done();
    userFinalizeNock.done();
    backupFinalizeNock.done();
    bitgoAddUserKeyNock.done();
    bitgoAddBackupKeyNock.done();
    bitgoAddBitGoKeyNock.done();
    bitgoAddWalletNock.done();
  });

  it('should fail when advanced wallet manager client is not configured', async () => {
    // Create a config without advanced wallet manager settings
    const invalidConfig: Partial<MasterExpressConfig> = {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    try {
      expressApp(invalidConfig as MasterExpressConfig);
      assert(
        false,
        'Expected error to be thrown when advanced wallet manager client is not configured',
      );
    } catch (e) {
      (e as Error).message.should.equal(
        'advancedWalletManagerUrl and advancedWalletManagerCert are required',
      );
    }
  });

  it('should fail when multisig type is invalid / not provided', async () => {
    const response = await agent
      .post(`/api/${coin}/wallet/generate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'test_wallet',
        enterprise: 'test_enterprise',
        multisigType: 'invalid',
      });

    response.status.should.equal(400);

    const response2 = await agent
      .post(`/api/${coin}/wallet/generate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'test_wallet',
        enterprise: 'test_enterprise',
      });

    response2.status.should.equal(400);
  });

  it('should fail when coin does not support TSS', async () => {
    const response = await agent
      .post(`/api/tbtc/wallet/generate`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        label: 'test_wallet',
        enterprise: 'test_enterprise',
        multisigType: 'tss',
      });

    response.status.should.equal(400);
    response.body.details.should.equal('MPC wallet generation is not supported for coin tbtc');
  });
});
