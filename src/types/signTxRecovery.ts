//TODO: check what is RecoverParams for RecoverParams & (inside parameters on the notes)
//TODO: what about recipients?
export type SignTransactionRecoveryParams = {
  intent: 'recover-half-sign' | 'recover-full-sign';
  coin: string;
  parameters: {
    key: string; // TODO: not sure, i added this field as user or backup but maybe i'm confused
    apiKey?: string; // for eth it's a key for the explorer
    rootAddress?: string;
    gasLimit?: number;
    gasPrice?: number;
    eip1559?: {
      maxFeePerGas: number;
      maxPriorityFeePerGas: number;
    };
    walletContractAddress?: string;
    recoveryDestination?: string;
    tokenContractAddress?: string;
    startingScanIndex?: number;
    issuerAddress?: string; // eg. xrpl token
    currencyCode?: string; // eg. xrpl token
    tokenId?: string; // eg. hbar token
    contractId?: string; // eg. stacks sip10 token
  };
};
