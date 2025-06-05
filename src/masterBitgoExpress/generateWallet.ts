import {
  GenerateWalletOptions,
  promiseProps,
  RequestTracer,
  SupplementGenerateWalletOptions,
  Keychain,
  KeychainsTriplet,
  Wallet,
  WalletWithKeychains,
  AddKeychainOptions,
} from '@bitgo/sdk-core';
import { createEnclavedExpressClient } from './enclavedExpressClient';
import _ from 'lodash';
import { BitGoRequest } from '../types/request';

/**
 * This route is used to generate a multisig wallet when enclaved express is enabled
 */
export async function handleGenerateWalletOnPrem(req: BitGoRequest) {
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);

  const enclavedExpressClient = createEnclavedExpressClient(req.config, req.params.coin);
  if (!enclavedExpressClient) {
    throw new Error(
      'Enclaved express client not configured - enclaved express features will be disabled',
    );
  }

  const params = req.body as GenerateWalletOptions;
  const reqId = new RequestTracer();

  // Assign the default multiSig type value based on the coin
  if (!params.multisigType) {
    params.multisigType = baseCoin.getDefaultMultisigType();
  }

  if (typeof params.label !== 'string') {
    throw new Error('missing required string parameter label');
  }

  const { label, enterprise } = params;

  // Create wallet parameters with type assertion to allow 'onprem' subtype
  const walletParams = {
    label: label,
    m: 2,
    n: 3,
    keys: [],
    type: 'cold',
    subType: 'onprem',
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
      enterprise: params.enterprise,
      reqId,
      isDistributedCustody: params.isDistributedCustody,
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
