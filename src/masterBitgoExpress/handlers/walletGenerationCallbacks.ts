import { CreateKeychainCallback } from '@bitgo-beta/sdk-core';
import { KeySource } from '../../shared/types';
import {
  AdvancedWalletManagerClient,
  IndependentKeychainResponse,
} from '../clients/advancedWalletManagerClient';

/**
 * Callback types for EdDSA MPCv2 key generation via external signer.
 *
 * These mirror the EddsaMPCv2KeyGenCallbacks shape defined in BitGoJS (WCI-894).
 * Once that type is published to @bitgo-beta/sdk-core it can replace this local
 * definition.
 */
export type EddsaMPCv2KeyGenInitializeParams = {
  enterprise: string;
  bitgoPublicGpgKey: string;
};

export type EddsaMPCv2KeyGenInitializeResult = {
  userGpgPublicKey: string;
  backupGpgPublicKey: string;
  userSignedMsg1: { message: string; signature: string };
  backupSignedMsg1: { message: string; signature: string };
  userEncryptedState: string;
  userEncryptedStateKey: string;
  backupEncryptedState: string;
  backupEncryptedStateKey: string;
};

export type EddsaMPCv2KeyGenRound1Params = {
  bitgoMsg1: { message: string; signature: string };
  userEncryptedState: string;
  userEncryptedStateKey: string;
  backupEncryptedState: string;
  backupEncryptedStateKey: string;
};

export type EddsaMPCv2KeyGenRound1Result = {
  userSignedMsg2: { message: string; signature: string };
  backupSignedMsg2: { message: string; signature: string };
  userEncryptedState: string;
  userEncryptedStateKey: string;
  backupEncryptedState: string;
  backupEncryptedStateKey: string;
};

export type EddsaMPCv2KeyGenFinalizeParams = {
  bitgoMsg2: { message: string; signature: string };
  commonPublicKeychain: string;
  userEncryptedState: string;
  userEncryptedStateKey: string;
  backupEncryptedState: string;
  backupEncryptedStateKey: string;
};

export type EddsaMPCv2KeyGenFinalizeResult = {
  commonKeychain: string;
};

export type EddsaMPCv2KeyGenCallbacks = {
  initializeCallback: (
    params: EddsaMPCv2KeyGenInitializeParams,
  ) => Promise<EddsaMPCv2KeyGenInitializeResult>;
  round1Callback: (params: EddsaMPCv2KeyGenRound1Params) => Promise<EddsaMPCv2KeyGenRound1Result>;
  finalizeCallback: (
    params: EddsaMPCv2KeyGenFinalizeParams,
  ) => Promise<EddsaMPCv2KeyGenFinalizeResult>;
};

/**
 * Creates EdDSA MPCv2 key generation callbacks that delegate WASM/GPG/DKG
 * operations to the AWM service.  Each callback fans out to both AWM clients
 * in parallel and merges the results before returning to the SDK orchestrator.
 */
export function createEddsaMPCv2KeyGenCallbacks(
  awmUserClient: AdvancedWalletManagerClient,
  awmBackupClient: AdvancedWalletManagerClient,
): EddsaMPCv2KeyGenCallbacks {
  return {
    initializeCallback: async ({
      enterprise,
      bitgoPublicGpgKey,
    }: EddsaMPCv2KeyGenInitializeParams): Promise<EddsaMPCv2KeyGenInitializeResult> => {
      const [userInit, backupInit] = await Promise.all([
        awmUserClient.eddsaMPCv2KeyGenInitialize({
          source: 'user',
          enterprise,
          bitgoPublicGpgKey,
        }),
        awmBackupClient.eddsaMPCv2KeyGenInitialize({
          source: 'backup',
          enterprise,
          bitgoPublicGpgKey,
        }),
      ]);

      return {
        userGpgPublicKey: userInit.gpgPublicKey,
        backupGpgPublicKey: backupInit.gpgPublicKey,
        userSignedMsg1: userInit.signedMsg1,
        backupSignedMsg1: backupInit.signedMsg1,
        userEncryptedState: userInit.encryptedState,
        userEncryptedStateKey: userInit.encryptedStateKey,
        backupEncryptedState: backupInit.encryptedState,
        backupEncryptedStateKey: backupInit.encryptedStateKey,
      };
    },

    round1Callback: async ({
      bitgoMsg1,
      userEncryptedState,
      userEncryptedStateKey,
      backupEncryptedState,
      backupEncryptedStateKey,
    }: EddsaMPCv2KeyGenRound1Params): Promise<EddsaMPCv2KeyGenRound1Result> => {
      const [userR1, backupR1] = await Promise.all([
        awmUserClient.eddsaMPCv2KeyGenRound1({
          source: 'user',
          bitgoMsg1,
          encryptedState: userEncryptedState,
          encryptedStateKey: userEncryptedStateKey,
        }),
        awmBackupClient.eddsaMPCv2KeyGenRound1({
          source: 'backup',
          bitgoMsg1,
          encryptedState: backupEncryptedState,
          encryptedStateKey: backupEncryptedStateKey,
        }),
      ]);

      return {
        userSignedMsg2: userR1.signedMsg2,
        backupSignedMsg2: backupR1.signedMsg2,
        userEncryptedState: userR1.encryptedState,
        userEncryptedStateKey: userR1.encryptedStateKey,
        backupEncryptedState: backupR1.encryptedState,
        backupEncryptedStateKey: backupR1.encryptedStateKey,
      };
    },

    finalizeCallback: async ({
      bitgoMsg2,
      commonPublicKeychain,
      userEncryptedState,
      userEncryptedStateKey,
      backupEncryptedState,
      backupEncryptedStateKey,
    }: EddsaMPCv2KeyGenFinalizeParams): Promise<EddsaMPCv2KeyGenFinalizeResult> => {
      const [userFinalize] = await Promise.all([
        awmUserClient.eddsaMPCv2KeyGenFinalize({
          source: 'user',
          bitgoMsg2,
          commonPublicKeychain,
          encryptedState: userEncryptedState,
          encryptedStateKey: userEncryptedStateKey,
        }),
        awmBackupClient.eddsaMPCv2KeyGenFinalize({
          source: 'backup',
          bitgoMsg2,
          commonPublicKeychain,
          encryptedState: backupEncryptedState,
          encryptedStateKey: backupEncryptedStateKey,
        }),
      ]);

      return {
        commonKeychain: userFinalize.commonKeychain,
      };
    },
  };
}

export function createOnchainKeyGenCallback(
  awmUserClient: AdvancedWalletManagerClient,
  awmBackupClient: AdvancedWalletManagerClient,
): CreateKeychainCallback {
  return async ({ source, coin }) => {
    let client: AdvancedWalletManagerClient;
    if (source === KeySource.USER) {
      client = awmUserClient;
    } else if (source === KeySource.BACKUP) {
      client = awmBackupClient;
    } else {
      throw new Error(`Unexpected key source for onchain key generation: ${source}`);
    }

    const keychain = await client.createIndependentKeychain({ source, coin, type: 'independent' });
    return keychain as { pub: string; type: 'independent'; source: typeof source };
  };
}

export function createOnchainKeyGenCallbackForPreGeneratedKeychains(
  preGeneratedKeychains: Record<KeySource.USER | KeySource.BACKUP, IndependentKeychainResponse>,
): CreateKeychainCallback {
  return async ({ source, coin: _ }) => {
    if (!(source in preGeneratedKeychains)) {
      throw new Error(`${source} keychain not available for onchain key generation`);
    }

    const keychain = preGeneratedKeychains[source];
    return {
      source,
      pub: keychain.pub,
      type: 'independent',
    };
  };
}
