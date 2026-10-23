import 'should';
import assert from 'assert';
import * as sinon from 'sinon';
import { AdvancedWalletManagerClient } from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';
import { createEddsaMPCv2KeyGenCallbacks } from '../../../masterBitgoExpress/handlers/walletGenerationCallbacks';

describe('createEddsaMPCv2KeyGenCallbacks', () => {
  const bitgoGpgPub = 'bitgo-gpg-pub';
  const signedMessage = {
    message: 'bWVzc2FnZQ==',
    signature: '-----BEGIN PGP SIGNATURE-----\n\ntest\n-----END PGP SIGNATURE-----\n',
  };

  let awmUserClient: AdvancedWalletManagerClient;
  let awmBackupClient: AdvancedWalletManagerClient;
  let userInitStub: sinon.SinonStub;
  let backupInitStub: sinon.SinonStub;
  let userRoundStub: sinon.SinonStub;
  let backupRoundStub: sinon.SinonStub;
  let userFinalizeStub: sinon.SinonStub;
  let backupFinalizeStub: sinon.SinonStub;

  const initResponse = {
    gpgPub: 'test-gpg-pub',
    encryptedData: 'init-encrypted-data',
    encryptedDataKey: 'init-encrypted-data-key',
  };
  const backupInitResponse = {
    gpgPub: 'backup-gpg-pub',
    encryptedData: 'backup-init-data',
    encryptedDataKey: 'backup-init-key',
  };
  const round1Response = {
    encryptedData: 'round1-encrypted-data',
    encryptedDataKey: 'round1-encrypted-data-key',
    round: 2,
    signedMsg: signedMessage,
  };
  const backupRound1Response = {
    encryptedData: 'backup-round1-data',
    encryptedDataKey: 'backup-round1-key',
    round: 2,
    signedMsg: signedMessage,
  };
  const round2Response = {
    encryptedData: 'round2-encrypted-data',
    encryptedDataKey: 'round2-encrypted-data-key',
    round: 3,
    signedMsg: signedMessage,
  };
  const backupRound2Response = {
    encryptedData: 'backup-round2-data',
    encryptedDataKey: 'backup-round2-key',
    round: 3,
    signedMsg: signedMessage,
  };
  const finalizeResponse = { commonKeychain: 'common-keychain', source: 'user' };
  const backupFinalizeResponse = { commonKeychain: 'common-keychain', source: 'backup' };

  beforeEach(() => {
    awmUserClient = new AdvancedWalletManagerClient(
      {
        advancedWalletManagerUrl: 'http://user-awm.invalid',
        tlsMode: 0,
        clientCertAllowSelfSigned: true,
      } as never,
      'tsol',
    );
    awmBackupClient = new AdvancedWalletManagerClient(
      {
        advancedWalletManagerUrl: 'http://backup-awm.invalid',
        tlsMode: 0,
        clientCertAllowSelfSigned: true,
      } as never,
      'tsol',
    );
    userInitStub = sinon.stub(awmUserClient, 'initMpcV2KeyGen');
    backupInitStub = sinon.stub(awmBackupClient, 'initMpcV2KeyGen');
    userRoundStub = sinon.stub(awmUserClient, 'roundMpcV2KeyGen');
    backupRoundStub = sinon.stub(awmBackupClient, 'roundMpcV2KeyGen');
    userFinalizeStub = sinon.stub(awmUserClient, 'finalizeMpcV2KeyGen');
    backupFinalizeStub = sinon.stub(awmBackupClient, 'finalizeMpcV2KeyGen');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('initializeCallback calls both AWMs via initMpcV2KeyGen and returns pubs and state', async () => {
    userInitStub.resolves(initResponse);
    backupInitStub.resolves(backupInitResponse);

    const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
    const result = await callbacks.initializeCallback({
      enterprise: 'test-ent',
      bitgoPublicGpgKey: bitgoGpgPub,
    });

    result.userGpgPublicKey.should.equal('test-gpg-pub');
    result.backupGpgPublicKey.should.equal('backup-gpg-pub');
    result.userState.encryptedData.should.equal('init-encrypted-data');
    result.backupState.encryptedData.should.equal('backup-init-data');
    sinon.assert.calledWith(userInitStub, { source: 'user' });
    sinon.assert.calledWith(backupInitStub, { source: 'backup' });
  });

  it('round1Callback calls roundMpcV2KeyGen with round 1 and GPG pubs, returns signed msg1s', async () => {
    userInitStub.resolves(initResponse);
    backupInitStub.resolves(backupInitResponse);
    userRoundStub.resolves(round1Response);
    backupRoundStub.resolves(backupRound1Response);

    const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
    const initResult = await callbacks.initializeCallback({
      enterprise: 'test-ent',
      bitgoPublicGpgKey: bitgoGpgPub,
    });

    const round1Result = await callbacks.round1Callback({
      bitgoPublicGpgKey: bitgoGpgPub,
      userGpgPublicKey: initResult.userGpgPublicKey,
      backupGpgPublicKey: initResult.backupGpgPublicKey,
      userState: initResult.userState,
      backupState: initResult.backupState,
    });

    round1Result.userSignedMsg1.should.deepEqual(signedMessage);
    round1Result.backupSignedMsg1.should.deepEqual(signedMessage);

    sinon.assert.calledWith(
      userRoundStub,
      sinon.match({
        source: 'user',
        round: 1,
        bitgoGpgPub: bitgoGpgPub,
        counterPartyGpgPub: 'backup-gpg-pub',
      }),
    );
    sinon.assert.calledWith(
      backupRoundStub,
      sinon.match({
        source: 'backup',
        round: 1,
        bitgoGpgPub: bitgoGpgPub,
        counterPartyGpgPub: 'test-gpg-pub',
      }),
    );
  });

  it('round2Callback calls roundMpcV2KeyGen with round 2 and counterparty msg1', async () => {
    userInitStub.resolves(initResponse);
    backupInitStub.resolves(backupInitResponse);
    userRoundStub.onFirstCall().resolves(round1Response);
    backupRoundStub.onFirstCall().resolves(backupRound1Response);
    userRoundStub.onSecondCall().resolves(round2Response);
    backupRoundStub.onSecondCall().resolves(backupRound2Response);

    const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
    const initResult = await callbacks.initializeCallback({
      enterprise: 'test-ent',
      bitgoPublicGpgKey: bitgoGpgPub,
    });
    const round1Result = await callbacks.round1Callback({
      bitgoPublicGpgKey: bitgoGpgPub,
      userGpgPublicKey: initResult.userGpgPublicKey,
      backupGpgPublicKey: initResult.backupGpgPublicKey,
      userState: initResult.userState,
      backupState: initResult.backupState,
    });

    const round2Result = await callbacks.round2Callback({
      bitgoMsg1: signedMessage,
      userSignedMsg1: round1Result.userSignedMsg1,
      backupSignedMsg1: round1Result.backupSignedMsg1,
      userState: round1Result.userState,
      backupState: round1Result.backupState,
    });

    round2Result.userSignedMsg2.should.deepEqual(signedMessage);
    round2Result.backupSignedMsg2.should.deepEqual(signedMessage);

    sinon.assert.calledWith(
      userRoundStub,
      sinon.match({
        source: 'user',
        round: 2,
        bitgoMsg: signedMessage,
        counterPartyMsg: signedMessage,
      }),
    );
  });

  it('finalizeCallback bridges counterparty msg2 from closure and asserts commonKeychain match', async () => {
    userInitStub.resolves(initResponse);
    backupInitStub.resolves(backupInitResponse);
    userRoundStub.onFirstCall().resolves(round1Response);
    backupRoundStub.onFirstCall().resolves(backupRound1Response);
    userRoundStub.onSecondCall().resolves(round2Response);
    backupRoundStub.onSecondCall().resolves(backupRound2Response);
    userFinalizeStub.resolves(finalizeResponse);
    backupFinalizeStub.resolves(backupFinalizeResponse);

    const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
    const initResult = await callbacks.initializeCallback({
      enterprise: 'test-ent',
      bitgoPublicGpgKey: bitgoGpgPub,
    });
    const round1Result = await callbacks.round1Callback({
      bitgoPublicGpgKey: bitgoGpgPub,
      userGpgPublicKey: initResult.userGpgPublicKey,
      backupGpgPublicKey: initResult.backupGpgPublicKey,
      userState: initResult.userState,
      backupState: initResult.backupState,
    });
    const round2Result = await callbacks.round2Callback({
      bitgoMsg1: signedMessage,
      userSignedMsg1: round1Result.userSignedMsg1,
      backupSignedMsg1: round1Result.backupSignedMsg1,
      userState: round1Result.userState,
      backupState: round1Result.backupState,
    });

    const finalizeResult = await callbacks.finalizeCallback({
      bitgoMsg2: signedMessage,
      bitgoCommonKeychain: 'common-keychain',
      userState: round2Result.userState,
      backupState: round2Result.backupState,
    });

    finalizeResult.commonKeychain.should.equal('common-keychain');

    sinon.assert.calledWith(
      userFinalizeStub,
      sinon.match({
        source: 'user',
        bitgoMsg: signedMessage,
        counterPartyMsg: signedMessage,
        bitgoCommonKeychain: 'common-keychain',
      }),
    );
    sinon.assert.calledWith(
      backupFinalizeStub,
      sinon.match({
        source: 'backup',
        bitgoMsg: signedMessage,
        counterPartyMsg: signedMessage,
        bitgoCommonKeychain: 'common-keychain',
      }),
    );
  });

  it('finalizeCallback rejects when commonKeychains do not match', async () => {
    userInitStub.resolves(initResponse);
    backupInitStub.resolves(backupInitResponse);
    userRoundStub.onFirstCall().resolves(round1Response);
    backupRoundStub.onFirstCall().resolves(backupRound1Response);
    userRoundStub.onSecondCall().resolves(round2Response);
    backupRoundStub.onSecondCall().resolves(backupRound2Response);
    userFinalizeStub.resolves({ ...finalizeResponse, commonKeychain: 'different-keychain' });
    backupFinalizeStub.resolves(backupFinalizeResponse);

    const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
    const initResult = await callbacks.initializeCallback({
      enterprise: 'test-ent',
      bitgoPublicGpgKey: bitgoGpgPub,
    });
    const round1Result = await callbacks.round1Callback({
      bitgoPublicGpgKey: bitgoGpgPub,
      userGpgPublicKey: initResult.userGpgPublicKey,
      backupGpgPublicKey: initResult.backupGpgPublicKey,
      userState: initResult.userState,
      backupState: initResult.backupState,
    });
    const round2Result = await callbacks.round2Callback({
      bitgoMsg1: signedMessage,
      userSignedMsg1: round1Result.userSignedMsg1,
      backupSignedMsg1: round1Result.backupSignedMsg1,
      userState: round1Result.userState,
      backupState: round1Result.backupState,
    });

    await assert.rejects(
      () =>
        callbacks.finalizeCallback({
          bitgoMsg2: signedMessage,
          bitgoCommonKeychain: 'common-keychain',
          userState: round2Result.userState,
          backupState: round2Result.backupState,
        }),
      /common keychains do not match/,
    );
  });

  it('initializeCallback rejects when called more than once', async () => {
    userInitStub.resolves(initResponse);
    backupInitStub.resolves(backupInitResponse);

    const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
    await callbacks.initializeCallback({ enterprise: 'test-ent', bitgoPublicGpgKey: bitgoGpgPub });

    await assert.rejects(
      () =>
        callbacks.initializeCallback({ enterprise: 'test-ent', bitgoPublicGpgKey: bitgoGpgPub }),
      /initializeCallback called more than once/,
    );
  });

  it('finalizeCallback rejects when called before round2Callback', async () => {
    userInitStub.resolves(initResponse);
    backupInitStub.resolves(backupInitResponse);
    userRoundStub.onFirstCall().resolves(round1Response);
    backupRoundStub.onFirstCall().resolves(backupRound1Response);

    const callbacks = createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient);
    const initResult = await callbacks.initializeCallback({
      enterprise: 'test-ent',
      bitgoPublicGpgKey: bitgoGpgPub,
    });
    const round1Result = await callbacks.round1Callback({
      bitgoPublicGpgKey: bitgoGpgPub,
      userGpgPublicKey: initResult.userGpgPublicKey,
      backupGpgPublicKey: initResult.backupGpgPublicKey,
      userState: initResult.userState,
      backupState: initResult.backupState,
    });

    await assert.rejects(
      () =>
        callbacks.finalizeCallback({
          bitgoMsg2: signedMessage,
          bitgoCommonKeychain: 'common-keychain',
          userState: round1Result.userState,
          backupState: round1Result.backupState,
        }),
      /finalizeCallback called before round2Callback/,
    );
  });
});
