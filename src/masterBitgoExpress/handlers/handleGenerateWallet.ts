import assert from 'assert';
import { GenerateWalletWithExternalSignerOptions, MPCAlgorithm } from '@bitgo-beta/sdk-core';
import { TssSettings } from '@bitgo/public-types';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';
import coinFactory from '../../shared/coinFactory';
import { BadRequestError } from '../../shared/errors';
import { KeySource } from '../../shared/types';
import { submitJobViaBridgeClient } from './utils/asyncUtils';
import {
  createEcdsaMPCv2KeyGenCallbacks,
  createEddsaKeyGenCallbacks,
  createEddsaMPCv2KeyGenCallbacks,
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
  const baseCoin = await coinFactory.getCoin(req.decoded.coin, bitgo);

  if (isTss && !baseCoin.supportsTss()) {
    throw new BadRequestError(
      `MPC wallet generation is not supported for coin ${req.decoded.coin}`,
    );
  }

  const result = await baseCoin.wallets().generateWalletWithExternalSigner({
    ...req.decoded,
    type: 'advanced',
    multisigType: isTss ? 'tss' : 'onchain',
    ...(await keyGenCallbacks(req, isTss ? baseCoin.getMPCAlgorithm() : undefined)),
  });

  return { ...result, wallet: result.wallet.toJSON() };
}

/**
 * The MPC version BitGo currently wants for new wallets, read from the same server-side setting
 * BitGoJS uses (`/api/v2/tss/settings`, per enterprise and coin family), so moving to MPCv2 only
 * is a server-side change.
 */
async function walletCreationMultisigTypeVersion(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
): Promise<string | undefined> {
  const baseCoin = await coinFactory.getCoin(req.decoded.coin, req.bitgo);
  const tssSettings: TssSettings = await req.bitgo
    .get(req.bitgo.microservicesUrl('/api/v2/tss/settings'))
    .query({ enterprise: req.decoded.enterprise })
    .result();
  return tssSettings.coinSettings[baseCoin.getFamily()]?.walletCreationSettings
    ?.multiSigTypeVersion;
}

/**
 * Picks the AWM key generation callbacks the SDK should drive, based on the coin's MPC algorithm.
 * An undefined algorithm means an onchain multisig wallet.
 */
async function keyGenCallbacks(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
  algorithm: MPCAlgorithm | undefined,
): Promise<
  Pick<
    GenerateWalletWithExternalSignerOptions,
    'createKeychainCallback' | 'ecdsaMPCv2Callbacks' | 'eddsaCallbacks' | 'eddsaMPCv2Callbacks'
  >
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
      if ((await walletCreationMultisigTypeVersion(req)) === 'MPCv2') {
        return {
          eddsaMPCv2Callbacks: createEddsaMPCv2KeyGenCallbacks(awmUserClient, awmBackupClient),
        };
      }
      return { eddsaCallbacks: createEddsaKeyGenCallbacks(awmUserClient, awmBackupClient) };
    default:
      throw new BadRequestError(
        `Unsupported MPC algorithm: ${algorithm}. Supported algorithms: ecdsa, eddsa`,
      );
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
