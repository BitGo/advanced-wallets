import {
  RequestTracer,
  PrebuildTransactionOptions,
  Memo,
  KeyIndices,
  SendManyOptions,
  Keychain,
} from '@bitgo-beta/sdk-core';
import logger from '../../shared/logger';
import { MasterApiSpecRouteRequest } from '../routers/masterBitGoExpressApiSpec';
import { createEcdsaMPCv2CustomSigners } from './ecdsa';
import { AdvancedWalletManagerClient } from '../clients/advancedWalletManagerClient';
import { createEddsaCustomSigningFunctions } from './eddsa';
import { BadRequestError, NotFoundError } from '../../shared/errors';
import coinFactory from '../../shared/coinFactory';
import { getWalletPubs } from './utils/utils';
import { isUtxoCoin } from '../../shared/coinUtils';
import { buildMultisigSignBody, submitMultisigSignJob } from './utils/multisigSignUtils';
import { submitSignedMultisigToWp } from './utils/multisigSubmitUtils';

/**
 * Defines the structure for a single recipient in a send-many transaction.
 * This provides strong typing and autocompletion within the handler.
 */
interface Recipient {
  address: string;
  amount: string | number;
  feeLimit?: string;
  data?: string;
  tokenName?: string;
  tokenData?: any;
}

/**
 * Creates TSS send parameters for ECDSA MPCv2 signing with custom functions
 */
async function createMPCSendParamsWithCustomSigningFns(
  req: MasterApiSpecRouteRequest<'v1.wallet.sendMany', 'post'>,
  awmClient: AdvancedWalletManagerClient,
  signingKeychain: Keychain,
): Promise<SendManyOptions> {
  const coin = await coinFactory.getCoin(req.params.coin, req.bitgo);
  const source = signingKeychain.source as 'user' | 'backup';
  const commonKeychain = signingKeychain.commonKeychain;
  const mpcAlgorithm = coin.getMPCAlgorithm();

  if (!commonKeychain) {
    throw new BadRequestError('Common keychain is required for MPC signing');
  }

  if (mpcAlgorithm === 'ecdsa') {
    const { customMPCv2Round1Generator, customMPCv2Round2Generator, customMPCv2Round3Generator } =
      createEcdsaMPCv2CustomSigners(awmClient, source, commonKeychain);

    return {
      ...(req.decoded as SendManyOptions),
      customMPCv2SigningRound1GenerationFunction: customMPCv2Round1Generator,
      customMPCv2SigningRound2GenerationFunction: customMPCv2Round2Generator,
      customMPCv2SigningRound3GenerationFunction: customMPCv2Round3Generator,
    };
  } else if (mpcAlgorithm === 'eddsa') {
    const { customCommitmentGenerator, customRShareGenerator, customGShareGenerator } =
      createEddsaCustomSigningFunctions(awmClient, source, commonKeychain);

    return {
      ...(req.decoded as SendManyOptions),
      customCommitmentGeneratingFunction: customCommitmentGenerator,
      customRShareGeneratingFunction: customRShareGenerator,
      customGShareGeneratingFunction: customGShareGenerator,
    };
  }

  throw new BadRequestError(`Unsupported MPC algorithm: ${mpcAlgorithm}`);
}

export async function handleSendMany(req: MasterApiSpecRouteRequest<'v1.wallet.sendMany', 'post'>) {
  const awmClient = req.awmUserClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const baseCoin = await coinFactory.getCoin(req.params.coin, bitgo);

  const params = req.decoded;
  params.recipients = params.recipients as Recipient[];

  const walletId = req.params.walletId;
  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });
  if (!wallet) {
    throw new NotFoundError(`Wallet ${walletId} not found`);
  }

  if (
    wallet.type() !== 'advanced' &&
    !(wallet.type() === 'cold' && wallet.subType() === 'onPrem')
  ) {
    throw new NotFoundError('Wallet is not an advanced wallet');
  }

  const keyIdIndex = params.source === 'user' ? KeyIndices.USER : KeyIndices.BACKUP;

  // Get the signing keychains
  const signingKeychain = await baseCoin.keychains().get({
    id: wallet.keyIds()[keyIdIndex],
  });

  if (!signingKeychain) {
    throw new NotFoundError(`Signing keychain for ${params.source} not found`);
  }
  const isTss = wallet.multisigType() === 'tss';

  if (isTss && req.config.asyncModeConfig.enabled) {
    throw new BadRequestError('Async mode is not yet supported for TSS sendMany');
  }

  if (isTss) {
    if (!params.commonKeychain) {
      throw new BadRequestError(`commonKeychain must be provided for TSS ${params.source} signing`);
    }
    if (signingKeychain.commonKeychain !== params.commonKeychain) {
      throw new BadRequestError(
        `Common keychain provided does not match the keychain on wallet for ${params.source}`,
      );
    }
  } else {
    if (!params.pubkey) {
      throw new BadRequestError(`pubkey must be provided for multisig ${params.source} signing`);
    }
    if (signingKeychain.pub !== params.pubkey) {
      throw new BadRequestError(
        `Pub provided does not match the keychain on wallet for ${params.source}`,
      );
    }
  }

  try {
    // Create MPC send parameters with custom signing functions
    if (isTss) {
      if (signingKeychain.source === 'backup') {
        throw new BadRequestError('Backup MPC signing not supported for sendMany');
      }
      // TSS wallets require type to be set; default to 'transfer' if not provided
      if (!params.type) {
        params.type = 'transfer';
      }
      const mpcSendParams = await createMPCSendParamsWithCustomSigningFns(
        req,
        awmClient,
        signingKeychain,
      );
      return wallet.sendMany(mpcSendParams);
    }

    /** Multisig */

    const prebuildParams: PrebuildTransactionOptions = {
      ...params,
      // Convert memo string to Memo object if present
      memo: params.memo ? ({ type: 'text', value: params.memo } as Memo) : undefined,
      ...(isUtxoCoin(baseCoin) && { txFormat: 'psbt-lite' }),
    };

    // First build the transaction with bitgo
    const txPrebuilt = await wallet.prebuildTransaction({
      ...prebuildParams,
      reqId,
    });

    // verify transaction prebuild
    try {
      const verified = await baseCoin.verifyTransaction({
        txParams: { ...prebuildParams },
        txPrebuild: txPrebuilt,
        wallet,
        verification: {},
        reqId: reqId,
        walletType: wallet.multisigType(),
      });
      if (!verified) {
        throw new BadRequestError('Transaction prebuild failed local validation');
      }
      logger.debug('Transaction prebuild verified');
    } catch (e) {
      const err = e as Error;
      logger.error('transaction prebuild failed local validation:', err.message);
      logger.error('transaction prebuild:', JSON.stringify(txPrebuilt, null, 2));
      throw new BadRequestError(`Transaction prebuild failed local validation: ${err.message}`);
    }

    const walletPubs = await getWalletPubs({ baseCoin, wallet });

    const signBody = buildMultisigSignBody({
      source: req.decoded.source,
      signingKeychain,
      txPrebuilt,
      walletPubs,
    });

    /** When run in async mode, submit the job via the bridge client. Fall back to sync-mode, otherwise */
    const asyncResult = await submitMultisigSignJob(req, req.params.coin, signBody, {
      walletId: req.params.walletId,
      wpSubmitKind: 'sendMany',
      wpSubmitParams: prebuildParams,
    });
    if (asyncResult) {
      return asyncResult;
    }

    logger.info(`Signing with ${req.decoded.source} keychain, pub: ${signBody.pub}`);
    logger.debug(`Signing keychain: ${JSON.stringify(signingKeychain, null, 2)}`);

    const signedTx = await awmClient.signMultisig(signBody);
    return submitSignedMultisigToWp(wallet, signedTx, prebuildParams, reqId);
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to send many: %s', err.message);
    throw err;
  }
}
