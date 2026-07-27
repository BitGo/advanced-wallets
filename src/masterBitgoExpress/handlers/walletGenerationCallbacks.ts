import assert from 'assert';
import { DklsTypes } from '@bitgo-beta/sdk-lib-mpc';
import {
  CreateKeychainCallback,
  EcdsaMPCv2KeyGenCallbacks,
  EddsaKeyGenCallbacks,
} from '@bitgo-beta/sdk-core';
import { KeySource } from '../../shared/types';
import {
  AdvancedWalletManagerClient,
  IndependentKeychainResponse,
} from '../clients/advancedWalletManagerClient';

// DKLS23 party indices: user=0, backup=1, bitgo=2
const PARTY = { USER: 0, BACKUP: 1, BITGO: 2 } as const;

export function createOnchainKeyGenCallback(
  awmUserClient: AdvancedWalletManagerClient,
  awmBackupClient: AdvancedWalletManagerClient,
): CreateKeychainCallback {
  return async ({ source, coin }) => {
    assert(
      source === KeySource.USER || source === KeySource.BACKUP,
      `Unexpected key source for onchain key generation: ${source}`,
    );
    const client = source === KeySource.USER ? awmUserClient : awmBackupClient;
    const keychain = await client.createIndependentKeychain({ source, coin, type: 'independent' });
    return { pub: keychain.pub, type: 'independent' as const, source };
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

/** Narrows an AWM response to the encrypted session state the SDK threads between callbacks. */
function toMpcState(response: { encryptedData: string; encryptedDataKey: string }) {
  return { encryptedData: response.encryptedData, encryptedDataKey: response.encryptedDataKey };
}

/** Shape the AWM MPCv2 round endpoints expect for a BitGo broadcast message. */
function formatBroadcastMessage(message: { from: number; message: string; signature: string }) {
  return {
    from: message.from,
    payload: { message: message.message, signature: message.signature },
  };
}

/** Shape the AWM MPCv2 round endpoints expect for a BitGo p2p message. */
function formatP2PMessage(
  message: { from: number; to: number; encryptedMessage: string; signature: string },
  commitment?: string,
) {
  return {
    from: message.from,
    to: message.to,
    payload: { encryptedMessage: message.encryptedMessage, signature: message.signature },
    commitment,
  };
}

/**
 * Creates ECDSA MPCv2 key generation callbacks for the SDK external signer flow.
 *
 * Each callback drives both the user and the backup AWM. The SDK relays messages to and from BitGo,
 * while messages exchanged directly between user and backup are carried in this closure. The AWM
 * protocol has more rounds than the SDK has callbacks, so `round2Callback` runs AWM rounds 2 and 3
 * (both of its inputs arrive together from BitGo round 1) and `round3Callback` runs AWM round 4.
 */
export function createEcdsaMPCv2KeyGenCallbacks(
  awmUserClient: AdvancedWalletManagerClient,
  awmBackupClient: AdvancedWalletManagerClient,
): EcdsaMPCv2KeyGenCallbacks {
  // Messages the SDK never sees: user/backup broadcasts and the p2p messages they exchange.
  // round-2 counterparty messages are only used within round2Callback and are locals there.
  let userRound1Broadcast: DklsTypes.AuthBroadcastMessage;
  let backupRound1Broadcast: DklsTypes.AuthBroadcastMessage;
  let userRound3BitgoP2p: DklsTypes.AuthEncP2PMessage;
  let backupRound3BitgoP2p: DklsTypes.AuthEncP2PMessage;
  let userRound3CounterPartyP2p: DklsTypes.AuthEncP2PMessage;
  let backupRound3CounterPartyP2p: DklsTypes.AuthEncP2PMessage;
  let userRound4Broadcast: DklsTypes.AuthBroadcastMessage;
  let backupRound4Broadcast: DklsTypes.AuthBroadcastMessage;

  return {
    initializeCallback: async ({ bitgoPublicGpgKey }) => {
      const userInit = await awmUserClient.initEcdsaMpcV2KeyGenMpcV2({ source: KeySource.USER });
      const backupInit = await awmBackupClient.initEcdsaMpcV2KeyGenMpcV2({
        source: KeySource.BACKUP,
      });

      const [userRound1, backupRound1] = await Promise.all([
        awmUserClient.roundEcdsaMPCv2KeyGen({
          source: KeySource.USER,
          encryptedData: userInit.encryptedData,
          encryptedDataKey: userInit.encryptedDataKey,
          round: 1,
          bitgoGpgPub: bitgoPublicGpgKey,
          counterPartyGpgPub: backupInit.gpgPub,
        }),
        awmBackupClient.roundEcdsaMPCv2KeyGen({
          source: KeySource.BACKUP,
          encryptedData: backupInit.encryptedData,
          encryptedDataKey: backupInit.encryptedDataKey,
          round: 1,
          bitgoGpgPub: bitgoPublicGpgKey,
          counterPartyGpgPub: userInit.gpgPub,
        }),
      ]);
      assert(userRound1.broadcastMessage, 'Missing broadcast message in user round 1 response');
      assert(backupRound1.broadcastMessage, 'Missing broadcast message in backup round 1 response');
      userRound1Broadcast = userRound1.broadcastMessage;
      backupRound1Broadcast = backupRound1.broadcastMessage;

      return {
        userGpgPublicKey: userInit.gpgPub,
        backupGpgPublicKey: backupInit.gpgPub,
        round1Messages: {
          broadcastMessages: [userRound1.broadcastMessage, backupRound1.broadcastMessage],
          p2pMessages: [],
        },
        userState: toMpcState(userRound1),
        backupState: toMpcState(backupRound1),
      };
    },

    round2Callback: async ({
      bitgoMsg1,
      bitgoToUserMsg2,
      bitgoToBackupMsg2,
      userState,
      backupState,
    }) => {
      assert(userRound1Broadcast, 'round2Callback called before initializeCallback completed');
      assert(backupRound1Broadcast, 'round2Callback called before initializeCallback completed');
      const bitgoBroadcast = formatBroadcastMessage(bitgoMsg1);
      const [userRound2, backupRound2] = await Promise.all([
        awmUserClient.roundEcdsaMPCv2KeyGen({
          source: KeySource.USER,
          ...userState,
          round: 2,
          broadcastMessages: { bitgo: bitgoBroadcast, counterParty: backupRound1Broadcast },
        }),
        awmBackupClient.roundEcdsaMPCv2KeyGen({
          source: KeySource.BACKUP,
          ...backupState,
          round: 2,
          broadcastMessages: { bitgo: bitgoBroadcast, counterParty: userRound1Broadcast },
        }),
      ]);
      assert(userRound2.p2pMessages?.bitgo, 'Missing BitGo p2p message in user round 2 response');
      assert(
        backupRound2.p2pMessages?.bitgo,
        'Missing BitGo p2p message in backup round 2 response',
      );
      assert(
        userRound2.p2pMessages.counterParty,
        'Missing counterParty p2p in user round 2 response',
      );
      assert(
        backupRound2.p2pMessages.counterParty,
        'Missing counterParty p2p in backup round 2 response',
      );
      const userRound2CounterPartyP2p = userRound2.p2pMessages.counterParty;
      const backupRound2CounterPartyP2p = backupRound2.p2pMessages.counterParty;

      assert(bitgoToUserMsg2.from === PARTY.BITGO, 'bitgoToUserMsg2 is not from BitGo');
      assert(bitgoToUserMsg2.to === PARTY.USER, 'bitgoToUserMsg2 is not addressed to user');
      assert(bitgoToBackupMsg2.from === PARTY.BITGO, 'bitgoToBackupMsg2 is not from BitGo');
      assert(bitgoToBackupMsg2.to === PARTY.BACKUP, 'bitgoToBackupMsg2 is not addressed to backup');

      const [userRound3, backupRound3] = await Promise.all([
        awmUserClient.roundEcdsaMPCv2KeyGen({
          source: KeySource.USER,
          ...toMpcState(userRound2),
          round: 3,
          p2pMessages: {
            bitgo: formatP2PMessage(bitgoToUserMsg2),
            counterParty: backupRound2CounterPartyP2p,
          },
        }),
        awmBackupClient.roundEcdsaMPCv2KeyGen({
          source: KeySource.BACKUP,
          ...toMpcState(backupRound2),
          round: 3,
          p2pMessages: {
            bitgo: formatP2PMessage(bitgoToBackupMsg2),
            counterParty: userRound2CounterPartyP2p,
          },
        }),
      ]);
      assert(userRound3.p2pMessages?.bitgo, 'Missing BitGo p2p message in user round 3 response');
      assert(
        backupRound3.p2pMessages?.bitgo,
        'Missing BitGo p2p message in backup round 3 response',
      );
      assert(
        userRound3.p2pMessages.counterParty,
        'Missing counterParty p2p in user round 3 response',
      );
      assert(
        backupRound3.p2pMessages.counterParty,
        'Missing counterParty p2p in backup round 3 response',
      );
      userRound3BitgoP2p = userRound3.p2pMessages.bitgo;
      backupRound3BitgoP2p = backupRound3.p2pMessages.bitgo;
      userRound3CounterPartyP2p = userRound3.p2pMessages.counterParty;
      backupRound3CounterPartyP2p = backupRound3.p2pMessages.counterParty;

      return {
        round2Messages: {
          broadcastMessages: [],
          p2pMessages: [userRound2.p2pMessages.bitgo, backupRound2.p2pMessages.bitgo],
        },
        userState: toMpcState(userRound3),
        backupState: toMpcState(backupRound3),
      };
    },

    round3Callback: async ({
      bitgoCommitment2,
      bitgoToUserMsg3,
      bitgoToBackupMsg3,
      userState,
      backupState,
    }) => {
      assert(userRound3CounterPartyP2p, 'round3Callback called before round2Callback completed');
      assert(backupRound3CounterPartyP2p, 'round3Callback called before round2Callback completed');
      assert(userRound3BitgoP2p, 'round3Callback called before round2Callback completed');
      assert(backupRound3BitgoP2p, 'round3Callback called before round2Callback completed');
      assert(bitgoToUserMsg3.from === PARTY.BITGO, 'bitgoToUserMsg3 is not from BitGo');
      assert(bitgoToUserMsg3.to === PARTY.USER, 'bitgoToUserMsg3 is not addressed to user');
      assert(bitgoToBackupMsg3.from === PARTY.BITGO, 'bitgoToBackupMsg3 is not from BitGo');
      assert(bitgoToBackupMsg3.to === PARTY.BACKUP, 'bitgoToBackupMsg3 is not addressed to backup');
      const [userRound4, backupRound4] = await Promise.all([
        awmUserClient.roundEcdsaMPCv2KeyGen({
          source: KeySource.USER,
          ...userState,
          round: 4,
          p2pMessages: {
            bitgo: formatP2PMessage(bitgoToUserMsg3, bitgoCommitment2),
            counterParty: backupRound3CounterPartyP2p,
          },
        }),
        awmBackupClient.roundEcdsaMPCv2KeyGen({
          source: KeySource.BACKUP,
          ...backupState,
          round: 4,
          p2pMessages: {
            bitgo: formatP2PMessage(bitgoToBackupMsg3, bitgoCommitment2),
            counterParty: userRound3CounterPartyP2p,
          },
        }),
      ]);
      assert(userRound4.broadcastMessage, 'Missing broadcast message in user round 4 response');
      assert(backupRound4.broadcastMessage, 'Missing broadcast message in backup round 4 response');
      userRound4Broadcast = userRound4.broadcastMessage;
      backupRound4Broadcast = backupRound4.broadcastMessage;

      return {
        round3Messages: {
          broadcastMessages: [userRound4.broadcastMessage, backupRound4.broadcastMessage],
          p2pMessages: [userRound3BitgoP2p, backupRound3BitgoP2p],
        },
        userState: toMpcState(userRound4),
        backupState: toMpcState(backupRound4),
      };
    },

    finalizeCallback: async ({ bitgoMsg4, bitgoCommonKeychain, userState, backupState }) => {
      assert(userRound4Broadcast, 'finalizeCallback called before round3Callback completed');
      assert(backupRound4Broadcast, 'finalizeCallback called before round3Callback completed');
      const bitgoBroadcast = formatBroadcastMessage(bitgoMsg4);
      const [userFinalize, backupFinalize] = await Promise.all([
        awmUserClient.finalizeEcdsaMPCv2KeyGen({
          source: KeySource.USER,
          ...userState,
          broadcastMessages: { bitgo: bitgoBroadcast, counterParty: backupRound4Broadcast },
          bitgoCommonKeychain,
        }),
        awmBackupClient.finalizeEcdsaMPCv2KeyGen({
          source: KeySource.BACKUP,
          ...backupState,
          broadcastMessages: { bitgo: bitgoBroadcast, counterParty: userRound4Broadcast },
          bitgoCommonKeychain,
        }),
      ]);
      assert(userFinalize.commonKeychain, 'Missing common keychain in user finalize response');
      assert(backupFinalize.commonKeychain, 'Missing common keychain in backup finalize response');
      assert.strictEqual(
        userFinalize.commonKeychain,
        backupFinalize.commonKeychain,
        'User and backup common keychains do not match',
      );
      assert.strictEqual(
        userFinalize.commonKeychain,
        bitgoCommonKeychain,
        'User and BitGo common keychains do not match',
      );

      return { commonKeychain: userFinalize.commonKeychain };
    },
  };
}

/**
 * Creates EdDSA (MPCv1) key generation callbacks for the SDK external signer flow.
 *
 * `initializeCallback` runs both parties — the backup AWM needs the user's GPG key — and
 * `finalizeCallback` is invoked once per source, user first, so the user's counterparty key share
 * can be handed to the backup AWM.
 */
export function createEddsaKeyGenCallbacks(
  awmUserClient: AdvancedWalletManagerClient,
  awmBackupClient: AdvancedWalletManagerClient,
): EddsaKeyGenCallbacks {
  return {
    initializeCallback: async ({ bitgoPublicGpgKey }) => {
      const userInit = await awmUserClient.initMpcKeyGeneration({
        source: KeySource.USER,
        bitgoGpgKey: bitgoPublicGpgKey,
      });
      const backupInit = await awmBackupClient.initMpcKeyGeneration({
        source: KeySource.BACKUP,
        bitgoGpgKey: bitgoPublicGpgKey,
        userGpgKey: userInit.bitgoPayload.gpgKey,
      });
      assert.strictEqual(
        userInit.bitgoPayload.from,
        KeySource.USER,
        'User payload is not from user',
      );
      assert.strictEqual(
        backupInit.bitgoPayload.from,
        KeySource.BACKUP,
        'Backup payload is not from backup',
      );
      assert(
        backupInit.counterPartyKeyShare,
        'Backup key share for the user is missing from the initialization response',
      );

      return {
        userGpgPublicKey: userInit.bitgoPayload.gpgKey,
        backupGpgPublicKey: backupInit.bitgoPayload.gpgKey,
        userToBitgoKeyShare: userInit.bitgoPayload,
        backupToBitgoKeyShare: backupInit.bitgoPayload,
        backupToUserCounterPartyKeyShare: backupInit.counterPartyKeyShare,
        userState: toMpcState(userInit),
        backupState: toMpcState(backupInit),
      };
    },

    finalizeCallback: async ({
      source,
      coin,
      bitgoKeychain,
      counterPartyGPGKey,
      counterPartyKeyShare,
      state,
    }) => {
      const isUser = source === KeySource.USER;
      const client = isUser ? awmUserClient : awmBackupClient;
      assert(bitgoKeychain.commonKeychain, 'Missing commonKeychain in BitGo keychain');
      assert(bitgoKeychain.keyShares, 'Missing keyShares in BitGo keychain');
      const response = await client.finalizeMpcKeyGeneration({
        source,
        coin,
        encryptedData: state.encryptedData,
        encryptedDataKey: state.encryptedDataKey,
        bitGoKeychain: {
          ...bitgoKeychain,
          commonKeychain: bitgoKeychain.commonKeychain,
          source: KeySource.BITGO,
          type: 'tss',
          verifiedVssProof: true,
          isBitGo: true,
          isTrust: false,
          keyShares: bitgoKeychain.keyShares,
        },
        counterPartyGPGKey,
        counterPartyKeyShare: {
          ...counterPartyKeyShare,
          from: isUser ? KeySource.BACKUP : KeySource.USER,
          to: source,
        },
      });

      if (isUser) {
        assert(
          response.counterpartyKeyShare,
          'Key share for backup missing from user finalize response',
        );
      }
      return {
        commonKeychain: response.commonKeychain,
        counterpartyKeyShare: response.counterpartyKeyShare,
      };
    },
  };
}
