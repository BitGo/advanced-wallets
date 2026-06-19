import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { Wallet } from '@bitgo-beta/sdk-core';
import { E2EConfig } from './config';

/**
 * Build a BitGoAPI client pointed at WP testnet and register the coin module.
 *
 * Construction mirrors the async job worker (`workers/asyncJobWorker.ts`).
 * Only btc/tbtc is registered today; add modules here as scenarios cover
 * more coins.
 */
export async function getBitGo(cfg: E2EConfig): Promise<BitGoAPI> {
  if (!cfg.accessToken) {
    throw new Error('getBitGo: accessToken is required (set BITGO_ACCESS_TOKEN)');
  }
  const bitgo = new BitGoAPI({ env: cfg.bitgoEnv, accessToken: cfg.accessToken });

  const { register } = await import('@bitgo-beta/sdk-coin-btc');
  register(bitgo);

  return bitgo;
}

/** Fetch a wallet from WP (throws if it does not exist). */
export async function getWallet(
  bitgo: BitGoAPI,
  cfg: E2EConfig,
  walletId: string,
): Promise<Wallet> {
  return bitgo.coin(cfg.coin).wallets().get({ id: walletId });
}

/** Resolve the public keys of a wallet's keychains, in keyId order (user, backup, bitgo). */
export async function getWalletKeychainPubs(
  bitgo: BitGoAPI,
  cfg: E2EConfig,
  wallet: Wallet,
): Promise<string[]> {
  const coin = bitgo.coin(cfg.coin);
  const keychains = await Promise.all(wallet.keyIds().map((id) => coin.keychains().get({ id })));
  return keychains.map((keychain) => keychain.pub ?? '');
}

/** The subset of a WP transfer the scenarios assert on. */
export interface TransferSummary {
  id: string;
  txid: string;
  state: string;
}

/** Look up a transfer by txid to confirm a transaction landed on testnet. */
export async function getTransfer(
  bitgo: BitGoAPI,
  cfg: E2EConfig,
  walletId: string,
  txid: string,
): Promise<TransferSummary> {
  const wallet = await getWallet(bitgo, cfg, walletId);
  // SDK types getTransfer() as Promise<any>; narrow to the fields we read.
  return wallet.getTransfer({ id: txid });
}
