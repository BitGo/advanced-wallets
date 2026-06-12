export function getBaseWalletParams(multisigType: 'onchain' | 'tss') {
  return { m: 2, n: 3, keys: [] as string[], type: 'advanced', multisigType } as const;
}
