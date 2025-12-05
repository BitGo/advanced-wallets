import { httpRequest, HttpResponse, httpRoute, optional } from '@api-ts/io-ts-http';

import * as t from 'io-ts';
import { ErrorResponses } from '../../shared/errors';

const WalletType = t.intersection([
  t.type({
    /**
     * Wallet ID
     * @example "59cd72485007a239fb00282ed480da1f"
     * @pattern ^[0-9a-f]{32}$
     */
    id: t.string,
    /**
     * Ids of users with access to the wallet
     */
    users: t.array(
      t.type({
        user: t.string,
        permissions: t.array(t.string),
      }),
    ),
    /**
     * Name of the blockchain the wallet is on
     * @example "tbtc4"
     */
    coin: t.string,
    /**
     * Name the user assigned to the wallet
     * @example "My TBTC4 Wallet"
     */
    label: t.string,
    /**
     * Number of signatures required for the wallet to send
     * @example 2
     */
    m: t.number,
    /**
     * Number of signers on the wallet
     * @example 3
     */
    n: t.number,
    /**
     * Ids of wallet keys
     * @example ["59cd72485007a239fb00282ed480da1f"]
     */
    keys: t.array(t.string),
    /**
     * Signatures for the backup and BitGo public keys signed by the user key
     */
    keySignatures: t.record(t.string, t.unknown),
    enterprise: t.string,
    organization: t.string,
    bitgoOrg: t.string,
    /**
     * Tags set on the wallet
     * @example ["59cd72485007a239fb00282ed480da1f"]
     */
    tags: t.array(t.string),
    /**
     * Flag for disabling wallet transaction notifications
     * @example false
     */
    disableTransactionNotifications: t.boolean,
    /**
     * Freeze state (used to stop the wallet from spending)
     * @example {}
     */
    freeze: t.record(t.string, t.unknown),
    /**
     * Flag which indicates the wallet has been deleted
     * @example false
     */
    deleted: t.boolean,
    /**
     * Number of admin approvals required for an action to fire
     * @example 1
     */
    approvalsRequired: t.number,
    /**
     * Flag for identifying cold wallets
     * @example false
     */
    isCold: t.boolean,
    /**
     * Coin-specific data
     */
    coinSpecific: t.record(t.string, t.unknown),
    /**
     * Admin data (wallet policies)
     * @example {}
     */
    admin: t.record(t.string, t.unknown),
    /**
     * Flag for allowing signing with backup key
     * @example false
     */
    allowBackupKeySigning: t.boolean,
    clientFlags: t.array(t.string),
    /**
     * Flag indicating whether this wallet's user key is recoverable with the passphrase held by the user.
     */
    recoverable: t.boolean,
    /**
     * Time when this wallet was created
     */
    startDate: t.string,
    /**
     * Flag indicating that this wallet is large (more than 100,000 addresses). If this is set, some APIs may omit
     * properties which are expensive to calculate for wallets with many addresses (for example, the total address
     * counts returned by the List Addresses API).
     */
    hasLargeNumberOfAddresses: t.boolean,
    /**
     * Custom configuration options for this wallet
     */
    config: t.record(t.string, t.unknown),
    /**
     * Wallet balance as string
     * @example "0"
     */
    balanceString: t.string,
    /**
     * Confirmed wallet balance as string
     * @example "0"
     */
    confirmedBalanceString: t.string,
    /**
     * Spendable wallet balance as string
     * @example "0"
     */
    spendableBalanceString: t.string,
    receiveAddress: t.type({
      id: t.string,
      address: t.string,
      chain: t.number,
      index: t.number,
      coin: t.string,
      wallet: t.string,
      coinSpecific: t.record(t.string, t.unknown),
    }),
  }),
  t.partial({
    /**
     * Wallet balance as number
     * @example 0
     */
    balance: t.number,
    rbfBalance: t.number,
    rbfBalanceString: t.string,
    reservedBalanceString: t.string,
    lockedBalanceString: t.string,
    stakedBalanceString: t.string,
    unspentCount: t.number,
    pendingChainInitialization: t.boolean,
    pendingEcdsaTssInitialization: t.boolean,
    pendingApprovals: t.array(t.record(t.string, t.unknown)),
    multisigType: t.string,
    multisigTypeVersion: t.string,
    type: t.string,
    subType: t.string,
    creator: t.string,
    walletFullyCreated: t.boolean,
  }),
]);

const UserKeychainType = t.intersection([
  t.type({
    /**
     * Keychain ID
     * @example "59cd72485007a239fb00282ed480da1f"
     * @pattern ^[0-9a-f]{32}$
     */
    id: t.string,
    /**
     * Party that created the key
     * @example "user"
     */
    source: t.string,
    /**
     * Keychain type (e.g. "independent" for onchain, "tss" for MPC)
     */
    type: t.string,
  }),
  t.partial({
    /**
     * Public part of a key pair (onchain wallets)
     * @example "xpub661MyMwAqRbcGMVhmc7wqQRYMtcX9LAvSj1pjB213y5TsrkV2uuzJjWnjBrT1FUeNWGPjaVm5p7o6jdNcQJrV1cy3a1R8NQ9m7LuYKA8RpH"
     */
    pub: t.string,
    /**
     * Ethereum address corresponding to this keychain (onchain wallets)
     * @example "0xf5b7cca8621691f9dde304cb7128b6bb3d409363"
     */
    ethAddress: t.string,
    /**
     * Asset ticker for this keychain (onchain wallets)
     */
    coin: t.string,
    /**
     * Common keychain string (TSS wallets)
     */
    commonKeychain: t.string,
  }),
]);

const BitgoKeychainType = t.intersection([
  t.type({
    /**
     * Keychain ID
     * @example "59cd72485007a239fb00282ed480da1f"
     * @pattern ^[0-9a-f]{32}$
     */
    id: t.string,
    /**
     * Party that created the key
     * @example "bitgo"
     */
    source: t.string,
    /**
     * Keychain type (e.g. "independent" for onchain, "tss" for MPC)
     */
    type: t.string,
    /**
     * Flag for identifying keychain as created by BitGo
     * @example true
     */
    isBitGo: t.boolean,
    /**
     * Flag for identifying keychain as trust keychain
     * @example false
     */
    isTrust: t.boolean,
    /**
     * HSM type used for the BitGo key
     * @example "institutional"
     */
    hsmType: t.string,
  }),
  t.partial({
    /**
     * Public part of a key pair (onchain wallets)
     */
    pub: t.string,
    /**
     * Ethereum address corresponding to this keychain (onchain wallets)
     */
    ethAddress: t.string,
    /**
     * Common keychain string (TSS wallets)
     */
    commonKeychain: t.string,
    /**
     * Whether VSS proof was verified (TSS wallets)
     */
    verifiedVssProof: t.union([t.boolean, t.string]),
    /**
     * TSS key share metadata (TSS wallets)
     */
    keyShares: t.array(t.record(t.string, t.unknown)),
    /**
     * Wallet HSM GPG public key signatures (TSS wallets)
     */
    walletHSMGPGPublicKeySigs: t.string,
  }),
]);

const GenerateWalletResponse: HttpResponse = {
  200: t.type({
    wallet: WalletType,
    userKeychain: UserKeychainType,
    backupKeychain: UserKeychainType,
    bitgoKeychain: BitgoKeychainType,
    responseType: t.string,
  }),
  ...ErrorResponses,
};

const GenerateWalletRequest = {
  /**
   * A human-readable label for the wallet
   * This will be displayed in the BitGo dashboard and API responses
   * @example "My Wallet"
   */
  label: t.string,

  /**
   * The type of multisig wallet to create
   * - onchain: Traditional multisig wallets using on-chain scripts
   * - tss: Threshold Signature Scheme wallets using MPC protocols
   * If absent, BitGo uses the default wallet type for the asset
   * @example "tss"
   */
  multisigType: t.union([t.literal('onchain'), t.literal('tss')]),

  /**
   * Enterprise ID - Required for Ethereum wallets
   * Ethereum wallets can only be created under an enterprise
   * Each enterprise has a fee address which will be used to pay for transaction fees
   * Your enterprise ID can be seen by clicking on the "Manage Organization" link on the enterprise dropdown
   * @example "59cd72485007a239fb00282ed480da1f"
   * @pattern ^[0-9a-f]{32}$
   */
  enterprise: t.string,

  /**
   * Flag for disabling wallet transaction notifications
   * When true, BitGo will not send email/SMS notifications for wallet transactions
   * @example false
   */
  disableTransactionNotifications: optional(t.boolean),

  /**
   * True, if the wallet type is a distributed-custodial
   * If passed, you must also pass the 'enterprise' parameter
   * Distributed custody allows multiple parties to share control of the wallet
   * @example false
   */
  isDistributedCustody: optional(t.boolean),

  /**
   * Specify the wallet creation contract version used when creating an Ethereum wallet contract
   * - 0: Old wallet creation (legacy)
   * - 1: New wallet creation, only deployed upon receiving funds
   * - 2: Same functionality as v1 but with NFT support
   * - 3: MPC wallets
   * @example 1
   * @minimum 0
   * @maximum 3
   */
  walletVersion: optional(t.number),
};

/**
 * Generates a new advanced wallet.
 * The wallet creation process involves several steps that happen automatically:
 * 1. User Keychain Creation: Creates the user keychain in the advanced wallet manager and encrypts it with the respective KMS.
 * 2. Backup Keychain Creation: Creates the backup keychain in the advanced wallet manager and encrypts it with the respective KMS.
 * 3. Keychain Upload: Uploads the user/backup public keys to BitGo.
 * 4. BitGo Key Creation: Creates the BitGo key on the BitGo service.
 * 5. Wallet Creation: Creates the wallet on BitGo with the 3 keys.
 */
export const WalletGenerateRoute = httpRoute({
  method: 'POST',
  path: '/api/v1/{coin}/advancedwallet/generate',
  request: httpRequest({
    params: { coin: t.string },
    body: GenerateWalletRequest,
  }),
  response: GenerateWalletResponse,
  description: 'Generate a new wallet',
});
