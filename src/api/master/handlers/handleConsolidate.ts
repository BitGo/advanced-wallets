import {
  RequestTracer,
  KeyIndices,
  BuildConsolidationTransactionOptions,
  PrebuildAndSignTransactionOptions,
  getTxRequest,
} from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import { getWalletAndSigningKeychain } from '../handlerUtils';
import { signAndSendMultisig } from './handleSendMany';
import { signAndSendTxRequests } from './transactionRequests';

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

  const isMPC = wallet._wallet.multisigType === 'tss';

  try {
    const consolidationParams: BuildConsolidationTransactionOptions = {
      ...params,
      reqId,
    };

    isMPC && (consolidationParams.apiVersion = 'full');

    const successfulTxs: any[] = [];
    const failedTxs = new Array<Error>();

    const unsignedBuilds = await wallet.buildAccountConsolidations(consolidationParams);

    logger.info(
      `Consolidation request for wallet ${walletId} with ${unsignedBuilds.length} unsigned builds`,
    );

    if (unsignedBuilds && unsignedBuilds.length > 0) {
      for (const unsignedBuild of unsignedBuilds) {
        const unsignedBuildWithOptions: PrebuildAndSignTransactionOptions = Object.assign(
          {},
          consolidationParams,
        );
        unsignedBuildWithOptions.apiVersion = consolidationParams.apiVersion;
        unsignedBuildWithOptions.prebuildTx = unsignedBuild;

        const txRequest = await getTxRequest(bitgo, wallet.id(), unsignedBuild.txRequestId!, reqId);

        try {
          const sendTx = isMPC
            ? await signAndSendTxRequests(
                bitgo,
                wallet,
                txRequest,
                enclavedExpressClient,
                signingKeychain,
                reqId,
              )
            : await signAndSendMultisig(
                wallet,
                params.source,
                unsignedBuild,
                unsignedBuildWithOptions,
                enclavedExpressClient,
                signingKeychain,
                reqId,
              );

          successfulTxs.push(sendTx);
        } catch (e) {
          console.dir(e);
          failedTxs.push(e as any);
        }
      }
    }

    // Handle failures
    if (failedTxs.length > 0) {
      let msg = '';
      let status = 202;

      if (successfulTxs.length > 0) {
        // Some succeeded, some failed
        msg = `Consolidations failed: ${failedTxs.length} and succeeded: ${successfulTxs.length}`;
      } else {
        // All failed
        status = 400;
        msg = 'All consolidations failed';
      }

      const error = new Error(msg);
      (error as any).status = status;
      (error as any).result = {
        success: successfulTxs,
        failure: failedTxs,
      };
      throw error;
    }

    return {
      success: successfulTxs,
      failure: failedTxs,
    };
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to consolidate account: %s', err.message);
    throw err;
  }
}
