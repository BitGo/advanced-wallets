import {
  AddKeychainOptions,
  Keychain,
  KeychainsTriplet,
  promiseProps,
  RequestTracer,
  SupplementGenerateWalletOptions,
  Wallet,
  WalletWithKeychains,
} from '@bitgo-beta/sdk-core';
import _ from 'lodash';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';
import { orchestrateEcdsaKeyGen } from './ecdsa';
import { orchestrateEddsaKeyGen } from './eddsa';
import coinFactory from '../../shared/coinFactory';
import { BadRequestError } from '../../shared/errors';

/**
 * Request handler for generating an advanced wallet.
 */
export async function handleGenerateWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const { multisigType, evmKeyRingReferenceWalletId } = req.decoded;

  if (evmKeyRingReferenceWalletId) {
    return handleGenerateEvmKeyRingWallet(req);
  }

  if (multisigType === 'tss') {
    return handleGenerateMpcWallet(req);
  }

  if (multisigType === 'onchain') {
    return handleGenerateOnChainWallet(req);
  }

  throw new BadRequestError(
    'multisigType is required when evmKeyRingReferenceWalletId is not provided',
  );
}

/**
 * Generates an EVM keyring wallet. Keyring wallets share keys from a reference
 * wallet, so no AWM/KMS interaction is needed — we delegate directly to the SDK.
 */
async function handleGenerateEvmKeyRingWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.params.coin, bitgo);

  const result = await baseCoin.wallets().generateWallet({
    label: req.decoded.label,
    enterprise: req.decoded.enterprise,
    evmKeyRingReferenceWalletId: req.decoded.evmKeyRingReferenceWalletId,
  });

  return { ...result, wallet: result.wallet.toJSON() };
}

/**
 * This route is used to generate a multisig wallet when advanced wallet manager is enabled
 */
async function handleGenerateOnChainWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.params.coin, bitgo);

  // The awmClient is now available from the request
  const awmClient = req.awmClient;

  const reqId = new RequestTracer();

  const { label, enterprise } = req.decoded;

  // Create wallet parameters
  const walletParams = {
    ...req.decoded,
    label: label,
    m: 2,
    n: 3,
    keys: [],
    type: 'advanced',
    multisigType: 'onchain',
  } as SupplementGenerateWalletOptions;

  if (!_.isUndefined(enterprise)) {
    if (!_.isString(enterprise)) {
      throw new Error('invalid enterprise argument, expecting string');
    }
    walletParams.enterprise = enterprise;
  }

  const userKeychainPromise = async (): Promise<Keychain> => {
    const userKeychain = await awmClient.createIndependentKeychain({
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
    const backupKeychain = await awmClient.createIndependentKeychain({
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

/**
 * Generates a MPC wallet
 */
async function handleGenerateMpcWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.decoded.coin, bitgo);
  const awmClient = req.awmClient;

  if (!baseCoin.supportsTss()) {
    throw new BadRequestError(
      `MPC wallet generation is not supported for coin ${req.decoded.coin}`,
    );
  }

  if (!awmClient) {
    throw new Error('Advanced Wallet Manager client is required for MPC wallet generation');
  }

  const reqId = new RequestTracer();
  const { label, enterprise } = req.decoded;

  const walletParams: SupplementGenerateWalletOptions = {
    ...req.decoded,
    label: label,
    m: 2,
    n: 3,
    keys: [],
    type: 'advanced',
    multisigType: 'tss',
  };

  if (!_.isUndefined(enterprise)) {
    if (!_.isString(enterprise)) {
      throw new BadRequestError('invalid enterprise argument, expecting string');
    }
    walletParams.enterprise = enterprise;
  }

  const algorithm = baseCoin.getMPCAlgorithm();
  let orchestrateResult;
  switch (algorithm) {
    case 'ecdsa':
      orchestrateResult = await orchestrateEcdsaKeyGen({
        bitgo,
        baseCoin,
        awmClient,
        enterprise,
        walletParams,
      });
      break;
    case 'eddsa':
      orchestrateResult = await orchestrateEddsaKeyGen({
        bitgo,
        baseCoin,
        awmClient,
        walletParams,
        enterprise,
      });
      break;
    default:
      throw new Error(`Unsupported MPC algorithm: ${algorithm}`);
  }

  const { keychains, walletParams: finalWalletParams } = orchestrateResult;
  bitgo.setRequestTracer(reqId);
  const newWallet = await bitgo.post(baseCoin.url('/wallet/add')).send(finalWalletParams).result();

  const result: WalletWithKeychains = {
    wallet: new Wallet(bitgo, baseCoin, newWallet),
    userKeychain: keychains.userKeychain,
    backupKeychain: keychains.backupKeychain,
    bitgoKeychain: keychains.bitgoKeychain,
    responseType: 'WalletWithKeychains',
  };

  return { ...result, wallet: result.wallet.toJSON() };
}
