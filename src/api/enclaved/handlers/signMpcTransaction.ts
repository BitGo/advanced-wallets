import { EnclavedApiSpecRouteRequest } from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';
import { decryptDataKey, generateDataKey, retrieveKmsPrvKey } from '../utils';
import logger from '../../../logger';
import {
  TxRequest,
  EddsaUtils,
  EcdsaMPCv2Utils,
  CommitmentShareRecord,
  EncryptedSignerShareRecord,
  SignShare,
  SignatureShareRecord,
  GShare,
} from '@bitgo/sdk-core';
import { EnclavedConfig } from '../../../shared/types';
import { BitGoBase, BaseCoin } from 'bitgo';

// Define share types for different MPC algorithms
enum ShareType {
  // EDDSA share types
  Commitment = 'commitment',
  R = 'r',
  G = 'g',

  // ECDSA MPCv2 share types
  MPCv2Round1 = 'mpcv2round1',
  MPCv2Round2 = 'mpcv2round2',
  MPCv2Round3 = 'mpcv2round3',
}

// Define MPC algorithm types
enum MPCType {
  EDDSA = 'eddsa',
  ECDSA = 'ecdsa',
}

// Type for commitment share creation parameters
interface CommitmentShareParams {
  txRequest: TxRequest;
  prv: string;
  walletPassphrase: string;
  bitgoGpgPubKey: string;
}

// Type for R share creation parameters
interface RShareParams {
  txRequest: TxRequest;
  walletPassphrase: string;
  encryptedUserToBitgoRShare: EncryptedSignerShareRecord;
}

// Type for G share creation parameters
interface GShareParams {
  txRequest: TxRequest;
  prv: string;
  bitgoToUserRShare: SignatureShareRecord;
  userToBitgoRShare: SignShare;
  bitgoToUserCommitment: CommitmentShareRecord;
}

// Unified parameters for handleEddsaSigning
interface EddsaSigningParams {
  coin: BaseCoin;
  shareType: string;
  txRequest: TxRequest;
  prv: string;
  encryptedDataKey?: string;
  bitgoToUserRShare?: SignatureShareRecord;
  userToBitgoRShare?: SignShare;
  encryptedUserToBitgoRShare?: EncryptedSignerShareRecord;
  bitgoToUserCommitment?: CommitmentShareRecord;
  bitgoGpgPubKey?: string;
}

// Unified parameters for handleEcdsaSigning - includes all possible fields
interface EcdsaSigningParams {
  coin: BaseCoin;
  shareType: string;
  txRequest: TxRequest;
  prv: string;
  bitgoGpgPubKey?: string;
  encryptedDataKey?: string;
  encryptedUserGpgPrvKey?: string;
  encryptedRound1Session?: string;
  encryptedRound2Session?: string;
}

export async function signMpcTransaction(req: EnclavedApiSpecRouteRequest<'v1.mpc.sign', 'post'>) {
  const { source, pub, coin, encryptedDataKey, shareType } = req.decoded;

  const bitgo = req.bitgo;
  const coinInstance = bitgo.coin(coin);

  // Get private key from KMS
  const prv = await retrieveKmsPrvKey({ pub, source, cfg: req.config });

  if (!prv) {
    const errorMsg = `Error while MPC signing, missing prv key for pub=${pub}, source=${source}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  try {
    const mpcAlgorithm = coinInstance.getMPCAlgorithm?.() || MPCType.ECDSA; // Default to ECDSA if method doesn't exist

    if (mpcAlgorithm === MPCType.EDDSA) {
      return await handleEddsaSigning(req.bitgo, req.config, {
        coin: coinInstance,
        shareType,
        txRequest: req.decoded.txRequest,
        prv,
        encryptedDataKey,
        bitgoToUserRShare: req.decoded.bitgoToUserRShare,
        userToBitgoRShare: req.decoded.userToBitgoRShare,
        encryptedUserToBitgoRShare: req.decoded.encryptedUserToBitgoRShare,
        bitgoToUserCommitment: req.decoded.bitgoToUserCommitment,
        bitgoGpgPubKey: req.decoded.bitgoGpgPubKey,
      });
    } else if (mpcAlgorithm === MPCType.ECDSA) {
      return await handleEcdsaSigning(req.bitgo, req.config, {
        coin: coinInstance,
        shareType,
        txRequest: req.decoded.txRequest,
        prv,
        bitgoGpgPubKey: req.decoded.bitgoGpgPubKey,
        encryptedDataKey: req.decoded.encryptedDataKey,
        encryptedUserGpgPrvKey: req.decoded.encryptedUserGpgPrvKey,
        encryptedRound1Session: req.decoded.encryptedRound1Session,
        encryptedRound2Session: req.decoded.encryptedRound2Session,
      });
    } else {
      throw new Error(`MPC Algorithm ${mpcAlgorithm} is not supported.`);
    }
  } catch (error) {
    logger.error('Error while MPC signing wallet transaction:', error);
    throw error;
  }
}

async function handleEddsaSigning(
  bitgo: BitGoBase,
  cfg: EnclavedConfig,
  params: EddsaSigningParams,
): Promise<{
  userToBitgoCommitment?: CommitmentShareRecord;
  encryptedSignerShare?: EncryptedSignerShareRecord;
  encryptedUserToBitgoRShare?: EncryptedSignerShareRecord;
  rShare?: SignShare;
  gShare?: GShare;
  encryptedDataKey?: string;
}> {
  const {
    coin,
    shareType,
    txRequest,
    prv,
    encryptedDataKey,
    bitgoToUserRShare,
    userToBitgoRShare,
    encryptedUserToBitgoRShare,
    bitgoToUserCommitment,
    bitgoGpgPubKey,
  } = params;

  // Create EddsaUtils instance using the coin's bitgo instance
  const eddsaUtils = new EddsaUtils(bitgo, coin);

  switch (shareType.toLowerCase()) {
    case ShareType.Commitment: {
      if (!bitgoGpgPubKey) {
        throw new Error('bitgoGpgPubKey is required for commitment share generation');
      }
      const dataKey = await generateDataKey({ keyType: 'AES-256', cfg });
      const commitmentParams: CommitmentShareParams = {
        txRequest,
        prv,
        walletPassphrase: dataKey.plaintextKey,
        bitgoGpgPubKey,
      };
      return {
        ...(await eddsaUtils.createCommitmentShareFromTxRequest(commitmentParams)),
        encryptedDataKey: dataKey.encryptedKey,
      };
    }
    case ShareType.R: {
      if (!encryptedUserToBitgoRShare) {
        throw new Error('encryptedUserToBitgoRShare is required for R share generation');
      }
      if (!encryptedDataKey) {
        throw new Error(
          'encryptedDataKey from commitment share generation round is required for R share generation',
        );
      }
      const plaintextDataKey = await decryptDataKey({ encryptedDataKey, cfg });
      const rShareParams: RShareParams = {
        txRequest,
        walletPassphrase: plaintextDataKey,
        encryptedUserToBitgoRShare,
      };
      return await eddsaUtils.createRShareFromTxRequest(rShareParams);
    }
    case ShareType.G: {
      if (!bitgoToUserRShare) {
        throw new Error('bitgoToUserRShare is required for G share generation');
      }
      if (!userToBitgoRShare) {
        throw new Error('userToBitgoRShare is required for G share generation');
      }
      if (!bitgoToUserCommitment) {
        throw new Error('bitgoToUserCommitment is required for G share generation');
      }
      const gShareParams: GShareParams = {
        txRequest,
        prv,
        bitgoToUserRShare,
        userToBitgoRShare,
        bitgoToUserCommitment,
      };
      const gShare = await eddsaUtils.createGShareFromTxRequest(gShareParams);
      return { gShare };
    }
    default:
      throw new Error(
        `Share type ${shareType} not supported for EDDSA, only commitment, G and R share generation is supported.`,
      );
  }
}

async function handleEcdsaSigning(
  bitgo: BitGoBase,
  cfg: EnclavedConfig,
  params: EcdsaSigningParams,
): Promise<any> {
  const { coin, shareType } = params;

  // Check if this is an MPCv2 operation
  const isMPCv2 = [
    ShareType.MPCv2Round1.toString(),
    ShareType.MPCv2Round2.toString(),
    ShareType.MPCv2Round3.toString(),
  ].includes(shareType.toLowerCase());

  if (isMPCv2) {
    // Create EcdsaMPCv2Utils instance using the coin's bitgo instance
    const ecdsaMPCv2Utils = new EcdsaMPCv2Utils(bitgo, coin);

    switch (shareType.toLowerCase()) {
      case ShareType.MPCv2Round1: {
        const dataKey = await generateDataKey({ keyType: 'RSA-2048', cfg });
        return {
          ...(await ecdsaMPCv2Utils.createOfflineRound1Share({
            txRequest: params.txRequest,
            prv: params.prv,
            walletPassphrase: dataKey.plaintextKey,
          })),
          encryptedDataKey: dataKey.encryptedKey,
        };
      }
      case ShareType.MPCv2Round2: {
        if (!params.encryptedDataKey) {
          throw new Error('encryptedDataKey from Round 1 is required for MPCv2 Round 2');
        }
        if (!params.bitgoGpgPubKey) {
          throw new Error('bitgoGpgPubKey is required for MPCv2 Round 2');
        }
        if (!params.encryptedUserGpgPrvKey) {
          throw new Error('encryptedUserGpgPrvKey is required for MPCv2 Round 2');
        }
        if (!params.encryptedRound1Session) {
          throw new Error('encryptedRound1Session is required for MPCv2 Round 2');
        }
        const plaintextDataKey = await decryptDataKey({
          encryptedDataKey: params.encryptedDataKey,
          cfg,
        });
        return await ecdsaMPCv2Utils.createOfflineRound2Share({
          txRequest: params.txRequest,
          prv: params.prv,
          walletPassphrase: plaintextDataKey,
          bitgoPublicGpgKey: params.bitgoGpgPubKey,
          encryptedUserGpgPrvKey: params.encryptedUserGpgPrvKey,
          encryptedRound1Session: params.encryptedRound1Session,
        });
      }
      case ShareType.MPCv2Round3: {
        if (!params.encryptedDataKey) {
          throw new Error('encryptedDataKey from Round 1 is required for MPCv2 Round 3');
        }
        if (!params.bitgoGpgPubKey) {
          throw new Error('bitgoGpgPubKey is required for MPCv2 Round 3');
        }
        if (!params.encryptedUserGpgPrvKey) {
          throw new Error('encryptedUserGpgPrvKey is required for MPCv2 Round 3');
        }
        if (!params.encryptedRound2Session) {
          throw new Error('encryptedRound2Session is required for MPCv2 Round 3');
        }
        const plaintextDataKey = await decryptDataKey({
          encryptedDataKey: params.encryptedDataKey,
          cfg,
        });
        return await ecdsaMPCv2Utils.createOfflineRound3Share({
          txRequest: params.txRequest,
          prv: params.prv,
          walletPassphrase: plaintextDataKey,
          bitgoPublicGpgKey: params.bitgoGpgPubKey,
          encryptedUserGpgPrvKey: params.encryptedUserGpgPrvKey,
          encryptedRound2Session: params.encryptedRound2Session,
        });
      }
      default:
        throw new Error(
          `Share type ${shareType} not supported for MPCv2, only MPCv2Round1, MPCv2Round2 and MPCv2Round3 is supported.`,
        );
    }
  } else {
    throw new Error(`Only MPCv2 is supported for ECDSA curve.`);
  }
}
