# Things to finish up before merge

1. refactor out the signing to EBE

- For Alex: work on updating the signing route to account for recovery transactions
- For Max: refactor MBE to call the signing route once updated
  - Let's pull this method out of the ovc <https://github.com/BitGo/offline-vault-console/blob/7f850cdd10c89ceb850c69759349b9e0bbfb56db/frontend/src/pkg/bitgo/transaction-utils.ts#L595> so we can reuse it in MBE
  - <https://github.com/BitGo/wallet-recovery-wizard/blob/bc3957e253a17702e8e62be2e6bfd7e539692227/electron/main/index.ts#L374> is the reference for how WRW builds the recoverTx
- There's nothing special about half signing

```javascript
      const halfSignedTx = (await ethCoin.signTransaction({
        txPrebuild: {
          ...recoverTx,
          gasPrice: String(recoverTx.gasPrice),
          gasLimit: String(recoverTx.gasLimit),
        },
        prv: bitgo.decrypt({ password: passphrase, input: userEncryptedPrv }),
        ...recoverTx,
      })) as HalfSignedTransaction;
```

- Typing the actual recovery tx to sign maybe tedious, so maybe consider passing the recoverTx as a Stringifyed JSON object?
  b. The backup key signing is a more confusing

```javascript
 const fullSignTxParams = {
        txPrebuild: {
          ...halfSignedTx.halfSigned,
          halfSigned: halfSignedTx.halfSigned,
          txHex: (halfSignedTx.halfSigned as any).signatures,
        },
        ...halfSignedTx.halfSigned,
        signingKeyNonce: (halfSignedTx.halfSigned as any).backupKeyNonce,
        walletContractAddress: req.body.rootAddress,
        prv: bitgo.decrypt({ password: passphrase, input: backupEncryptedPrv }),
        isLastSignature: true,
      } as unknown as SignTransactionOptions;
```

- The actual object i constructed here is over redundant, tune the parameters to be more concise
- Followed this on the OVC as a reference <https://github.com/BitGo/offline-vault-console/blob/7f850cdd10c89ceb850c69759349b9e0bbfb56db/frontend/src/pkg/bitgo/transaction-utils.ts#L595>

2. Let's use this type for the body for recovery on MBE

```javascript
  recover(
    coin: string,
    parameters: RecoverParams & {
      rootAddress?: string;
      gasLimit?: number;
      gasPrice?: number;
      eip1559?: {
        maxFeePerGas: number;
        maxPriorityFeePerGas: number;
      };
      replayProtectionOptions?: {
        chain: 10001 | 17000 | typeof Chain[keyof typeof Chain];
        hardfork: `${Hardfork}`;
      };
      walletContractAddress?: string;
      durableNonce?: {
        publicKey: string;
        secretKey: string;
      };
      tokenContractAddress?: string;
      startingScanIndex?: number;
      seed?: string;
      common?: EthLikeCommon.default;
      ethCommonParams?: EvmCcrNonBitgoCoinConfigType | undefined;
      issuerAddress?: string, // eg. xrpl token
      currencyCode?: string, // eg. xrpl token
      tokenId?: string, // eg. hbar token
      contractId?: string, // eg. stacks sip10 token
    }
  ): Promise<BackupKeyRecoveryTransansaction | FormattedOfflineVaultTxInfo>;
```

- <http://github.com/BitGo/wallet-recovery-wizard/blob/bc3957e253a17702e8e62be2e6bfd7e539692227/src/preload.d.ts#L97>

3. Implement for UTXO coins

- need to get a hold of a blockchair api key

```

```
