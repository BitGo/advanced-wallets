import {
  BaseCoin,
  ConsolidateUnspentsOptions,
  KeyIndices,
  Keychain,
  ManageUnspentsOptions,
  PrebuildTransactionResult,
  RequestTracer,
  Wallet,
} from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { BadRequestError } from '../../shared/errors';
import { orThrow } from '../../shared/utils';
import { AsyncJobResponse } from '../clients/bridgeClient.types';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';
import { buildMultisigSignBody, submitMultisigSignJob } from './utils/multisigSignUtils';
import {
  getWalletAndSigningKeychain,
  makeCustomSigningFunction,
  getWalletPubs,
} from './utils/utils';

function normalizeSingleConsolidateResponse<T>(response: T | T[]): T {
  if (Array.isArray(response)) {
    if (response.length === 0 || response.length > 1) {
      throw new BadRequestError(
        response.length == 0
          ? 'Unable to build a consolidation transaction. No eligible unspents for this wallet'
          : `Expected single consolidation result, but received ${response.length} results`,
      );
    }
    return response[0];
  }
  return response;
}

async function handleConsolidateUnspentsAsync(params: {
  req: MasterApiSpecRouteRequest<'v1.wallet.consolidateunspents', 'post'>;
  coin: string;
  walletId: string;
  baseCoin: BaseCoin;
  wallet: Wallet;
  signingKeychain: Keychain;
  walletPubs: string[] | undefined;
  consolidationParams: ConsolidateUnspentsOptions;
  requestTracer: RequestTracer;
}): Promise<AsyncJobResponse> {
  const buildResponse = await params.wallet.consolidateUnspents(
    params.consolidationParams,
    ManageUnspentsOptions.BUILD_ONLY,
  );
  const txPrebuilt = normalizeSingleConsolidateResponse(
    buildResponse as PrebuildTransactionResult | PrebuildTransactionResult[],
  );

  const verified = await params.baseCoin.verifyTransaction({
    txParams: { ...params.consolidationParams },
    txPrebuild: txPrebuilt,
    wallet: params.wallet,
    verification: {},
    reqId: params.requestTracer,
    walletType: params.wallet.multisigType(),
  });
  if (!verified) {
    throw new BadRequestError('Transaction prebuild failed local validation');
  }

  const { reqId: _reqId, ...wpSubmitParams } = params.consolidationParams;

  return orThrow(
    await submitMultisigSignJob(
      params.req,
      params.coin,
      buildMultisigSignBody({
        source: params.req.decoded.source,
        signingKeychain: params.signingKeychain,
        txPrebuilt,
        walletPubs: params.walletPubs,
      }),
      {
        walletId: params.walletId,
        wpSubmitKind: 'consolidateUnspents',
        wpSubmitParams,
      },
    ),
    'async consolidateUnspents job submission failed',
  );
}

export async function handleConsolidateUnspents(
  req: MasterApiSpecRouteRequest<'v1.wallet.consolidateunspents', 'post'>,
) {
  const awmClient = req.awmUserClient;
  const requestTracer = new RequestTracer();
  const bitgo = req.bitgo;
  const params = req.decoded;
  const walletId = req.params.walletId;
  const coin = req.params.coin;

  const { baseCoin, wallet, signingKeychain } = await getWalletAndSigningKeychain({
    bitgo,
    coin,
    walletId,
    params,
    reqId: requestTracer,
    KeyIndices,
  });

  const walletPubs = await getWalletPubs({ baseCoin, wallet });

  const consolidationParams: ConsolidateUnspentsOptions = {
    ...params,
    reqId: requestTracer,
    txFormat: 'psbt-lite',
  };

  if (params.bulk && req.config.asyncModeConfig.enabled) {
    throw new BadRequestError('Async mode does not support bulk consolidateUnspents');
  }

  try {
    if (req.config.asyncModeConfig.enabled) {
      return await handleConsolidateUnspentsAsync({
        req,
        coin,
        walletId,
        baseCoin,
        wallet,
        signingKeychain,
        walletPubs,
        consolidationParams,
        requestTracer,
      });
    }

    const customSigningFunction = makeCustomSigningFunction({
      awmClient,
      source: params.source,
      pub: signingKeychain.pub!,
      walletPubs,
    });

    return normalizeSingleConsolidateResponse(
      await wallet.consolidateUnspents({
        ...consolidationParams,
        customSigningFunction,
      }),
    );
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to consolidate unspents: %s', err.message);
    throw err;
  }
}
