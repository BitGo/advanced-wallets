import {
  AddKeychainOptions,
  Keychain,
  KeychainsTriplet,
  NotImplementedError,
  promiseProps,
  RequestTracer,
  SupplementGenerateWalletOptions,
  Wallet,
  WalletWithKeychains,
  BaseCoin,
} from '@bitgo/sdk-core';
import { BitGoBase as BitGo } from '@bitgo/sdk-core';
import _ from 'lodash';
import { MasterApiSpecRouteRequest } from '../routers/masterApiSpec';
import { KeyShareType } from '../../../enclavedBitgoExpress/routers/enclavedApiSpec';
import debug from 'debug';
import { EnclavedExpressClient } from '../clients/enclavedExpressClient';

const debugLogger = debug('bitgo:masterBitGoExpress:generateWallet');

/**
 * Base parameters for wallet generation
 */
interface GenerateWalletBaseParams {
  bitgo: BitGo;
  baseCoin: BaseCoin;
  enclavedExpressClient: EnclavedExpressClient;
  label: string;
  enterprise?: string;
  coin: string;
  isDistributedCustody?: boolean;
}

type GenerateOnPremOnChainWalletParams = GenerateWalletBaseParams;

type GenerateOnPremMpcWalletParams = GenerateWalletBaseParams;

/**
 * Common interface for wallet generation keychains
 */
interface WalletGenerationKeychains {
  userKeychain: Keychain;
  backupKeychain: Keychain;
  bitgoKeychain: Keychain;
}

/**
 * The result type for wallet generation, with the wallet property as JSON
 */
type WalletResult = Omit<WalletWithKeychains, 'wallet'> & {
  wallet: ReturnType<Wallet['toJSON']>;
};

/**
 * Creates base wallet parameters with common configuration
 * @param label - The label for the wallet
 * @param enterprise - Optional enterprise ID
 * @param multisigType - The type of multisig wallet ('onchain' or 'tss')
 */
function createBaseWalletParams(
  label: string,
  enterprise?: string,
  multisigType: 'onchain' | 'tss' = 'onchain',
): SupplementGenerateWalletOptions {
  const walletParams: SupplementGenerateWalletOptions = {
    label,
    m: 2,
    n: 3,
    keys: [],
    type: 'cold' as const,
    subType: 'onPrem' as SupplementGenerateWalletOptions['subType'],
    multisigType,
    enterprise: undefined,
  };

  if (!_.isUndefined(enterprise)) {
    if (!_.isString(enterprise)) {
      throw new Error('invalid enterprise argument, expecting string');
    }
    walletParams.enterprise = enterprise;
  }

  return walletParams;
}

/**
 * Creates an independent keychain with the given parameters
 * @param enclavedExpressClient - The client for enclaved express operations
 * @param baseCoin - The base coin instance
 * @param params - Parameters for keychain creation
 */
async function createIndependentKeychain(
  enclavedExpressClient: EnclavedExpressClient,
  baseCoin: BaseCoin,
  params: {
    source: 'user' | 'backup';
    coin: string;
    reqId: RequestTracer;
  },
): Promise<Keychain> {
  const keychain = await enclavedExpressClient.createIndependentKeychain({
    source: params.source,
    coin: params.coin,
    type: 'independent',
  });

  const keychainParams: AddKeychainOptions = {
    pub: keychain.pub,
    keyType: keychain.type,
    source: keychain.source,
    reqId: params.reqId,
  };

  const newKeychain = await baseCoin.keychains().add(keychainParams);
  return _.extend({}, newKeychain, keychain);
}

/**
 * Handles the generation of an on-premise on-chain wallet
 * @param params - Parameters for wallet generation
 */
export async function handleGenerateOnPremOnChainWallet(params: GenerateOnPremOnChainWalletParams) {
  const { bitgo, baseCoin, enclavedExpressClient, label, enterprise } = params;
  const reqId = new RequestTracer();

  const walletParams = createBaseWalletParams(label, enterprise);

  const { userKeychain, backupKeychain, bitgoKeychain }: KeychainsTriplet = await promiseProps({
    userKeychain: createIndependentKeychain(enclavedExpressClient, baseCoin, {
      source: 'user',
      coin: params.coin,
      reqId,
    }),
    backupKeychain: createIndependentKeychain(enclavedExpressClient, baseCoin, {
      source: 'backup',
      coin: params.coin,
      reqId,
    }),
    bitgoKeychain: baseCoin.keychains().createBitGo({
      enterprise: params.enterprise,
      keyType: 'independent',
      reqId,
      isDistributedCustody: params.isDistributedCustody,
    }),
  });

  walletParams.keys = [userKeychain.id, backupKeychain.id, bitgoKeychain.id];

  const keychains = {
    userKeychain,
    backupKeychain,
    bitgoKeychain,
  };

  return createWalletResult(bitgo, baseCoin, reqId, walletParams, keychains, {
    userKeychain,
    backupKeychain,
    bitgoKeychain,
  });
}

/**
 * Handles the generation of an on-premise MPC wallet
 * @param params - Parameters for wallet generation
 */
export async function handleGenerateOnPremMpcWallet(params: GenerateOnPremMpcWalletParams) {
  const { bitgo, baseCoin, enclavedExpressClient, label, enterprise, coin } = params;

  if (!baseCoin.supportsTss()) {
    throw new NotImplementedError(`MPC wallet generation is not supported for coin ${coin}`);
  }

  if (!enclavedExpressClient) {
    throw new Error('Enclaved express client is required for MPC wallet generation');
  }

  const reqId = new RequestTracer();

  const walletParams = createBaseWalletParams(label, enterprise, 'tss');

  const constants = await bitgo.fetchConstants();
  if (!constants.mpc || !constants.mpc.bitgoPublicKey) {
    throw new Error('Unable to create MPC keys - bitgoPublicKey is missing from constants');
  }

  // Initialize key generation for user and backup
  const userInitResponse = await enclavedExpressClient.initMpcKeyGeneration({
    source: 'user',
    bitgoGpgKey: constants.mpc.bitgoPublicKey,
  });

  debugLogger('User MPC key generation initialized:', userInitResponse);

  const backupInitResponse = await enclavedExpressClient.initMpcKeyGeneration({
    source: 'backup',
    bitgoGpgKey: constants.mpc.bitgoPublicKey,
    userGpgKey: userInitResponse.bitgoPayload.gpgKey,
  });
  if (!backupInitResponse.counterPartyKeyShare) {
    throw new Error('User key share is missing from initialization response');
  }

  debugLogger('Backup MPC key generation initialized:', backupInitResponse);

  // Extract GPG keys based on payload type
  const userGPGKey =
    userInitResponse.bitgoPayload.from === 'user'
      ? userInitResponse.bitgoPayload.gpgKey
      : undefined;

  const backupGPGKey =
    backupInitResponse.bitgoPayload.from === 'backup'
      ? backupInitResponse.bitgoPayload.gpgKey
      : undefined;

  if (!userGPGKey || !backupGPGKey) {
    throw new Error('Missing required GPG keys from payloads');
  }

  // Create BitGo keychain using the initialization responses
  const bitgoKeychain = await baseCoin.keychains().add({
    keyType: 'tss',
    source: 'bitgo',
    keyShares: [userInitResponse.bitgoPayload, backupInitResponse.bitgoPayload],
    enterprise: params.enterprise,
    userGPGPublicKey: userGPGKey,
    backupGPGPublicKey: backupGPGKey,
    reqId,
  });

  // Finalize user and backup keychains
  const userKeychainPromise = await enclavedExpressClient.finalizeMpcKeyGeneration({
    source: 'user',
    coin: params.coin,
    encryptedDataKey: userInitResponse.encryptedDataKey,
    encryptedData: userInitResponse.encryptedData,
    bitGoKeychain: {
      ...bitgoKeychain,
      commonKeychain: bitgoKeychain.commonKeychain ?? '',
      hsmType: bitgoKeychain.hsmType,
      type: 'tss',
      source: 'bitgo', // Ensure BitGo keychain is marked as BitGo
      verifiedVssProof: true,
      isBitGo: true, // Ensure BitGo keychain is marked as BitGo
      isTrust: false,
      keyShares: bitgoKeychain.keyShares as KeyShareType[], // Ensure keyShares are included
    },
    counterPartyGPGKey: backupGPGKey,
    counterPartyKeyShare: backupInitResponse.counterPartyKeyShare,
  });
  if (!userKeychainPromise.counterpartyKeyShare) {
    throw new Error('Backup key share is missing from user keychain promise');
  }

  const userMpcKey = await baseCoin.keychains().add({
    commonKeychain: userKeychainPromise.commonKeychain,
    source: 'user',
    type: 'tss',
  });

  debugLogger('User key finalized', userMpcKey);

  const backupKeychainPromise = await enclavedExpressClient.finalizeMpcKeyGeneration({
    source: 'backup',
    coin: params.coin,
    encryptedDataKey: backupInitResponse.encryptedDataKey,
    encryptedData: backupInitResponse.encryptedData,
    bitGoKeychain: {
      ...bitgoKeychain,
      commonKeychain: bitgoKeychain.commonKeychain ?? '',
      hsmType: bitgoKeychain.hsmType,
      type: 'tss',
      source: 'bitgo',
      verifiedVssProof: true,
      isBitGo: true,
      isTrust: false,
      keyShares: bitgoKeychain.keyShares as any, // Ensure keyShares are included
    },
    counterPartyGPGKey: userGPGKey,
    counterPartyKeyShare: userKeychainPromise.counterpartyKeyShare as KeyShareType, // also not sure why I have to cast this here
  });

  const backupMpcKey = await baseCoin.keychains().add({
    commonKeychain: backupKeychainPromise.commonKeychain,
    source: 'backup',
    type: 'tss',
  });
  debugLogger('Backup keychain finalized:', backupMpcKey);

  walletParams.keys = [userMpcKey.id, backupMpcKey.id, bitgoKeychain.id];

  const keychains = {
    userKeychain: userMpcKey,
    backupKeychain: backupMpcKey,
    bitgoKeychain,
  };

  return createWalletResult(bitgo, baseCoin, reqId, walletParams, keychains, {
    userKeychain: userMpcKey,
    backupKeychain: backupMpcKey,
    bitgoKeychain,
  });
}

/**
 * Main handler for generating an on-premise wallet
 * This is the only function that directly uses the request object
 */
export async function handleGenerateWalletOnPrem(
  req: MasterApiSpecRouteRequest<'v1.wallet.generate', 'post'>,
) {
  const { multisigType } = req.decoded;
  const bitgo = req.bitgo;
  const baseCoin = bitgo.coin(req.params.coin);
  const enclavedExpressClient = req.enclavedExpressClient;

  if (!enclavedExpressClient) {
    throw new Error('Enclaved express client is required for wallet generation');
  }

  const baseParams: GenerateWalletBaseParams = {
    bitgo,
    baseCoin,
    enclavedExpressClient,
    label: req.decoded.label,
    enterprise: req.decoded.enterprise,
    coin: req.params.coin,
    isDistributedCustody: req.decoded.isDistributedCustody,
  };

  if (multisigType === 'tss') {
    return handleGenerateOnPremMpcWallet(baseParams);
  }

  return handleGenerateOnPremOnChainWallet(baseParams);
}

/**
 * Creates the final wallet result with common formatting
 */
async function createWalletResult(
  bitgo: BitGo,
  baseCoin: BaseCoin,
  reqId: RequestTracer,
  walletParams: SupplementGenerateWalletOptions,
  keychains: WalletGenerationKeychains,
  resultKeychains: WalletGenerationKeychains,
): Promise<WalletResult> {
  const finalWalletParams = await baseCoin.supplementGenerateWallet(walletParams, keychains);

  bitgo.setRequestTracer(reqId);
  const newWallet = await bitgo.post(baseCoin.url('/wallet/add')).send(finalWalletParams).result();
  const wallet = new Wallet(bitgo, baseCoin, newWallet);

  return {
    wallet: wallet.toJSON(),
    userKeychain: resultKeychains.userKeychain,
    backupKeychain: resultKeychains.backupKeychain,
    bitgoKeychain: resultKeychains.bitgoKeychain,
    responseType: 'WalletWithKeychains',
  };
}
