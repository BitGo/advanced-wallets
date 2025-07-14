import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import logger from '../../../logger';
import { BaseCoin, MPCConsolidationRecoveryOptions, MPCTx, RecoveryTxRequest } from 'bitgo';
import { RecoveryTransaction } from '@bitgo/sdk-coin-trx';
import { BitGoBase } from '@bitgo/sdk-core';
import { CoinFamily } from '@bitgo/statics';
import type { Sol, SolConsolidationRecoveryOptions, Tsol } from '@bitgo/sdk-coin-sol';
import type { Trx, ConsolidationRecoveryOptions, Ttrx } from '@bitgo/sdk-coin-trx';
import type { Sui, Tsui } from '@bitgo/sdk-coin-sui';
import type { Ada, Tada } from '@bitgo/sdk-coin-ada';
import type { Dot, Tdot } from '@bitgo/sdk-coin-dot';
import type { Tao, Ttao } from '@bitgo/sdk-coin-tao';

type RecoveryConsolidationParams =
  | ConsolidationRecoveryOptions
  | SolConsolidationRecoveryOptions
  | MPCConsolidationRecoveryOptions;

type RecoveryConsolidationResult = {
  transactions?: (RecoveryTransaction | MPCTx)[];
  txRequests?: RecoveryTxRequest[];
};

export async function recoveryConsolidateWallets(
  sdk: BitGoBase,
  baseCoin: BaseCoin,
  params: RecoveryConsolidationParams,
): Promise<RecoveryConsolidationResult> {
  const family = baseCoin.getFamily();

  switch (family) {
    case CoinFamily.SOL: {
      const { register } = await import('@bitgo/sdk-coin-sol');
      register(sdk);
      const solCoin = baseCoin as unknown as Sol | Tsol;
      return await solCoin.recoverConsolidations(params as SolConsolidationRecoveryOptions);
    }
    case CoinFamily.TRX: {
      const { register } = await import('@bitgo/sdk-coin-trx');
      register(sdk);
      const trxCoin = baseCoin as unknown as Trx | Ttrx;
      return await trxCoin.recoverConsolidations(params as ConsolidationRecoveryOptions);
    }
    default: {
      const [
        { register: registerSui },
        { register: registerAda },
        { register: registerDot },
        { register: registerTao },
      ] = await Promise.all([
        import('@bitgo/sdk-coin-sui'),
        import('@bitgo/sdk-coin-ada'),
        import('@bitgo/sdk-coin-dot'),
        import('@bitgo/sdk-coin-tao'),
      ]);
      registerAda(sdk);
      registerSui(sdk);
      registerDot(sdk);
      registerTao(sdk);
      const coin = baseCoin as unknown as Sui | Tsui | Ada | Tada | Dot | Tdot | Tao | Ttao;
      return await coin.recoverConsolidations(params as MPCConsolidationRecoveryOptions);
    }
  }
}

// Handler for recovery from receive addresses (consolidation sweeps)
export async function handleRecoveryConsolidationsOnPrem(
  req: MasterApiSpecRouteRequest<'v1.wallet.recoveryConsolidations', 'post'>,
) {
  const bitgo = req.bitgo;
  const coin = req.decoded.coin;
  const enclavedExpressClient = req.enclavedExpressClient;

  const isMPC = true;

  const { commonKeychain, apiKey } = req.decoded;
  let { userPub, backupPub, bitgoPub } = req.decoded;

  if (isMPC) {
    if (!commonKeychain) {
      throw new Error('Missing required key: commonKeychain');
    }

    userPub = commonKeychain;
    backupPub = commonKeychain;
    bitgoPub = commonKeychain;
  }

  if (!userPub || !backupPub || !bitgoPub) {
    throw new Error('Missing required keys: userPub, backupPub, bitgoPub');
  }

  const sdkCoin = bitgo.coin(coin);
  let txs: (RecoveryTransaction | MPCTx | RecoveryTxRequest)[] = [];

  // Use type assertion to access recoverConsolidations
  const result = await recoveryConsolidateWallets(bitgo, sdkCoin, {
    ...req.decoded,
    userKey: !isMPC ? userPub : '',
    backupKey: !isMPC ? backupPub : '',
    bitgoKey: bitgoPub,
  });

  console.log(`Recovery consolidations result: ${JSON.stringify(result)}`);

  if (result.transactions) {
    txs = result.transactions;
  } else if (result.txRequests) {
    txs = result.txRequests;
  } else {
    throw new Error('recoverConsolidations did not return expected transactions');
  }

  logger.debug(`Found ${txs.length} unsigned consolidation transactions`);

  const signedTxs = [];
  try {
    for (const tx of txs) {
      const signedTx = isMPC
        ? await enclavedExpressClient.recoveryMPC({
            userPub,
            backupPub,
            apiKey,
            unsignedSweepPrebuildTx: tx as MPCTx | RecoveryTxRequest,
            coinSpecificParams: {},
            walletContractAddress: '',
          })
        : await enclavedExpressClient.recoveryMultisig({
            userPub,
            backupPub,
            unsignedSweepPrebuildTx: tx as RecoveryTransaction,
            walletContractAddress: '',
          });

      signedTxs.push(signedTx);
    }

    return { signedTxs };
  } catch (err) {
    logger.error('Error during consolidation recovery:', err);
    throw err;
  }
}
