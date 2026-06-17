import {
  AccelerateTransactionOptions,
  BaseCoin,
  Keychain,
  PrebuildTransactionOptions,
  RequestTracer,
  KeyIndices,
  Wallet,
} from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';
import {
  getWalletAndSigningKeychain,
  makeCustomSigningFunction,
  getWalletPubs,
} from './utils/utils';
import { isUtxoCoin } from '../../shared/coinUtils';
import { BadRequestError } from '../../shared/errors';
import { AsyncJobResponse } from '../clients/bridgeClient.types';
import { buildMultisigSignBody, submitMultisigSignJob } from './utils/multisigSignUtils';
import { orThrow } from '../../shared/utils';

async function handleAccelerateAsync(params: {
  req: MasterApiSpecRouteRequest<'v1.wallet.accelerate', 'post'>;
  coin: string;
  walletId: string;
  baseCoin: BaseCoin;
  wallet: Wallet;
  signingKeychain: Keychain;
  walletPubs: string[] | undefined;
  accelerationParams: PrebuildTransactionOptions;
  requestTracer: RequestTracer;
}): Promise<AsyncJobResponse> {
  const txPrebuilt = await params.wallet.prebuildTransaction(params.accelerationParams);

  const verified = await params.baseCoin.verifyTransaction({
    txParams: { ...params.accelerationParams },
    txPrebuild: txPrebuilt,
    wallet: params.wallet,
    verification: {},
    reqId: params.requestTracer,
    walletType: params.wallet.multisigType(),
  });
  if (!verified) {
    throw new BadRequestError('Transaction prebuild failed local validation');
  }

  const { reqId: _reqId, ...wpSubmitParams } = params.accelerationParams;

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
        wpSubmitKind: 'accelerate',
        wpSubmitParams,
      },
    ),
    'async accelerate job submission failed',
  );
}

export async function handleAccelerate(
  req: MasterApiSpecRouteRequest<'v1.wallet.accelerate', 'post'>,
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

  const isTss = wallet.multisigType() === 'tss';
  if (isTss && req.config.asyncModeConfig.enabled) {
    throw new BadRequestError('Async mode is not yet supported for TSS accelerate');
  }

  const walletPubs = await getWalletPubs({ baseCoin, wallet });

  const accelerationParams = {
    ...params,
    /**
     * SDK validateAccelerationParams requires recipients to be [] when present (CPFP/RBF builds from tx ids, not recipients).
     */
    recipients: [] as AccelerateTransactionOptions['recipients'],
    reqId: requestTracer,
    ...(isUtxoCoin(baseCoin) && { txFormat: 'psbt-lite' }),
  } satisfies PrebuildTransactionOptions;

  try {
    if (req.config.asyncModeConfig.enabled) {
      return await handleAccelerateAsync({
        req,
        coin,
        walletId,
        baseCoin,
        wallet,
        signingKeychain,
        walletPubs,
        accelerationParams,
        requestTracer,
      });
    }

    const customSigningFunction = makeCustomSigningFunction({
      awmClient,
      source: params.source,
      pub: signingKeychain.pub!,
      walletPubs,
    });

    return wallet.accelerateTransaction({
      ...accelerationParams,
      customSigningFunction,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to accelerate transaction: %s', err.message);
    throw err;
  }
}
