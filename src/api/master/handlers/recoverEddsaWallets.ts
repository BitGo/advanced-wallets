import {
  BitGoBase,
  MPCRecoveryOptions,
  MPCSweepTxs,
  MPCTx,
  MPCTxs,
  BaseCoin,
} from '@bitgo-beta/sdk-core';
import { CoinFamily } from '@bitgo-beta/statics';
import type { SolRecoveryOptions } from '@bitgo-beta/sdk-coin-sol';
import type { Sol, Tsol } from '@bitgo-beta/sdk-coin-sol';
import type { Near, TNear } from '@bitgo-beta/sdk-coin-near';
import type { Sui, Tsui } from '@bitgo-beta/sdk-coin-sui';
import type { Ada, Tada } from '@bitgo-beta/sdk-coin-ada';
import type { Dot, Tdot } from '@bitgo-beta/sdk-coin-dot';

export type RecoverEddsaWalletsParams = MPCRecoveryOptions | SolRecoveryOptions;

export async function recoverEddsaWallets(
  sdk: BitGoBase,
  baseCoin: BaseCoin,
  params: RecoverEddsaWalletsParams,
): Promise<MPCTx | MPCSweepTxs | MPCTxs> {
  const family = baseCoin.getFamily();

  switch (family) {
    case CoinFamily.SOL: {
      const { register } = await import('@bitgo-beta/sdk-coin-sol');
      register(sdk);
      const solCoin = baseCoin as unknown as Sol | Tsol;
      const solParams = params as SolRecoveryOptions;
      return await solCoin.recover(solParams);
    }
    case CoinFamily.NEAR: {
      const { register } = await import('@bitgo-beta/sdk-coin-near');
      register(sdk);
      const nearCoin = baseCoin as unknown as Near | TNear;
      const nearParams: Parameters<Near['recover']>[0] = {
        userKey: params.bitgoKey,
        backupKey: params.bitgoKey,
        bitgoKey: params.bitgoKey,
        recoveryDestination: params.recoveryDestination,
        walletPassphrase: '',
      };
      return await nearCoin.recover(nearParams);
    }
    default: {
      const [{ register: registerSui }, { register: registerAda }, { register: registerDot }] =
        await Promise.all([
          import('@bitgo-beta/sdk-coin-sui'),
          import('@bitgo-beta/sdk-coin-ada'),
          import('@bitgo-beta/sdk-coin-dot'),
        ]);
      registerAda(sdk);
      registerSui(sdk);
      registerDot(sdk);
      const coin = baseCoin as unknown as Sui | Tsui | Ada | Tada | Dot | Tdot;
      return await coin.recover(params as MPCRecoveryOptions);
    }
  }
}
