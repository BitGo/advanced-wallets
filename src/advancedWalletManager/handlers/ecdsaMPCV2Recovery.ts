import { DklsDsg, DklsTypes, DklsUtils } from '@bitgo-beta/sdk-lib-mpc';
import {
  AwmApiSpecRouteRequest,
  MpcV2RecoveryResponseType,
} from '../routers/advancedWalletManagerApiSpec';
import { KmsClient } from '../kmsClient/kmsClient';
import { BaseCoin, ECDSAMethodTypes } from '@bitgo-beta/sdk-core';
import { isCosmosLikeCoin, isEcdsaCoin, isEthLikeCoin } from '../../shared/coinUtils';
import { BadRequestError, NotImplementedError } from '../../shared/errors';
import logger from '../../shared/logger';
import coinFactory from '../../shared/coinFactory';

async function getMessageHash(coin: BaseCoin, txHex: string): Promise<Buffer> {
  const txBuffer = Buffer.from(txHex, 'hex');

  if (isEthLikeCoin(coin)) {
    const { TransactionFactory } = await import('@ethereumjs/tx');
    try {
      return TransactionFactory.fromSerializedData(txBuffer).getMessageToSign(true);
    } catch (error: any) {
      logger.error('Failed to construct eth transaction from message hex', error);
      throw new BadRequestError(
        `Failed to construct eth transaction from message hex: ${error.message}`,
      );
    }
  } else if (isCosmosLikeCoin(coin)) {
    try {
      return coin.getHashFunction().update(txBuffer).digest();
    } catch (error: any) {
      logger.error('Failed to construct cosmos transaction from message hex', error);
      throw new BadRequestError(
        `Failed to construct cosmos transaction from message hex: ${error.message}`,
      );
    }
  } else {
    throw new NotImplementedError(
      `Advanced Wallet Manager does not support Mpc V2 recovery for coin family: ${coin.getFamily()}`,
    );
  }
}

export async function ecdsaMPCv2Recovery(
  req: AwmApiSpecRouteRequest<'v1.mpcv2.recovery', 'post'>,
): Promise<MpcV2RecoveryResponseType> {
  const { txHex, pub } = req.decoded;
  const bitgo = req.bitgo;
  const coin = await coinFactory.getCoin(req.params.coin, bitgo);

  if (!isEcdsaCoin(coin)) {
    throw new BadRequestError(
      `${coin.getFamily()} is not ECDSA. Use other recovery endpoints instead.`,
    );
  }

  // setup clients and retreive the keys
  // TODO: this needs to be segerated if the EBE instance cannot retrieve both keys
  const kms = new KmsClient(req.config);
  const { prv: userPrv } = await kms.getKey({ pub, source: 'user' });
  const { prv: backupPrv } = await kms.getKey({ pub, source: 'backup' });

  // construct tx builder
  const txHash = await getMessageHash(coin, txHex);

  // construct buffers
  const userPrvBuffer = Buffer.from(userPrv, 'base64');
  const backupPrvBuffer = Buffer.from(backupPrv, 'base64');

  // construct distributed signature generation sessions
  const userDsg = new DklsDsg.Dsg(userPrvBuffer, 0, 'm/0', txHash);
  const backupDsg = new DklsDsg.Dsg(backupPrvBuffer, 1, 'm/0', txHash);

  // sign the transaction
  const dklsSignature = (await DklsUtils.executeTillRound(
    5,
    userDsg,
    backupDsg,
  )) as DklsTypes.DeserializedDklsSignature;

  const signatureString = DklsUtils.verifyAndConvertDklsSignature(
    txHash,
    dklsSignature,
    pub,
    'm/0',
    undefined,
    false,
  );

  // construct signature object to be returned
  const sigParts = signatureString.split(':');
  const signature: ECDSAMethodTypes.Signature = {
    recid: parseInt(sigParts[0], 10),
    r: sigParts[1],
    s: sigParts[2],
    y: sigParts[3],
  };

  return {
    txHex,
    stringifiedSignature: JSON.stringify(signature),
  };
}
