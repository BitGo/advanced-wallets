import { BaseCoin, MPCRecoveryOptions, MPCSweepTxs, MPCTx, MPCTxs } from 'bitgo';
import { BitGoBase } from '@bitgo/sdk-core';
import { CoinFamily } from '@bitgo/statics';
import type { SolRecoveryOptions } from '@bitgo/sdk-coin-sol';
import type { Sol, Tsol } from '@bitgo/sdk-coin-sol';
import type { Near, TNear } from '@bitgo/sdk-coin-near';
import type { Sui, Tsui } from '@bitgo/sdk-coin-sui';
import type { Ada, Tada } from '@bitgo/sdk-coin-ada';
import type { Dot, Tdot } from '@bitgo/sdk-coin-dot';

export type RecoverEddsaWalletsParams = MPCRecoveryOptions | SolRecoveryOptions;

export async function recoverEddsaWallets(
  sdk: BitGoBase,
  baseCoin: BaseCoin,
  params: RecoverEddsaWalletsParams,
): Promise<MPCTx | MPCSweepTxs | MPCTxs> {
  const family = baseCoin.getFamily();

  switch (family) {
    case CoinFamily.SOL: {
      const { register } = await import('@bitgo/sdk-coin-sol');
      register(sdk);
      const solCoin = baseCoin as unknown as Sol | Tsol;
      const solParams = params as SolRecoveryOptions;
      return await solCoin.recover(solParams);
    }
    case CoinFamily.NEAR: {
      const { register } = await import('@bitgo/sdk-coin-near');
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
          import('@bitgo/sdk-coin-sui'),
          import('@bitgo/sdk-coin-ada'),
          import('@bitgo/sdk-coin-dot'),
        ]);
      registerAda(sdk);
      registerSui(sdk);
      registerDot(sdk);
      const coin = baseCoin as unknown as Sui | Tsui | Ada | Tada | Dot | Tdot;
      return await coin.recover(params as MPCRecoveryOptions);
    }
  }
}
