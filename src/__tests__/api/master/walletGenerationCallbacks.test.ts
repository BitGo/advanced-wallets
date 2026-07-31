import 'should';
import assert from 'assert';
import nock from 'nock';
import {
  createAwmBackupClient,
  createAwmClient,
  AdvancedWalletManagerClient,
} from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';
import {
  createEcdsaMPCv2KeyGenCallbacks,
  createEddsaKeyGenCallbacks,
  createOnchainKeyGenCallback,
} from '../../../masterBitgoExpress/handlers/walletGenerationCallbacks';
import { AppMode, KeySource, MasterExpressConfig, TlsMode } from '../../../shared/types';
import { DEFAULT_ASYNC_MODE_CONFIG } from './testUtils';

describe('walletGenerationCallbacks', () => {
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const backupAwmUrl = 'http://backup-awm.invalid';
  const coin = 'tbtc';

  // Valid BIP32 extended public keys required by the SDK's isValidPub check
  const validUserPub =
    'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
  const validBackupPub =
    'xpub661MyMwAqRbcGczjuMoRm6dXaLDEhW1u34gKenbeYqAix21mdUKJyuyu5F1rzYGVxyL6tmgBUAEPrEz92mBXjByMRiJdba9wpnN37RLLAXa';

  let awmUserClient: AdvancedWalletManagerClient;
  let awmBackupClient: AdvancedWalletManagerClient;

  function makeConfig(overrides: Partial<MasterExpressConfig> = {}): MasterExpressConfig {
    return {
      appMode: AppMode.MASTER_EXPRESS,
      port: 0,
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      authVersion: 2,
      advancedWalletManagerUrl,
      awmServerCaCert: 'dummy-cert',
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
      asyncModeConfig: DEFAULT_ASYNC_MODE_CONFIG,
      ...overrides,
    };
  }

  before(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  after(() => {
    nock.enableNetConnect();
  });

  describe('createOnchainKeyGenCallback', () => {
    describe('with separate backup AWM (separate-HSM mode)', () => {
      beforeEach(() => {
        const config = makeConfig({ advancedWalletManagerBackupUrl: backupAwmUrl });
        awmUserClient = createAwmClient(config, coin)!;
        awmBackupClient = createAwmBackupClient(config, coin)!;
        assert(awmUserClient);
        assert(awmBackupClient);
      });

      it('should route user source to the primary AWM client', async () => {
        const userKeychainNock = nock(advancedWalletManagerUrl)
          .post(`/api/${coin}/key/independent`, {
            source: KeySource.USER,
          })
          .reply(200, {
            pub: validUserPub,
            source: KeySource.USER,
            type: 'independent',
          });

        const callback = createOnchainKeyGenCallback(awmUserClient, awmBackupClient);
        const result = await callback({ source: KeySource.USER, coin });

        result.pub.should.equal(validUserPub);
        result.source.should.equal(KeySource.USER);
        result.type.should.equal('independent');
        userKeychainNock.done();
      });

      it('should route backup source to the backup AWM client', async () => {
        const backupKeychainNock = nock(backupAwmUrl)
          .post(`/api/${coin}/key/independent`, {
            source: KeySource.BACKUP,
          })
          .reply(200, {
            pub: validBackupPub,
            source: KeySource.BACKUP,
            type: 'independent',
          });

        const callback = createOnchainKeyGenCallback(awmUserClient, awmBackupClient);
        const result = await callback({ source: KeySource.BACKUP, coin });

        result.pub.should.equal(validBackupPub);
        result.source.should.equal(KeySource.BACKUP);
        result.type.should.equal('independent');
        backupKeychainNock.done();
      });
    });

    describe('without separate backup AWM (same-HSM mode)', () => {
      beforeEach(() => {
        const config = makeConfig();
        awmUserClient = createAwmClient(config, coin)!;
        awmBackupClient = createAwmBackupClient(config, coin) ?? awmUserClient;
        assert(awmUserClient);
      });

      it('should route backup source to the primary AWM client', async () => {
        const backupKeychainNock = nock(advancedWalletManagerUrl)
          .post(`/api/${coin}/key/independent`, {
            source: KeySource.BACKUP,
          })
          .reply(200, {
            pub: validBackupPub,
            source: KeySource.BACKUP,
            type: 'independent',
          });

        const callback = createOnchainKeyGenCallback(awmUserClient, awmBackupClient);
        const result = await callback({ source: KeySource.BACKUP, coin });

        result.pub.should.equal(validBackupPub);
        result.source.should.equal(KeySource.BACKUP);
        result.type.should.equal('independent');
        backupKeychainNock.done();
      });
    });

    it('should throw for unexpected key sources', async () => {
      const config = makeConfig({ advancedWalletManagerBackupUrl: backupAwmUrl });
      awmUserClient = createAwmClient(config, coin)!;
      awmBackupClient = createAwmBackupClient(config, coin)!;
      assert(awmUserClient);
      assert(awmBackupClient);

      const callback = createOnchainKeyGenCallback(awmUserClient, awmBackupClient);

      await callback({
        source: KeySource.BITGO as 'user',
        coin,
      }).should.be.rejectedWith('Unexpected key source for onchain key generation: bitgo');
    });
  });

  describe('createEcdsaMPCv2KeyGenCallbacks', () => {
    const ecdsaCoin = 'hteth';
    const bitgoGpgPub = 'bitgo-mpcv2-gpg-pub';
    const state = { encryptedData: 'data', encryptedDataKey: 'key' };
    const sessionId = 'session-id';

    // AWM message payloads, keyed by the party that produced them
    const broadcast = (label: string) => ({
      from: 0,
      payload: { message: `broadcast-${label}`, signature: `sig-${label}` },
    });
    const p2p = (label: string) => ({
      from: 0,
      to: 2,
      payload: { encryptedMessage: `p2p-${label}`, signature: `sig-${label}` },
      commitment: `commitment-${label}`,
    });

    // BitGo messages, as the SDK hands them to the callbacks, and the AWM's expected shape for them
    const bitgoMsg1 = { from: 2 as const, message: 'bitgo-1', signature: 'bitgo-sig-1' };
    const bitgoMsg4 = { from: 2 as const, message: 'bitgo-4', signature: 'bitgo-sig-4' };
    const bitgoP2p = (to: 0 | 1, round: number) => ({
      from: 2 as const,
      to,
      encryptedMessage: `bitgo-to-${to}-${round}`,
      signature: `bitgo-sig-to-${to}-${round}`,
    });
    const formattedBroadcast = (msg: { from: number; message: string; signature: string }) => ({
      from: msg.from,
      payload: { message: msg.message, signature: msg.signature },
    });
    const formattedP2p = (
      msg: { from: number; to: number; encryptedMessage: string; signature: string },
      commitment?: string,
    ) => ({
      from: msg.from,
      to: msg.to,
      payload: { encryptedMessage: msg.encryptedMessage, signature: msg.signature },
      ...(commitment ? { commitment } : {}),
    });

    function nockRound(
      url: string,
      source: KeySource,
      round: number,
      messages: nock.DataMatcherMap,
    ) {
      return nock(url).post(`/api/${ecdsaCoin}/mpcv2/round`, {
        source,
        ...state,
        round,
        ...messages,
      });
    }

    let callbacks: ReturnType<typeof createEcdsaMPCv2KeyGenCallbacks>;

    beforeEach(() => {
      const config = makeConfig({ advancedWalletManagerBackupUrl: backupAwmUrl });
      callbacks = createEcdsaMPCv2KeyGenCallbacks(
        createAwmClient(config, ecdsaCoin)!,
        createAwmBackupClient(config, ecdsaCoin)!,
      );
    });

    /** Runs initialize plus round 1 on both AWMs; the returned nock scopes must be satisfied. */
    async function initialize() {
      const userInitNock = nock(advancedWalletManagerUrl)
        .post(`/api/${ecdsaCoin}/mpcv2/initialize`, { source: KeySource.USER })
        .reply(200, { ...state, gpgPub: 'user-gpg-pub' });
      const backupInitNock = nock(backupAwmUrl)
        .post(`/api/${ecdsaCoin}/mpcv2/initialize`, { source: KeySource.BACKUP })
        .reply(200, { ...state, gpgPub: 'backup-gpg-pub' });
      const userRound1Nock = nockRound(advancedWalletManagerUrl, KeySource.USER, 1, {
        bitgoGpgPub,
        counterPartyGpgPub: 'backup-gpg-pub',
      }).reply(200, { ...state, round: 2, broadcastMessage: broadcast('user-1') });
      const backupRound1Nock = nockRound(backupAwmUrl, KeySource.BACKUP, 1, {
        bitgoGpgPub,
        counterPartyGpgPub: 'user-gpg-pub',
      }).reply(200, { ...state, round: 2, broadcastMessage: broadcast('backup-1') });

      const result = await callbacks.initializeCallback({
        enterprise: 'test-enterprise',
        bitgoPublicGpgKey: bitgoGpgPub,
      });

      [userInitNock, backupInitNock, userRound1Nock, backupRound1Nock].forEach((n) => n.done());
      return result;
    }

    /** Runs AWM rounds 2 and 3 on both AWMs. */
    async function round2() {
      const userRound2Nock = nockRound(advancedWalletManagerUrl, KeySource.USER, 2, {
        broadcastMessages: {
          bitgo: formattedBroadcast(bitgoMsg1),
          counterParty: broadcast('backup-1'),
        },
      }).reply(200, {
        ...state,
        round: 3,
        p2pMessages: { bitgo: p2p('user-2-bitgo'), counterParty: p2p('user-2-backup') },
      });
      const backupRound2Nock = nockRound(backupAwmUrl, KeySource.BACKUP, 2, {
        broadcastMessages: {
          bitgo: formattedBroadcast(bitgoMsg1),
          counterParty: broadcast('user-1'),
        },
      }).reply(200, {
        ...state,
        round: 3,
        p2pMessages: { bitgo: p2p('backup-2-bitgo'), counterParty: p2p('backup-2-user') },
      });
      const userRound3Nock = nockRound(advancedWalletManagerUrl, KeySource.USER, 3, {
        p2pMessages: {
          bitgo: formattedP2p(bitgoP2p(0, 2)),
          counterParty: p2p('backup-2-user'),
        },
      }).reply(200, {
        ...state,
        round: 4,
        p2pMessages: { bitgo: p2p('user-3-bitgo'), counterParty: p2p('user-3-backup') },
      });
      const backupRound3Nock = nockRound(backupAwmUrl, KeySource.BACKUP, 3, {
        p2pMessages: {
          bitgo: formattedP2p(bitgoP2p(1, 2)),
          counterParty: p2p('user-2-backup'),
        },
      }).reply(200, {
        ...state,
        round: 4,
        p2pMessages: { bitgo: p2p('backup-3-bitgo'), counterParty: p2p('backup-3-user') },
      });

      const result = await callbacks.round2Callback({
        sessionId,
        bitgoMsg1,
        bitgoToUserMsg2: bitgoP2p(0, 2),
        bitgoToBackupMsg2: bitgoP2p(1, 2),
        userState: state,
        backupState: state,
      });

      [userRound2Nock, backupRound2Nock, userRound3Nock, backupRound3Nock].forEach((n) => n.done());
      return result;
    }

    /** Runs AWM round 4 on both AWMs. */
    async function round3() {
      const userRound4Nock = nockRound(advancedWalletManagerUrl, KeySource.USER, 4, {
        p2pMessages: {
          bitgo: formattedP2p(bitgoP2p(0, 3), 'bitgo-commitment-2'),
          counterParty: p2p('backup-3-user'),
        },
      }).reply(200, { ...state, round: 5, broadcastMessage: broadcast('user-4') });
      const backupRound4Nock = nockRound(backupAwmUrl, KeySource.BACKUP, 4, {
        p2pMessages: {
          bitgo: formattedP2p(bitgoP2p(1, 3), 'bitgo-commitment-2'),
          counterParty: p2p('user-3-backup'),
        },
      }).reply(200, { ...state, round: 5, broadcastMessage: broadcast('backup-4') });

      const result = await callbacks.round3Callback({
        sessionId,
        bitgoCommitment2: 'bitgo-commitment-2',
        bitgoToUserMsg3: bitgoP2p(0, 3),
        bitgoToBackupMsg3: bitgoP2p(1, 3),
        userState: state,
        backupState: state,
      });

      [userRound4Nock, backupRound4Nock].forEach((n) => n.done());
      return result;
    }

    function nockFinalize(
      url: string,
      source: KeySource,
      counterPartyBroadcast: nock.DataMatcherMap,
    ) {
      return nock(url).post(`/api/${ecdsaCoin}/mpcv2/finalize`, {
        source,
        ...state,
        broadcastMessages: {
          bitgo: formattedBroadcast(bitgoMsg4),
          counterParty: counterPartyBroadcast,
        },
        bitgoCommonKeychain: 'commonKeychain',
      });
    }

    it('should relay round 1 messages and GPG keys from both AWMs to the SDK', async () => {
      const result = await initialize();

      result.userGpgPublicKey.should.equal('user-gpg-pub');
      result.backupGpgPublicKey.should.equal('backup-gpg-pub');
      result.round1Messages.should.eql({
        broadcastMessages: [broadcast('user-1'), broadcast('backup-1')],
        p2pMessages: [],
      });
      result.userState.should.eql(state);
      result.backupState.should.eql(state);
    });

    it('should return the round 2 BitGo p2p messages after running AWM rounds 2 and 3', async () => {
      await initialize();
      const result = await round2();

      result.round2Messages.should.eql({
        broadcastMessages: [],
        p2pMessages: [p2p('user-2-bitgo'), p2p('backup-2-bitgo')],
      });
    });

    it('should return the round 3 p2p and round 4 broadcast messages', async () => {
      await initialize();
      await round2();
      const result = await round3();

      result.round3Messages.should.eql({
        broadcastMessages: [broadcast('user-4'), broadcast('backup-4')],
        p2pMessages: [p2p('user-3-bitgo'), p2p('backup-3-bitgo')],
      });
    });

    it('should finalize both AWMs and return the agreed common keychain', async () => {
      await initialize();
      await round2();
      await round3();

      const userFinalizeNock = nockFinalize(
        advancedWalletManagerUrl,
        KeySource.USER,
        broadcast('backup-4'),
      ).reply(200, { source: KeySource.USER, commonKeychain: 'commonKeychain' });
      const backupFinalizeNock = nockFinalize(
        backupAwmUrl,
        KeySource.BACKUP,
        broadcast('user-4'),
      ).reply(200, { source: KeySource.BACKUP, commonKeychain: 'commonKeychain' });

      const result = await callbacks.finalizeCallback({
        sessionId,
        bitgoMsg4,
        bitgoCommonKeychain: 'commonKeychain',
        userState: state,
        backupState: state,
      });

      result.commonKeychain.should.equal('commonKeychain');
      userFinalizeNock.done();
      backupFinalizeNock.done();
    });

    it('should reject when the user and backup common keychains do not match', async () => {
      await initialize();
      await round2();
      await round3();

      nockFinalize(advancedWalletManagerUrl, KeySource.USER, broadcast('backup-4')).reply(200, {
        source: KeySource.USER,
        commonKeychain: 'commonKeychain',
      });
      nockFinalize(backupAwmUrl, KeySource.BACKUP, broadcast('user-4')).reply(200, {
        source: KeySource.BACKUP,
        commonKeychain: 'otherCommonKeychain',
      });

      await callbacks
        .finalizeCallback({
          sessionId,
          bitgoMsg4,
          bitgoCommonKeychain: 'commonKeychain',
          userState: state,
          backupState: state,
        })
        .should.be.rejectedWith(/User and backup common keychains do not match/);
    });

    it('should reject when an AWM round 1 response has no broadcast message', async () => {
      nock(advancedWalletManagerUrl)
        .post(`/api/${ecdsaCoin}/mpcv2/initialize`, { source: KeySource.USER })
        .reply(200, { ...state, gpgPub: 'user-gpg-pub' });
      nock(backupAwmUrl)
        .post(`/api/${ecdsaCoin}/mpcv2/initialize`, { source: KeySource.BACKUP })
        .reply(200, { ...state, gpgPub: 'backup-gpg-pub' });
      nockRound(advancedWalletManagerUrl, KeySource.USER, 1, {
        bitgoGpgPub,
        counterPartyGpgPub: 'backup-gpg-pub',
      }).reply(200, { ...state, round: 2 });
      nockRound(backupAwmUrl, KeySource.BACKUP, 1, {
        bitgoGpgPub,
        counterPartyGpgPub: 'user-gpg-pub',
      }).reply(200, { ...state, round: 2, broadcastMessage: broadcast('backup-1') });

      await callbacks
        .initializeCallback({ enterprise: 'test-enterprise', bitgoPublicGpgKey: bitgoGpgPub })
        .should.be.rejectedWith('Missing broadcast message in user round 1 response');
    });

    it('should reject when initializeCallback is called more than once', async () => {
      await initialize();

      await callbacks
        .initializeCallback({ enterprise: 'test-enterprise', bitgoPublicGpgKey: bitgoGpgPub })
        .should.be.rejectedWith('initializeCallback called more than once');
    });

    it('should reject when bitgoMsg1 is not from BitGo', async () => {
      await initialize();

      await callbacks
        .round2Callback({
          sessionId,
          bitgoMsg1: { ...bitgoMsg1, from: 0 as const },
          bitgoToUserMsg2: bitgoP2p(0, 2),
          bitgoToBackupMsg2: bitgoP2p(1, 2),
          userState: state,
          backupState: state,
        })
        .should.be.rejectedWith('bitgoMsg1 is not from BitGo');
    });

    it('should reject when bitgoToUserMsg2 is not from BitGo', async () => {
      await initialize();

      nockRound(advancedWalletManagerUrl, KeySource.USER, 2, {
        broadcastMessages: {
          bitgo: formattedBroadcast(bitgoMsg1),
          counterParty: broadcast('backup-1'),
        },
      }).reply(200, {
        ...state,
        round: 3,
        p2pMessages: { bitgo: p2p('user-2-bitgo'), counterParty: p2p('user-2-backup') },
      });
      nockRound(backupAwmUrl, KeySource.BACKUP, 2, {
        broadcastMessages: {
          bitgo: formattedBroadcast(bitgoMsg1),
          counterParty: broadcast('user-1'),
        },
      }).reply(200, {
        ...state,
        round: 3,
        p2pMessages: { bitgo: p2p('backup-2-bitgo'), counterParty: p2p('backup-2-user') },
      });

      await callbacks
        .round2Callback({
          sessionId,
          bitgoMsg1,
          bitgoToUserMsg2: { ...bitgoP2p(0, 2), from: 0 as const },
          bitgoToBackupMsg2: bitgoP2p(1, 2),
          userState: state,
          backupState: state,
        })
        .should.be.rejectedWith('bitgoToUserMsg2 is not from BitGo');
    });

    it('should reject when bitgoToUserMsg3 is not addressed to the user', async () => {
      await initialize();
      await round2();

      await callbacks
        .round3Callback({
          sessionId,
          bitgoCommitment2: 'bitgo-commitment-2',
          bitgoToUserMsg3: { ...bitgoP2p(0, 3), to: 1 as const },
          bitgoToBackupMsg3: bitgoP2p(1, 3),
          userState: state,
          backupState: state,
        })
        .should.be.rejectedWith('bitgoToUserMsg3 is not addressed to user');
    });

    it('should reject when bitgoMsg4 is not from BitGo', async () => {
      await initialize();
      await round2();
      await round3();

      await callbacks
        .finalizeCallback({
          sessionId,
          bitgoMsg4: { ...bitgoMsg4, from: 0 as const },
          bitgoCommonKeychain: 'commonKeychain',
          userState: state,
          backupState: state,
        })
        .should.be.rejectedWith('bitgoMsg4 is not from BitGo');
    });
  });

  describe('createEddsaKeyGenCallbacks', () => {
    const eddsaCoin = 'tsol';
    const bitgoGpgPub = 'bitgo-mpcv1-gpg-pub';
    const state = { encryptedData: 'data', encryptedDataKey: 'key' };

    const keyShare = (from: KeySource, to: KeySource) => ({
      from,
      to,
      publicShare: `public-${from}`,
      privateShare: `private-${from}-to-${to}`,
      privateShareProof: 'proof',
      vssProof: 'proof',
      gpgKey: `${from}-gpg-key`,
    });

    const bitgoKeychain = {
      id: 'bitgo-key-id',
      source: KeySource.BITGO,
      type: 'tss' as const,
      commonKeychain: 'commonKeychain',
      keyShares: [keyShare(KeySource.BITGO, KeySource.USER)],
    };

    let callbacks: ReturnType<typeof createEddsaKeyGenCallbacks>;

    beforeEach(() => {
      const config = makeConfig({ advancedWalletManagerBackupUrl: backupAwmUrl });
      callbacks = createEddsaKeyGenCallbacks(
        createAwmClient(config, eddsaCoin)!,
        createAwmBackupClient(config, eddsaCoin)!,
      );
    });

    it('should initialize both AWMs, passing the user GPG key to the backup AWM', async () => {
      const userInitNock = nock(advancedWalletManagerUrl)
        .post(`/api/${eddsaCoin}/mpc/key/initialize`, {
          source: KeySource.USER,
          bitgoGpgPub,
        })
        .reply(200, { ...state, bitgoPayload: keyShare(KeySource.USER, KeySource.BITGO) });
      const backupInitNock = nock(backupAwmUrl)
        .post(`/api/${eddsaCoin}/mpc/key/initialize`, {
          source: KeySource.BACKUP,
          bitgoGpgPub,
          counterPartyGpgPub: 'user-gpg-key',
        })
        .reply(200, {
          ...state,
          bitgoPayload: keyShare(KeySource.BACKUP, KeySource.BITGO),
          counterPartyKeyShare: keyShare(KeySource.BACKUP, KeySource.USER),
        });

      const result = await callbacks.initializeCallback({
        enterprise: 'test-enterprise',
        bitgoPublicGpgKey: bitgoGpgPub,
      });

      result.userGpgPublicKey.should.equal('user-gpg-key');
      result.backupGpgPublicKey.should.equal('backup-gpg-key');
      result.userToBitgoKeyShare.should.eql(keyShare(KeySource.USER, KeySource.BITGO));
      result.backupToBitgoKeyShare.should.eql(keyShare(KeySource.BACKUP, KeySource.BITGO));
      result.backupToUserCounterPartyKeyShare.should.eql(
        keyShare(KeySource.BACKUP, KeySource.USER),
      );
      result.userState.should.eql(state);
      result.backupState.should.eql(state);
      userInitNock.done();
      backupInitNock.done();
    });

    it('should reject when the backup AWM does not return a key share for the user', async () => {
      nock(advancedWalletManagerUrl)
        .post(`/api/${eddsaCoin}/mpc/key/initialize`)
        .reply(200, { ...state, bitgoPayload: keyShare(KeySource.USER, KeySource.BITGO) });
      nock(backupAwmUrl)
        .post(`/api/${eddsaCoin}/mpc/key/initialize`)
        .reply(200, { ...state, bitgoPayload: keyShare(KeySource.BACKUP, KeySource.BITGO) });

      await callbacks
        .initializeCallback({ enterprise: 'test-enterprise', bitgoPublicGpgKey: bitgoGpgPub })
        .should.be.rejectedWith(
          'Backup key share for the user is missing from the initialization response',
        );
    });

    it('should route the user finalize to the primary AWM and restore the key share routing', async () => {
      const finalizeNock = nock(advancedWalletManagerUrl)
        .post(`/api/${eddsaCoin}/mpc/key/finalize`, {
          source: KeySource.USER,
          coin: eddsaCoin,
          ...state,
          bitgoKeyChain: {
            ...bitgoKeychain,
            verifiedVssProof: true,
            isBitGo: true,
            isTrust: false,
          },
          counterPartyGpgPub: 'backup-gpg-key',
          counterPartyKeyShare: keyShare(KeySource.BACKUP, KeySource.USER),
        })
        .reply(200, {
          source: KeySource.USER,
          commonKeychain: 'commonKeychain',
          counterpartyKeyShare: keyShare(KeySource.USER, KeySource.BACKUP),
        });

      const result = await callbacks.finalizeCallback({
        source: KeySource.USER,
        coin: eddsaCoin,
        bitgoKeychain,
        counterPartyGPGKey: 'backup-gpg-key',
        counterPartyKeyShare: keyShare(KeySource.BACKUP, KeySource.USER),
        state,
      });

      result.commonKeychain.should.equal('commonKeychain');
      assert(result.counterpartyKeyShare, 'counterpartyKeyShare should be defined');
      result.counterpartyKeyShare.should.eql(keyShare(KeySource.USER, KeySource.BACKUP));
      finalizeNock.done();
    });

    it('should reject when the user finalize does not return a key share for backup', async () => {
      nock(advancedWalletManagerUrl)
        .post(`/api/${eddsaCoin}/mpc/key/finalize`)
        .reply(200, { source: KeySource.USER, commonKeychain: 'commonKeychain' });

      await callbacks
        .finalizeCallback({
          source: KeySource.USER,
          coin: eddsaCoin,
          bitgoKeychain,
          counterPartyGPGKey: 'backup-gpg-key',
          counterPartyKeyShare: keyShare(KeySource.BACKUP, KeySource.USER),
          state,
        })
        .should.be.rejectedWith('Key share for backup missing from user finalize response');
    });

    it('should route the backup finalize to the backup AWM', async () => {
      const finalizeNock = nock(backupAwmUrl)
        .post(`/api/${eddsaCoin}/mpc/key/finalize`, {
          source: KeySource.BACKUP,
          coin: eddsaCoin,
          ...state,
          bitgoKeyChain: {
            ...bitgoKeychain,
            verifiedVssProof: true,
            isBitGo: true,
            isTrust: false,
          },
          counterPartyGpgPub: 'user-gpg-key',
          counterPartyKeyShare: keyShare(KeySource.USER, KeySource.BACKUP),
        })
        .reply(200, { source: KeySource.BACKUP, commonKeychain: 'commonKeychain' });

      const result = await callbacks.finalizeCallback({
        source: KeySource.BACKUP,
        coin: eddsaCoin,
        bitgoKeychain,
        counterPartyGPGKey: 'user-gpg-key',
        counterPartyKeyShare: keyShare(KeySource.USER, KeySource.BACKUP),
        state,
      });

      result.commonKeychain.should.equal('commonKeychain');
      finalizeNock.done();
    });
  });
});
