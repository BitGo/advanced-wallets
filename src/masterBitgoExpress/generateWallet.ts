import {
  promiseProps,
  RequestTracer,
  SupplementGenerateWalletOptions,
  Keychain,
  KeychainsTriplet,
  Wallet,
  WalletWithKeychains,
  AddKeychainOptions,
  NotImplementedError,
} from '@bitgo/sdk-core';
import _ from 'lodash';
import { MasterApiSpecRouteRequest } from './routers/masterApiSpec';

/**
 * This route is used to generate a multisig wallet when enclaved express is enabled
 */
export async function handleGenerateOnPremOnChainWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);

  // The enclavedExpressClient is now available from the request
  const enclavedExpressClient = req.enclavedExpressClient;

  const reqId = new RequestTracer();

  const { label, enterprise } = req.decoded;

  // Create wallet parameters with type assertion to allow 'onprem' subtype
  const walletParams = {
    label: label,
    m: 2,
    n: 3,
    keys: [],
    type: 'cold',
    subType: 'onPrem',
    multisigType: 'onchain',
  } as unknown as SupplementGenerateWalletOptions; // TODO: Add onprem to the SDK subType and remove "unknown" type casting

  if (!_.isUndefined(enterprise)) {
    if (!_.isString(enterprise)) {
      throw new Error('invalid enterprise argument, expecting string');
    }
    walletParams.enterprise = enterprise;
  }

  const userKeychainPromise = async (): Promise<Keychain> => {
    const userKeychain = await enclavedExpressClient.createIndependentKeychain({
      source: 'user',
      coin: req.params.coin,
      type: 'independent',
    });
    const userKeychainParams: AddKeychainOptions = {
      pub: userKeychain.pub,
      keyType: userKeychain.type,
      source: userKeychain.source,
      reqId,
    };

    const newUserKeychain = await baseCoin.keychains().add(userKeychainParams);
    return _.extend({}, newUserKeychain, userKeychain);
  };

  const backupKeychainPromise = async (): Promise<Keychain> => {
    const backupKeychain = await enclavedExpressClient.createIndependentKeychain({
      source: 'backup',
      coin: req.params.coin,
      type: 'independent',
    });
    const backupKeychainParams: AddKeychainOptions = {
      pub: backupKeychain.pub,
      keyType: backupKeychain.type,
      source: backupKeychain.source,
      reqId,
    };

    const newBackupKeychain = await baseCoin.keychains().add(backupKeychainParams);
    return _.extend({}, newBackupKeychain, backupKeychain);
  };

  const { userKeychain, backupKeychain, bitgoKeychain }: KeychainsTriplet = await promiseProps({
    userKeychain: userKeychainPromise(),
    backupKeychain: backupKeychainPromise(),
    bitgoKeychain: baseCoin.keychains().createBitGo({
      enterprise: req.decoded.enterprise,
      keyType: 'independent',
      reqId,
      isDistributedCustody: req.decoded.isDistributedCustody,
    }),
  });

  walletParams.keys = [userKeychain.id, backupKeychain.id, bitgoKeychain.id];

  const keychains = {
    userKeychain,
    backupKeychain,
    bitgoKeychain,
  };

  const finalWalletParams = await baseCoin.supplementGenerateWallet(walletParams, keychains);

  bitgo.setRequestTracer(reqId);
  const newWallet = await bitgo.post(baseCoin.url('/wallet/add')).send(finalWalletParams).result();

  const result: WalletWithKeychains = {
    wallet: new Wallet(bitgo, baseCoin, newWallet),
    userKeychain: userKeychain,
    backupKeychain: backupKeychain,
    bitgoKeychain: bitgoKeychain,
    responseType: 'WalletWithKeychains',
  };

  return { ...result, wallet: result.wallet.toJSON() };
}

export async function handleGenerateOnPremMpcWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.decoded.coin);
  const enclavedExpressClient = req.enclavedExpressClient;

  if (!baseCoin.supportsTss()) {
    throw new NotImplementedError(
      `MPC wallet generation is not supported for coin ${req.decoded.coin}`,
    );
  }

  if (!enclavedExpressClient) {
    throw new Error('Enclaved express client is required for MPC wallet generation');
  }

  const reqId = new RequestTracer(); // Create tracer without storing reference since it's not used

  const { label, enterprise } = req.decoded;

  // Create wallet parameters with type assertion to allow 'tss' subtype
  const walletParams = {
    label: label,
    m: 2,
    n: 3,
    keys: [],
    type: 'hot',
    subType: 'tss',
    multisigType: 'tss',
  } as unknown as SupplementGenerateWalletOptions;

  if (!_.isUndefined(enterprise)) {
    if (!_.isString(enterprise)) {
      throw new Error('invalid enterprise argument, expecting string');
    }
    walletParams.enterprise = enterprise;
  }

  // Initialize key generation for user and backup
  const userInitResponse = await enclavedExpressClient.initMpcKeyGeneration({
    source: 'user',
    coin: req.params.coin,
  });

  const backupInitResponse = await enclavedExpressClient.initMpcKeyGeneration({
    source: 'backup',
    coin: req.params.coin,
  });

  // Extract GPG keys based on payload type
  const userGPGKey =
    userInitResponse.bitgoPayload.from === 'user'
      ? userInitResponse.bitgoPayload.userGPGPublicKey
      : undefined;

  const backupGPGKey =
    backupInitResponse.bitgoPayload.from === 'backup'
      ? backupInitResponse.bitgoPayload.backupGPGPublicKey
      : undefined;

  if (!userGPGKey || !backupGPGKey) {
    throw new Error('Missing required GPG keys from payloads');
  }

  // Create BitGo keychain using the initialization responses
  const bitgoKeychain = await baseCoin.keychains().add({
    keyType: 'tss',
    source: 'bitgo',
    keyShares: [userInitResponse.bitgoPayload, backupInitResponse.bitgoPayload],
    enterprise: req.decoded.enterprise,
    userGPGPublicKey: userGPGKey,
    backupGPGPublicKey: backupGPGKey,
    reqId,
  });

  throw new NotImplementedError('MPC wallet generation is not fully implemented yet');

  // // Finalize user and backup keychains
  // const userKeychainPromise = enclavedExpressClient.finalizeMpcKeyGeneration({
  //   source: 'user',
  //   coin: req.params.coin,
  //   encryptedDataKey: userInitResponse.encryptedDataKey,
  //   encryptedData: userInitResponse.encryptedData,
  //   bitGoKeychain: tssKeychain,
  // });

  // const backupKeychainPromise = enclavedExpressClient.finalizeMpcKeyGeneration({
  //   source: 'backup',
  //   coin: req.params.coin,
  //   encryptedDataKey: backupInitResponse.encryptedDataKey,
  //   encryptedData: backupInitResponse.encryptedData,
  //   bitGoKeychain: tssKeychain,
  // });

  // const [userKeychain, backupKeychain] = await Promise.all([
  //   userKeychainPromise,
  //   backupKeychainPromise,
  // ]);

  // walletParams.keys = [
  //   userKeychain.enclavedExpressKeyId,
  //   backupKeychain.enclavedExpressKeyId,
  //   bitgoKeychain.id,
  // ];

  // const keychains = {
  //   userKeychain,
  //   backupKeychain,
  //   bitgoKeychain,
  // };

  // const finalWalletParams = await baseCoin.supplementGenerateWallet(walletParams, keychains);

  // bitgo.setRequestTracer(reqId);
  // const newWallet = await bitgo.post(baseCoin.url('/wallet/add')).send(finalWalletParams).result();

  // const result: WalletWithKeychains = {
  //   wallet: new Wallet(bitgo, baseCoin, newWallet),
  //   userKeychain: userKeychain,
  //   backupKeychain: backupKeychain,
  //   bitgoKeychain: bitgoKeychain,
  //   responseType: 'WalletWithKeychains',
  // };

  // return { ...result, wallet: result.wallet.toJSON() };
}

export async function handleGenerateWalletOnPrem(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const { multisigType } = req.body;

  if (multisigType === 'tss') {
    return handleGenerateOnPremMpcWallet(req);
  }

  return handleGenerateOnPremOnChainWallet(req);
}
