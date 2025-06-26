import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import logger from '../../../logger';
import { isSolCoin } from '../../../shared/coinUtils';
import { MPCTx } from 'bitgo';
import { RecoveryTransaction } from '@bitgo/sdk-coin-trx';

// Handler for recovery from receive addresses (consolidation sweeps)
export async function handleRecoveryConsolidationsOnPrem(
  req: MasterApiSpecRouteRequest<'v1.wallet.recoveryConsolidations', 'post'>,
) {
  const bitgo = req.bitgo;
  const coin = req.decoded.coin;
  const enclavedExpressClient = req.enclavedExpressClient;

  const { userPub, backupPub, bitgoKey } = req.decoded;

  const sdkCoin = bitgo.coin(coin);
  let txs: MPCTx[] | RecoveryTransaction[] = [];
  // 1. Build unsigned consolidations
  if (isSolCoin(sdkCoin) && !req.decoded.durableNonces) {
    throw new Error('durableNonces is required for Solana consolidation recovery');
  }

  if (typeof (sdkCoin as any).recoverConsolidations !== 'function') {
    throw new Error(`recoverConsolidations is not supported for coin: ${coin}`);
  }

  // Use type assertion to access recoverConsolidations
  const result = await (sdkCoin as any).recoverConsolidations({
    ...req.decoded,
    userKey: userPub,
    backupKey: backupPub,
    bitgoKey,
    durableNonces: req.decoded.durableNonces,
  });

  if ('transactions' in result) {
    txs = result.transactions;
  } else if ('txRequests' in result) {
    txs = result.txRequests;
  } else {
    throw new Error('recoverConsolidations did not return expected transactions');
  }

  logger.debug(`Found ${txs.length} unsigned consolidation transactions`);

  // 2. For each unsigned sweep, get it signed by EBE (using recoveryMultisig)
  const signedTxs = [];
  try {
    for (const tx of txs) {
      const signedTx = await enclavedExpressClient.recoveryMultisig({
        userPub,
        backupPub,
        unsignedSweepPrebuildTx: tx,
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
