import {
  RequestTracer,
  KeyIndices,
  BuildConsolidationTransactionOptions,
  MPCType,
} from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import { getWalletAndSigningKeychain, makeCustomSigningFunction } from '../handlerUtils';
import {
  createCustomCommitmentGenerator,
  createCustomRShareGenerator,
  createCustomGShareGenerator,
} from './eddsa';

export async function handleConsolidate(
  req: MasterApiSpecRouteRequest<'v1.wallet.consolidate', 'post'>,
) {
  const enclavedExpressClient = req.enclavedExpressClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const params = req.decoded;
  const walletId = req.params.walletId;
  const coin = req.params.coin;

  const { baseCoin, wallet, signingKeychain } = await getWalletAndSigningKeychain({
    bitgo,
    coin,
    walletId,
    params,
    reqId,
    KeyIndices,
  });

  // Check if the coin supports account consolidations
  if (!baseCoin.allowsAccountConsolidations()) {
    throw new Error('Invalid coin selected - account consolidations not supported');
  }

  // Validate consolidateAddresses parameter
  if (params.consolidateAddresses && !Array.isArray(params.consolidateAddresses)) {
    throw new Error('consolidateAddresses must be an array of addresses');
  }

  try {
    const consolidationParams: BuildConsolidationTransactionOptions = {
      ...params,
      reqId,
    };

    // --- TSS/MPC support ---
    if (wallet._wallet.multisigType === 'tss') {
      // Always force apiVersion to 'full' for TSS/MPC
      consolidationParams.apiVersion = 'full';

      if (baseCoin.getMPCAlgorithm() === MPCType.EDDSA) {
        consolidationParams.customCommitmentGeneratingFunction = createCustomCommitmentGenerator(
          bitgo,
          wallet,
          enclavedExpressClient,
          params.source,
          signingKeychain.commonKeychain!,
        );
        consolidationParams.customRShareGeneratingFunction = createCustomRShareGenerator(
          enclavedExpressClient,
          params.source,
          signingKeychain.commonKeychain!,
        );
        consolidationParams.customGShareGeneratingFunction = createCustomGShareGenerator(
          enclavedExpressClient,
          params.source,
          signingKeychain.commonKeychain!,
        );
      }
      else if (baseCoin.getMPCAlgorithm() === MPCType.ECDSA) {
        throw new Error('ECDSA MPC consolidations not yet implemented');
      }
    } else {
      // Non-TSS: legacy custom signing function
      consolidationParams.customSigningFunction = makeCustomSigningFunction({
        enclavedExpressClient,
        source: params.source,
        pub: signingKeychain.pub!,
      });
    }

    // Send account consolidations
    const result = await wallet.sendAccountConsolidations(consolidationParams);

    // Handle failures
    if (result.failure && result.failure.length > 0) {
      logger.debug('Consolidation result: %s', JSON.stringify(result, null, 2));
      let msg = '';
      let status = 202;

      if (result.success && result.success.length > 0) {
        // Some succeeded, some failed
        msg = `Consolidations failed: ${result.failure.length} and succeeded: ${result.success.length}`;
      } else {
        // All failed
        status = 400;
        msg = 'All consolidations failed';
      }

      const error = new Error(msg);
      (error as any).status = status;
      (error as any).result = result;
      throw error;
    }

    return result;
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to consolidate account: %s', err.message);
    throw err;
  }
}
