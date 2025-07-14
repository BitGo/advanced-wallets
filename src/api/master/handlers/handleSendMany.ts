import {
  RequestTracer,
  PrebuildTransactionOptions,
  Memo,
  KeyIndices,
  Wallet,
  SendManyOptions,
  PrebuildTransactionResult,
  Keychain,
} from '@bitgo/sdk-core';
import logger from '../../../logger';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import { createEcdsaMPCv2CustomSigners } from './ecdsaMPCv2';
import { EnclavedExpressClient } from '../clients/enclavedExpressClient';
import { createEddsaCustomSigningFunctions } from './eddsa';

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
function createMPCSendParamsWithCustomSigningFns(
  req: MasterApiSpecRouteRequest<'v1.wallet.sendMany', 'post'>,
  enclavedExpressClient: EnclavedExpressClient,
  signingKeychain: Keychain,
): SendManyOptions {
  const coin = req.bitgo.coin(req.params.coin);
  const source = signingKeychain.source as 'user' | 'backup';
  const commonKeychain = signingKeychain.commonKeychain;
  const mpcAlgorithm = coin.getMPCAlgorithm();

  if (!commonKeychain) {
    throw new Error('Common keychain is required for MPC signing');
  }

  if (mpcAlgorithm === 'ecdsa') {
    const { customMPCv2Round1Generator, customMPCv2Round2Generator, customMPCv2Round3Generator } =
      createEcdsaMPCv2CustomSigners(enclavedExpressClient, source, commonKeychain);

    return {
      ...(req.decoded as SendManyOptions),
      customMPCv2SigningRound1GenerationFunction: customMPCv2Round1Generator,
      customMPCv2SigningRound2GenerationFunction: customMPCv2Round2Generator,
      customMPCv2SigningRound3GenerationFunction: customMPCv2Round3Generator,
    };
  } else if (mpcAlgorithm === 'eddsa') {
    const { customCommitmentGenerator, customRShareGenerator, customGShareGenerator } =
      createEddsaCustomSigningFunctions(enclavedExpressClient, source, commonKeychain);

    return {
      ...(req.decoded as SendManyOptions),
      customCommitmentGeneratingFunction: customCommitmentGenerator,
      customRShareGeneratingFunction: customRShareGenerator,
      customGShareGeneratingFunction: customGShareGenerator,
    };
  }

  throw new Error(`Unsupported MPC algorithm: ${mpcAlgorithm}`);
}

export async function handleSendMany(req: MasterApiSpecRouteRequest<'v1.wallet.sendMany', 'post'>) {
  const enclavedExpressClient = req.enclavedExpressClient;
  const reqId = new RequestTracer();
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);

  const params = req.decoded;
  params.recipients = params.recipients as Recipient[];

  const walletId = req.params.walletId;
  const wallet = await baseCoin.wallets().get({ id: walletId, reqId });
  if (!wallet) {
    throw new Error(`Wallet ${walletId} not found`);
  }

  if (wallet.type() !== 'cold' || wallet.subType() !== 'onPrem') {
    throw new Error('Wallet is not an on-prem wallet');
  }

  const keyIdIndex = params.source === 'user' ? KeyIndices.USER : KeyIndices.BACKUP;
  logger.info(`Key ID index: ${keyIdIndex}`);
  logger.info(`Key IDs: ${JSON.stringify(wallet.keyIds(), null, 2)}`);

  // Get the signing keychains
  const signingKeychain = await baseCoin.keychains().get({
    id: wallet.keyIds()[keyIdIndex],
  });

  if (!signingKeychain) {
    throw new Error(`Signing keychain for ${params.source} not found`);
  }
  if (params.pubkey && signingKeychain.pub !== params.pubkey) {
    throw new Error(`Pub provided does not match the keychain on wallet for ${params.source}`);
  }
  if (params.commonKeychain && signingKeychain.commonKeychain !== params.commonKeychain) {
    throw new Error(
      `Common keychain provided does not match the keychain on wallet for ${params.source}`,
    );
  }

  try {
    // Create MPC send parameters with custom signing functions
    if (wallet.multisigType() === 'tss') {
      if (signingKeychain.source === 'backup') {
        throw new Error('Backup MPC signing not supported for sendMany');
      }
      const mpcSendParams = createMPCSendParamsWithCustomSigningFns(
        req,
        enclavedExpressClient,
        signingKeychain,
      );
      return wallet.sendMany(mpcSendParams);
    }

    /** Multisig */

    const prebuildParams: PrebuildTransactionOptions = {
      ...params,
      // Convert memo string to Memo object if present
      memo: params.memo ? ({ type: 'text', value: params.memo } as Memo) : undefined,
    };

    // First build the transaction with bitgo
    const txPrebuilt = await wallet.prebuildTransaction({
      ...prebuildParams,
      reqId,
    });

    logger.debug('Tx prebuild: %s', JSON.stringify(txPrebuilt, null, 2));

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
        throw new Error('Transaction prebuild failed local validation');
      }
      logger.debug('Transaction prebuild verified');
    } catch (e) {
      const err = e as Error;
      logger.error('transaction prebuild failed local validation:', err.message);
      logger.error('transaction prebuild:', JSON.stringify(txPrebuilt, null, 2));
      throw new Error(`Transaction prebuild failed local validation: ${err.message}`);
    }

    logger.debug('Tx prebuild: %s', JSON.stringify(txPrebuilt, null, 2));

    return signAndSendMultisig(
      wallet,
      req.decoded.source,
      txPrebuilt,
      prebuildParams,
      enclavedExpressClient,
      signingKeychain,
      reqId,
    );
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to send many: %s', err.message);
    throw err;
  }
}

export async function signAndSendMultisig(
  wallet: Wallet,
  source: 'user' | 'backup',
  txPrebuilt: PrebuildTransactionResult,
  params: SendManyOptions,
  enclavedExpressClient: EnclavedExpressClient,
  signingKeychain: Keychain,
  reqId: RequestTracer,
) {
  if (!signingKeychain.pub) {
    throw new Error(`Signing keychain pub not found for ${source}`);
  }
  logger.info(`Signing with ${source} keychain, pub: ${signingKeychain.pub}`);
  logger.debug(`Signing keychain: ${JSON.stringify(signingKeychain, null, 2)}`);

  // Then sign it using the enclaved express client
  const signedTx = await enclavedExpressClient.signMultisig({
    txPrebuild: txPrebuilt,
    source: source,
    pub: signingKeychain.pub,
  });

  // Get extra prebuild parameters
  const extraParams = await wallet.baseCoin.getExtraPrebuildParams({
    ...params,
    wallet,
  });

  // Combine the signed transaction with extra parameters
  const finalTxParams = { ...signedTx, ...extraParams };

  // Submit the half signed transaction
  const result = (await wallet.submitTransaction(finalTxParams, reqId)) as any;
  return result;
}
