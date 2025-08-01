import { BitGoAPI } from '@bitgo-beta/sdk-api';
import {
  BaseCoin,
  BaseTransactionBuilder,
  Eddsa,
  EDDSAMethods,
  EDDSAMethodTypes,
  PublicKey,
} from '@bitgo-beta/sdk-core';
import { Ed25519Bip32HdTree } from '@bitgo-beta/sdk-lib-mpc';
import { CoinFamily, coins } from '@bitgo-beta/statics';
import { type KeyPair as SolKeyPair } from '@bitgo-beta/sdk-coin-sol';
import { checkRecoveryMode, retrieveKmsPrvKey } from '../utils';
import { AdvancedWalletManagerConfig } from '../../../shared/types';
import logger from '../../../logger';

async function setupTransactionBuilder(
  sdk: BitGoAPI,
  coinFamily: CoinFamily,
  signableHex: string,
  accountId: string,
): Promise<{ txBuilder: BaseTransactionBuilder; publicKey: string }> {
  let modules;
  switch (coinFamily) {
    case CoinFamily.NEAR:
      modules = await import('@bitgo-beta/sdk-coin-near');
      break;
    case CoinFamily.DOT:
      modules = await import('@bitgo-beta/sdk-coin-dot');
      break;
    case CoinFamily.SUI:
      modules = await import('@bitgo-beta/sdk-coin-sui');
      break;
    case CoinFamily.ADA:
      modules = await import('@bitgo-beta/sdk-coin-ada');
      break;
    case CoinFamily.SOL:
      modules = await import('@bitgo-beta/sdk-coin-sol');
      break;
    default:
      throw new Error(`Unsupported coin family: ${coinFamily}`);
  }

  const { TransactionBuilderFactory, register, KeyPair } = modules;
  register(sdk);

  const staticCoin = coins.get(coinFamily);
  try {
    const keyPair = new KeyPair({ pub: accountId });

    let txBuilder;
    let publicKey: string;
    if (coinFamily === CoinFamily.SOL) {
      txBuilder = new TransactionBuilderFactory(staticCoin).from(signableHex);
      // For Solana, we need to use the getAddress method to derive the public key
      publicKey = (keyPair as SolKeyPair).getAddress();
    } else {
      txBuilder = new TransactionBuilderFactory(staticCoin).from(
        Buffer.from(signableHex, 'hex').toString('base64'),
      );
      publicKey = keyPair.getKeys().pub;
    }

    return { txBuilder, publicKey };
  } catch (error) {
    logger.error(error);
    throw error;
  }
}

export type SignEddsaRecoveryTransactionParams = {
  sdk: BitGoAPI;
  request: {
    commonKeychain: string;
    signableHex: string;
    derivationPath: string;
  };
  cfg: AdvancedWalletManagerConfig;
  coin: BaseCoin;
};

export async function signEddsaRecoveryTransaction({
  sdk,
  cfg,
  request,
  coin,
}: SignEddsaRecoveryTransactionParams) {
  let publicKey = '';
  logger.info(`Received request ${JSON.stringify(request)}`);

  checkRecoveryMode(cfg);

  const hdTree = await Ed25519Bip32HdTree.initialize();
  const MPC = await Eddsa.initialize(hdTree);

  const accountId = MPC.deriveUnhardened(request.commonKeychain, request.derivationPath).slice(
    0,
    64,
  );

  const { txBuilder, publicKey: derivedKey } = await setupTransactionBuilder(
    sdk,
    coin.getFamily() as CoinFamily,
    request.signableHex,
    accountId,
  );

  publicKey = derivedKey;
  // Get user and backup private keys
  const userPrv = await retrieveKmsPrvKey({
    pub: request.commonKeychain.toString(),
    source: 'user',
    cfg,
    options: { useLocalEncipherment: false },
  });

  const backupPrv = await retrieveKmsPrvKey({
    pub: request.commonKeychain.toString(),
    source: 'backup',
    cfg,
    options: { useLocalEncipherment: false },
  });

  if (!userPrv || !backupPrv) {
    throw new Error('Missing required private keys for recovery');
  }

  const userSigningMaterial = JSON.parse(userPrv) as EDDSAMethodTypes.UserSigningMaterial;
  const backupSigningMaterial = JSON.parse(backupPrv) as EDDSAMethodTypes.BackupSigningMaterial;

  try {
    const signatureHex = await EDDSAMethods.getTSSSignature(
      userSigningMaterial,
      backupSigningMaterial,
      request.derivationPath,
      await txBuilder.build(),
    );

    const publicKeyObj = { pub: publicKey };
    txBuilder.addSignature(publicKeyObj as PublicKey, signatureHex);
    const signedTx = await txBuilder.build();
    const serializedTx = signedTx.toBroadcastFormat();

    return {
      txHex: serializedTx,
    };
  } catch (error) {
    throw error;
  }
}
