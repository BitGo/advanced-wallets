import assert from 'assert';
import { GenerateWalletWithExternalSignerOptions, MPCAlgorithm } from '@bitgo-beta/sdk-core';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';
import coinFactory from '../../shared/coinFactory';
import { BadRequestError } from '../../shared/errors';
import { KeySource } from '../../shared/types';
import { submitJobViaBridgeClient } from './utils/asyncUtils';
import {
  createEcdsaMPCv2KeyGenCallbacks,
  createEddsaKeyGenCallbacks,
  createOnchainKeyGenCallback,
} from './walletGenerationCallbacks';

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

  const isTss = multisigType === 'tss';

  if (isTss) {
    if (req.config.asyncModeConfig.enabled) {
      throw new BadRequestError('Async mode is not yet supported for TSS wallet generation');
    }
  } else {
    const asyncResult = await submitJobViaBridgeClient(req, {
      path: `/api/${req.params.coin}/key/independent`,
      body: req.decoded,
      sources: [KeySource.USER, KeySource.BACKUP],
      operationType: 'multisig_keygen',
    });
    if (asyncResult) {
      return asyncResult;
    }
  }

  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.params.coin, bitgo);

  if (isTss && !baseCoin.supportsTss()) {
    throw new BadRequestError(`MPC wallet generation is not supported for coin ${req.params.coin}`);
  }

  const result = await baseCoin.wallets().generateWalletWithExternalSigner({
    ...req.decoded,
    type: 'advanced',
    multisigType: isTss ? 'tss' : 'onchain',
    ...keyGenCallbacks(req, isTss ? baseCoin.getMPCAlgorithm() : undefined),
  });

  return { ...result, wallet: result.wallet.toJSON() };
}

/**
 * Picks the AWM key generation callbacks the SDK should drive, based on the coin's MPC algorithm.
 * An undefined algorithm means an onchain multisig wallet.
 */
function keyGenCallbacks(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
  algorithm: MPCAlgorithm | undefined,
): Pick<
  GenerateWalletWithExternalSignerOptions,
  'createKeychainCallback' | 'ecdsaMPCv2Callbacks' | 'eddsaCallbacks'
> {
  const { awmUserClient, awmBackupClient } = req;
  assert(awmUserClient, 'User AWM client not initialized');
  assert(awmBackupClient, 'Backup AWM client not initialized');

  switch (algorithm) {
    case undefined:
      return {
        createKeychainCallback: createOnchainKeyGenCallback(awmUserClient, awmBackupClient),
      };
    case 'ecdsa':
      return {
        ecdsaMPCv2Callbacks: createEcdsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient),
      };
    case 'eddsa':
      return { eddsaCallbacks: createEddsaKeyGenCallbacks(awmUserClient, awmBackupClient) };
    default:
      throw new BadRequestError(`Unsupported MPC algorithm: ${algorithm}`);
  }
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
  const baseCoin = await coinFactory.getCoin(req.params.coin, bitgo);
  if (!baseCoin.isEVM()) {
    throw new BadRequestError(
      `EVM keyring wallet generation is not supported for coin ${req.params.coin}`,
    );
  }

  const result = await baseCoin.wallets().generateWallet(req.decoded);

  return {
    ...result,
    wallet: result.wallet.toJSON(),
  };
}
