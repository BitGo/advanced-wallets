import { BaseCoin, BitGoBase, Ecdsa } from '@bitgo-beta/sdk-core';
import { AdvancedWalletManagerClient } from '../clients/advancedWalletManagerClient';
import { isCosmosLikeCoin, isEthLikeCoin } from '../../../shared/coinUtils';
import { ValidationError } from '../../../shared/errors';

import type {
  RecoveryOptions as CosmosLikeRecoverOptions,
  CosmosTransactionBuilder,
} from '@bitgo-beta/abstract-cosmos';
import type { RecoverOptions as EthLikeRecoverOptions } from '@bitgo-beta/abstract-eth';
import { isMPCSweepTxs } from '../../../shared/transactionUtils';

export type recoverEcdsaMpcV2Params = {
  // Import new types if needed
  commonKeychain: string;
  ethLikeParams?: EthLikeRecoverOptions;
  cosmosLikeParams?: CosmosLikeRecoverOptions;
};

export async function recoverEcdsaMPCv2Wallets(
  bitgo: BitGoBase,
  baseCoin: BaseCoin,
  advancedWalletManagerClient: AdvancedWalletManagerClient,
  params: recoverEcdsaMpcV2Params,
): Promise<{ txHex: string }> {
  // get unsigned recovery transaction using the base coin's recover method
  let unsignedTx: { signableHex?: string };
  let userKey: string;

  if (isEthLikeCoin(baseCoin)) {
    // create eth-like unsigned recovery
    if (!params.ethLikeParams) {
      throw new Error('Eth like recovery params are required for Ecdsa MPCv2 recovery');
    }
    const recoveryResponse = await baseCoin.recover(params.ethLikeParams);

    // Sanity check: Eth like coins should return a single transaction
    if (!isMPCSweepTxs(recoveryResponse)) {
      throw new Error('Created eth-like recovery tx is not in MPC Sweep format');
    }

    unsignedTx = recoveryResponse.txRequests[0].transactions[0].unsignedTx;
    userKey = params.ethLikeParams.userKey;
  } else if (isCosmosLikeCoin(baseCoin)) {
    // create cosmos-like unsigned recovery
    if (!params.cosmosLikeParams) {
      throw new Error('Cosmos like recovery params are required for Ecdsa MPCv2 recovery');
    }
    const { BigNumber } = await import('bignumber.js');

    const MPC = new Ecdsa();
    const publicKey = MPC.deriveUnhardened(params.commonKeychain, 'm/0').slice(0, 66);
    const senderAddress = baseCoin.getAddressFromPublicKey(publicKey);

    const chainId = await baseCoin['getChainId']();

    const [accountNumber, sequenceNo] = await baseCoin['getAccountDetails'](senderAddress);
    const balance = new BigNumber(await baseCoin['getAccountBalance'](senderAddress));
    const gasBudget = {
      amount: [
        { denom: baseCoin.getDenomination(), amount: baseCoin.getGasAmountDetails().gasAmount },
      ],
      gasLimit: baseCoin.getGasAmountDetails().gasLimit,
    };
    const gasAmount = new BigNumber(gasBudget.amount[0].amount);
    const actualBalance = balance.minus(gasAmount);

    if (actualBalance.isLessThanOrEqualTo(0)) {
      throw new Error('Did not have enough funds to recover');
    }

    const amount = [
      {
        denom: baseCoin.getDenomination(),
        amount: actualBalance.toFixed(),
      },
    ];
    const sendMessage = [
      {
        fromAddress: senderAddress,
        toAddress: params.cosmosLikeParams.recoveryDestination,
        amount: amount,
      },
    ];

    const txnBuilder = baseCoin.getBuilder().getTransferBuilder();
    txnBuilder
      .messages(sendMessage)
      .gasBudget(gasBudget)
      .sequence(Number(sequenceNo))
      .accountNumber(Number(accountNumber))
      .chainId(chainId)
      .publicKey(publicKey);

    unsignedTx = {
      signableHex: (await txnBuilder.build()).signablePayload.toString('hex'),
    };
    userKey = params.commonKeychain;
  } else {
    throw new ValidationError(
      `Unsupported coin family for Ecdsa MPCv2 recovery: ${baseCoin.getFamily()}`,
    );
  }

  if (!unsignedTx.signableHex) {
    throw new Error('Failed to create unsigned transaction for Ecdsa MPCv2 recovery');
  }

  // sent to AWM for signing
  const awmResponse = await advancedWalletManagerClient.recoverEcdsaMpcV2Wallet({
    txHex: unsignedTx.signableHex,
    pub: userKey,
  });
  const signature = JSON.parse(awmResponse.stringifiedSignature);

  // Sanity check: returned signature should be in the form of ECDSAMethodTypes.Signature
  if (!signature || signature.recid === undefined || !signature.r || !signature.s || !signature.y) {
    throw new Error('Invalid signature returned from Advanced Wallet Manager for Ecdsa recovery');
  }

  // post processing of the response
  if (isEthLikeCoin(baseCoin)) {
    const { AbstractEthLikeNewCoins } = await import('@bitgo-beta/abstract-eth');
    const { TransactionFactory } = await import('@ethereumjs/tx');

    const unsignedTxFull = TransactionFactory.fromSerializedData(
      Buffer.from(unsignedTx.signableHex, 'hex'),
    );

    const ethCommon = AbstractEthLikeNewCoins.getCustomChainCommon(
      params.ethLikeParams?.replayProtectionOptions?.chain as number,
    );
    ethCommon.setHardfork(params.ethLikeParams?.replayProtectionOptions?.hardfork as string);

    const signedTx = await baseCoin['getSignedTxFromSignature'](
      ethCommon,
      unsignedTxFull,
      signature,
    );

    return { txHex: '0x' + signedTx.serialize().toString('hex') };
  } else if (isCosmosLikeCoin(baseCoin)) {
    const MPC = new Ecdsa();
    MPC.verify(Buffer.from(unsignedTx.signableHex, 'hex'), signature, baseCoin.getHashFunction());

    const publicKey = MPC.deriveUnhardened(params.commonKeychain, 'm/0').slice(0, 66);
    const cosmosKeyPair = baseCoin.getKeyPair(publicKey);

    const txnBuilder: CosmosTransactionBuilder = baseCoin.getBuilder().from(unsignedTx.signableHex);
    txnBuilder.addSignature(
      { pub: cosmosKeyPair.getKeys().pub },
      Buffer.from(signature.r + signature.s, 'hex'),
    );
    const signedTransaction = await txnBuilder.build();
    return { txHex: signedTransaction.toBroadcastFormat() };
  }

  throw new Error(`This error should be unreachable.`);
}
