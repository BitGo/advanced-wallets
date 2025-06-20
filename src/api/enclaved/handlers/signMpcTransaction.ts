import { EnclavedApiSpecRouteRequest } from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';
import { decryptDataKey, generateDataKey, retrieveKmsPrvKey } from '../utils';
import logger from '../../../logger';
import {
  TxRequest,
  EddsaUtils,
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

  // TODO: Add ECDSA share types
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

export async function signMpcTransaction(req: EnclavedApiSpecRouteRequest<'v1.mpc.sign', 'post'>) {
  const { source, pub, coin, encryptedDataKey, shareType } = req.decoded;

  if (!source || !pub) {
    throw new Error('Source and public key are required for MPC signing');
  }

  if (!shareType) {
    throw new Error('Share type is required for MPC signing');
  }

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
      throw new Error('ECDSA MPC is not supported yet');
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
      if (!txRequest) {
        throw new Error('txRequest is required for commitment share generation');
      }
      if (!bitgoGpgPubKey) {
        throw new Error('bitgoGpgPubKey is required for commitment share generation');
      }
      const dataKey = await generateDataKey({ keyType: 'RSA-2048', cfg });
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
      if (!txRequest) {
        throw new Error('txRequest is required for R share generation');
      }
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
      if (!txRequest) {
        throw new Error('txRequest is required for G share generation');
      }
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
