import { createHash } from 'crypto';
import { DklsDsg, DklsTypes, DklsUtils } from '@bitgo-beta/sdk-lib-mpc';
import {
  AwmApiSpecRouteRequest,
  MpcV2RecoveryResponseType,
} from '../routers/advancedWalletManagerApiSpec';
import { BaseCoin, ECDSAMethodTypes } from '@bitgo-beta/sdk-core';
import { isCosmosLikeCoin, isEcdsaCoin, isEthLikeCoin } from '../../shared/coinUtils';
import { TlsMode } from '../../shared/types';
import { BadRequestError, ForbiddenError, NotImplementedError } from '../../shared/errors';
import logger from '../../shared/logger';
import coinFactory from '../../shared/coinFactory';
import { buildBackupKmsConfig, checkRecoveryMode, retrieveKeyProviderPrvKey } from './utils/utils';

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
  checkRecoveryMode(req.config);

  // The general AWM client allowlist does not grant permission to combine both shares.
  const clientCert = (req as typeof req & { clientCert?: { fingerprint256?: string } }).clientCert;
  const fingerprint = clientCert?.fingerprint256?.replace(/:/g, '').toUpperCase();
  if (
    req.config.tlsMode !== TlsMode.MTLS ||
    !fingerprint ||
    !req.config.mpcv2RecoveryAllowedClientFingerprints?.includes(fingerprint)
  ) {
    throw new ForbiddenError('Client is not authorized for MPCv2 recovery');
  }

  const { txHex, pub } = req.decoded;
  if (!/^(?:[0-9a-f]{2})+$/i.test(txHex)) {
    throw new BadRequestError('Recovery transaction must be non-empty hex bytes');
  }
  const txHexSha256 = createHash('sha256').update(Buffer.from(txHex, 'hex')).digest('hex');
  if (
    !req.config.mpcv2RecoveryApprovals?.some(
      (approval) =>
        approval.coin === req.params.coin &&
        approval.pub.toLowerCase() === pub.toLowerCase() &&
        approval.txHexSha256.toLowerCase() === txHexSha256,
    )
  ) {
    throw new ForbiddenError('Wallet and transaction are not approved for MPCv2 recovery');
  }
  const bitgo = req.bitgo;
  const coin = await coinFactory.getCoin(req.params.coin, bitgo);

  if (!isEcdsaCoin(coin)) {
    throw new BadRequestError(
      `${coin.getFamily()} is not ECDSA. Use other recovery endpoints instead.`,
    );
  }

  const txHash = await getMessageHash(coin, txHex);

  // setup clients and retrieve the keys
  const backupCfg = buildBackupKmsConfig(req.config);
  const userPrv = await retrieveKeyProviderPrvKey({ pub, source: 'user', cfg: req.config });
  const backupPrv = await retrieveKeyProviderPrvKey({ pub, source: 'backup', cfg: backupCfg });

  // construct buffers
  const userPrvBuffer = Buffer.from(userPrv, 'base64');
  const backupPrvBuffer = Buffer.from(backupPrv, 'base64');
  if (
    DklsTypes.getCommonKeychain(userPrvBuffer).toLowerCase() !== pub.toLowerCase() ||
    DklsTypes.getCommonKeychain(backupPrvBuffer).toLowerCase() !== pub.toLowerCase()
  ) {
    throw new BadRequestError('Recovery key shares do not match the approved wallet');
  }

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
