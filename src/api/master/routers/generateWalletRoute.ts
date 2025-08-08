import { httpRequest, HttpResponse, httpRoute, optional } from '@api-ts/io-ts-http';

import * as t from 'io-ts';
import { ErrorResponses } from '../../../shared/errors';

const GenerateWalletResponse: HttpResponse = {
  200: t.type({
    /**
     * The generated wallet object containing all wallet + key details
     */
    wallet: t.type({
      /**
       * The wallet ID
       * @example "59cd72485007a239fb00282ed480da1f"
       * @pattern ^[0-9a-f]{32}$
       */
      id: t.string,
      /**
       * Array of users with access to the wallet
       */
      users: t.array(
        t.type({
          user: t.string,
          permissions: t.array(t.string),
        }),
      ),
      /**
       * Name of the blockchain the wallet is on
       * @example "hteth"
       */
      coin: t.string,
      /**
       * Name the user assigned to the wallet
       * @example "My HTETH Wallet"
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
       * IDs of wallet keys
       * @example ["59cd72485007a239fb00282ed480da1f"]
       */
      keys: t.array(t.string),
      /**
       * Signatures for the backup and BitGo public keys signed by the user key
       */
      keySignatures: t.record(t.string, t.unknown),
      /**
       * Enterprise ID
       * @example "5cb64a0cdc5cdf8a03710c459a71bbdf"
       */
      enterprise: t.string,
      /**
       * Organization ID
       * @example "68261931fe63ee08ea45f9b98c2f261c"
       */
      organization: t.string,
      /**
       * BitGo organization name
       * @example "BitGo Trust"
       */
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
       * @example true
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
       * Pending approvals on the wallet
       * @example []
       */
      pendingApprovals: t.array(t.record(t.string, t.unknown)),
      /**
       * Flag for allowing signing with backup key
       * @example false
       */
      allowBackupKeySigning: t.boolean,
      /**
       * Client flags
       * @example []
       */
      clientFlags: t.array(t.string),
      /**
       * Flag indicating whether this wallet's user key is recoverable with the passphrase held by the user
       * @example false
       */
      recoverable: t.boolean,
      /**
       * Time when this wallet was created
       * @example "2025-07-25T00:15:10.000Z"
       */
      startDate: t.string,
      /**
       * Flag indicating that this wallet is large (more than 100,000 addresses)
       * @example false
       */
      hasLargeNumberOfAddresses: t.boolean,
      /**
       * Custom configuration options for this wallet
       * @example {}
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
      /**
       * Receive address object
       */
      receiveAddress: t.type({
        /**
         * Address ID
         * @example "6882cc8fa445ccab362fb207129bb1f5"
         */
        id: t.string,
        /**
         * The wallet address
         * @example "0x260d242181897030903e7a75dcddacc56071a65f"
         */
        address: t.string,
        /**
         * Chain index
         * @example 0
         */
        chain: t.number,
        /**
         * Address index
         * @example 0
         */
        index: t.number,
        /**
         * Coin name
         * @example "hteth"
         */
        coin: t.string,
        /**
         * Wallet ID
         * @example "6882cc8ea445ccab362fb195a1fac0c6"
         */
        wallet: t.string,
        /**
         * Coin-specific address data
         */
        coinSpecific: t.record(t.string, t.unknown),
      }),
    }),

    /**
     * User keychain object
     */
    userKeychain: t.type({
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
       * Keychain type
       * @example "tss"
       */
      type: t.string,
      /**
       * Common keychain for TSS wallets
       * @example "030e9b92ea093b2c77cf6a509bd63bf93d9b4e8c01843d8efb1475227e6327d8e3f59d13139d51b71916cfe4552d8a7fb4c595778165fc45971f660f0fc59c758c"
       */
      commonKeychain: t.string,
    }),

    /**
     * Backup keychain object
     */
    backupKeychain: t.type({
      /**
       * Keychain ID
       * @example "59cd72485007a239fb00282ed480da1f"
       * @pattern ^[0-9a-f]{32}$
       */
      id: t.string,
      /**
       * Party that created the key
       * @example "backup"
       */
      source: t.string,
      /**
       * Keychain type
       * @example "tss"
       */
      type: t.string,
      /**
       * Common keychain for TSS wallets
       * @example "030e9b92ea093b2c77cf6a509bd63bf93d9b4e8c01843d8efb1475227e6327d8e3f59d13139d51b71916cfe4552d8a7fb4c595778165fc45971f660f0fc59c758c"
       */
      commonKeychain: t.string,
    }),

    /**
     * BitGo keychain object
     */
    bitgoKeychain: t.type({
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
       * Keychain type
       * @example "tss"
       */
      type: t.string,
      /**
       * Common keychain for TSS wallets
       * @example "030e9b92ea093b2c77cf6a509bd63bf93d9b4e8c01843d8efb1475227e6327d8e3f59d13139d51b71916cfe4552d8a7fb4c595778165fc45971f660f0fc59c758c"
       */
      commonKeychain: t.string,
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
       * HSM type
       * @example "institutional"
       */
      hsmType: t.string,
    }),
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
 * Generates a new onPrem self-managed cold wallet.
 * The wallet creation process involves several steps that happen automatically:
 * 1. User Keychain Creation: Creates the user keychain in the advanced wallet manager and encrypts it with the respective KMS.
 * 2. Backup Keychain Creation: Creates the backup keychain in the advanced wallet manager and encrypts it with the respective KMS.
 * 3. Keychain Upload: Uploads the user/backup public keys to BitGo.
 * 4. BitGo Key Creation: Creates the BitGo key on the BitGo service.
 * 5. Wallet Creation: Creates the wallet on BitGo with the 3 keys.
 */
export const WalletGenerateRoute = httpRoute({
  method: 'POST',
  path: '/api/{coin}/wallet/generate',
  request: httpRequest({
    params: { coin: t.string },
    body: GenerateWalletRequest,
  }),
  response: GenerateWalletResponse,
  description: 'Generate a new wallet',
});
