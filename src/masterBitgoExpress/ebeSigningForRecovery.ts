/**
 * body params that we need and you need to check if signing support:
 * - intent?: 'recover-half-sign' | 'recover-full-sign' | undefined
 * - coin: string
 * - txData: transaction data, not sure about the type yet
 */

// For intent === undefined I added that for retrocompatibility as we need a way
// to know if the tx was half/full signed but at the same time that doesn't matter for other signings
// I suppose

import { AbstractEthLikeNewCoins, SignTransactionOptions } from '@bitgo/abstract-eth';
import { HalfSignedTransaction } from '@bitgo/sdk-core';

async function signRecovery(req: Request) {
  //TODO: @alex move this block inside EBE on your sign method, remove the function signRecovery part
  const coin = req.body.coin;

  // I added some checks in order to ensure that we're using an eth based coin
  if (coin.isEVM()) {
    const intent = req.body.intent;
    const ethCoin = coin as unknown as AbstractEthLikeNewCoins;
    const txData = req.body.params;

    if (!intent) {
      // TODO: normal signing, not recovery
    } else {
      switch (intent) {
        case 'recover-half-sign':
          const userPrv = ''; // TODO: fetch it from KMS, already decrypted. source="user" userKeyMaterial in txData.key

          try {
            const halfSignedTx = (await ethCoin.signTransaction({
              txPrebuild: {
                ...txData,
                gasPrice: String(txData.gasPrice),
                gasLimit: String(txData.gasLimit),
              },
              prv: userPrv,
              ...txData,
            })) as HalfSignedTransaction;

            return halfSignedTx;
          } catch (error) {
            console.log(error);
            throw new Error(`Failed to half-sign transaction`);
          }
        case 'recover-full-sign':
          const backupPrv = ''; // TODO: fetch it from KMS, already decrypted. source="backup" backupKeyMaterial in txData.key

          try {
            const fullSignTxParams = {
              txPrebuild: {
                ...txData,
                halfSigned: txData,
                txHex: (txData.halfSigned as any).signatures,
              },
              ...txData.halfSigned,
              signingKeyNonce: (txData.halfSigned as any).backupKeyNonce,
              walletContractAddress: req.body.rootAddress,
              prv: backupPrv,
              isLastSignature: true,
            } as unknown as SignTransactionOptions;

            const fullSignedTx = await ethCoin.signTransaction(fullSignTxParams);
            return fullSignedTx;
          } catch (error) {
            console.log(error);
            throw new Error(`Failed to full-sign transaction`);
          }
      }
    }
  } else {
    throw new Error(`Unsupported coin type for recovery: ${coin}`);
  }
}
