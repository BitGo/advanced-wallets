import debug from 'debug';
import * as bitgoSdk from '@bitgo-beta/sdk-core';
import { assert } from 'console';
import { KmsClient } from '../../kms/kmsClient';
import {
  AwmApiSpecRouteRequest,
  KeyShareType,
  MpcInitializeRequestType,
} from '../../advancedWalletManager/routers/advancedWalletManagerApiSpec';
import { gpgEncrypt } from './utils';

const debugLogger = debug('bitgo:awm:mpcInitialize');

export async function eddsaInitialize(
  req: AwmApiSpecRouteRequest<'v1.mpc.key.initialize', 'post'>,
) {
  // request parsing. counterPartyGpgPub can be undefined
  const { source, bitgoGpgPub, counterPartyGpgPub }: MpcInitializeRequestType = req.decoded;
  if (source === 'backup' && !counterPartyGpgPub) {
    throw new Error('gpgKey is required on backup key share generation');
  }

  // setup clients
  const kms = new KmsClient(req.config);

  // MPC configuration
  const MPC = await bitgoSdk.Eddsa.initialize();
  const m = 2;
  const n = 3;

  // key share generation of source. 1 is user, 2 is backup, 3 is BitGo
  const sourceIndex = source === 'user' ? 1 : 2;
  const counterPartyIndex = source === 'user' ? 2 : 1;
  const bitgoIndex = 3;
  const keyShare: bitgoSdk.KeyShare = MPC.keyShare(sourceIndex, m, n);
  const sourceGpgKey = await bitgoSdk.generateGPGKeyPair('secp256k1');

  // source to source private share
  const sourcePrivateShare = keyShare.uShare;

  // public share used in both bitgo and counterPartySource key share
  const publicShare = Buffer.concat([
    Buffer.from(keyShare.uShare.y, 'hex'),
    Buffer.from(keyShare.uShare.chaincode, 'hex'),
  ]).toString('hex');

  // source to BitGo private share
  const bitgoPrivateShare = Buffer.concat([
    Buffer.from(keyShare.yShares[bitgoIndex].u, 'hex'),
    Buffer.from(keyShare.yShares[bitgoIndex].chaincode, 'hex'),
  ]).toString('hex');

  assert(keyShare.yShares[bitgoIndex].v, 'BitGo share v is required for proof generation');
  const bitgoKeyShare: KeyShareType = {
    from: source,
    to: 'bitgo',
    publicShare,
    privateShare: await gpgEncrypt(bitgoPrivateShare, bitgoGpgPub),
    privateShareProof: await bitgoSdk.createShareProof(
      sourceGpgKey.privateKey,
      bitgoPrivateShare.slice(0, 64),
      'eddsa',
    ),
    vssProof: keyShare.yShares[bitgoIndex].v as string,
    gpgKey: sourceGpgKey.publicKey,
  };

  // source to counter party private share
  const counterPartyPrivateShare = Buffer.concat([
    Buffer.from(keyShare.yShares[counterPartyIndex].u, 'hex'),
    Buffer.from(keyShare.yShares[counterPartyIndex].chaincode, 'hex'),
  ]).toString('hex');

  assert(
    keyShare.yShares[counterPartyIndex].v,
    `Counter party share v is required for proof generation for index ${counterPartyIndex}`,
  );
  const counterPartyKeyShare: KeyShareType = {
    from: source,
    to: source === 'user' ? 'backup' : 'user',
    publicShare: publicShare,
    privateShare: counterPartyGpgPub // if counterPartyGpgPub is provided, encrypt the private key share using counter party's GPG public key
      ? await gpgEncrypt(counterPartyPrivateShare, counterPartyGpgPub)
      : counterPartyPrivateShare,
    privateShareProof: await bitgoSdk.createShareProof(
      sourceGpgKey.privateKey,
      counterPartyPrivateShare.slice(0, 64),
      'eddsa',
    ),
    vssProof: keyShare.yShares[counterPartyIndex].v as string,
    gpgKey: sourceGpgKey.publicKey,
  };

  // construct encrypted payload. EBE receives back this payload in finalize since it can't keep it in memory
  const payload = {
    sourceGpgPub: sourceGpgKey.publicKey,
    sourceGpgPrv: sourceGpgKey.privateKey,
    sourcePrivateShare,
    counterPartyKeyShare: counterPartyGpgPub ? undefined : counterPartyKeyShare, // if counterPartyGpgPub is NOT gpg encrypted, store in payload to be encrypted in finalize
  };
  const { plaintextKey, encryptedKey } = await kms.generateDataKey({ keyType: 'AES-256' });
  try {
    const encryptedPayload = req.bitgo.encrypt({
      input: JSON.stringify(payload),
      password: plaintextKey,
    });
    return {
      encryptedDataKey: encryptedKey,
      encryptedData: encryptedPayload,
      bitgoPayload: bitgoKeyShare,
      counterPartyKeyShare: counterPartyGpgPub ? counterPartyKeyShare : undefined, // if counterPartyGpgPub is encrypted, send the key share unecrypted
    };
  } catch (error) {
    debugLogger('Failed to initialize mpc key generation', error);
    throw error;
  }
}
