import {
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
import { KeySource } from '../../shared/types';
import { submitJobViaBridgeClient } from './utils/asyncUtils';
import { createOnchainKeyGenCallback } from './walletGenerationCallbacks';
import { getBaseWalletParams } from './utils/walletCreationUtils';

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

  return handleGenerateOnChainWallet(req);
}

/**
 * This route is used to generate a multisig wallet when advanced wallet manager is enabled
 */
async function handleGenerateOnChainWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const asyncResult = await submitJobViaBridgeClient(req, {
    path: `/api/${req.params.coin}/key/independent`,
    body: req.decoded,
    sources: [KeySource.USER, KeySource.BACKUP],
    operationType: 'multisig_keygen',
  });
  if (asyncResult) {
    return asyncResult;
  }

  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.params.coin, bitgo);

  const createKeychainCallback = createOnchainKeyGenCallback(
    req.awmUserClient,
    req.awmBackupClient,
  );

  const result = await baseCoin.wallets().generateWallet({
    ...req.decoded,
    type: 'advanced',
    multisigType: 'onchain',
    createKeychainCallback,
  });
  return { ...result, wallet: result.wallet.toJSON() };
}

/**
 * Generates a MPC wallet
 */
async function handleGenerateMpcWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  if (req.config.asyncModeConfig.enabled) {
    throw new BadRequestError('Async mode is not yet supported for TSS wallet generation');
  }

  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.decoded.coin, bitgo);
  const awmClient = req.awmUserClient;
  const awmBackupClient = req.awmBackupClient;

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
    label,
    ...getBaseWalletParams('tss'),
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
        awmBackupClient,
        enterprise,
        walletParams,
      });
      break;
    case 'eddsa':
      orchestrateResult = await orchestrateEddsaKeyGen({
        bitgo,
        baseCoin,
        awmClient,
        awmBackupClient,
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

/**
 * This function generates an EVM keyring wallet by reusing keys from a reference wallet.
 */
async function handleGenerateEvmKeyRingWallet(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  if (req.config.asyncModeConfig.enabled) {
    throw new BadRequestError('Async mode is not yet supported for EVM keyring wallet generation');
  }

  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.decoded.coin, bitgo);
  if (!baseCoin.isEVM()) {
    throw new BadRequestError(
      `EVM keyring wallet generation is not supported for coin ${req.decoded.coin}`,
    );
  }

  const result = await baseCoin.wallets().generateWallet(req.decoded);

  return {
    ...result,
    wallet: result.wallet.toJSON(),
  };
}
