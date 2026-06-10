import nock from 'nock';

const BLOCKCHAIR_BASE = 'https://api.blockchair.com';
const MEMPOOL_BASE = 'https://mempool.space';

export interface IndexerMockOptions {
  fundsAddress: string;
  txHash: string;
  value: number;
  apiKey: string;
}

export interface IndexerMocks {
  fundsBalanceDone(): boolean;
  unspentsDone(): boolean;
  feeDone(): boolean;
}

export function setupIndexerMocks(opts: IndexerMockOptions): IndexerMocks {
  const { fundsAddress, txHash, value, apiKey } = opts;

  const balanceNock = nock(BLOCKCHAIR_BASE)
    .get(`/bitcoin/testnet/dashboards/address/${fundsAddress}?key=${apiKey}`)
    .reply(200, {
      data: { [fundsAddress]: { address: { transaction_count: 1, balance: value } } },
    });

  const unspentsNock = nock(BLOCKCHAIR_BASE)
    .get(`/bitcoin/testnet/dashboards/addresses/${fundsAddress}?key=${apiKey}`)
    .reply(200, {
      data: {
        utxo: [
          {
            transaction_hash: txHash,
            index: 0,
            recipient: fundsAddress,
            value,
            block_id: 100,
            spending_transaction_hash: null,
            spending_index: null,
            address: fundsAddress,
          },
        ],
      },
    });

  nock(BLOCKCHAIR_BASE)
    .persist()
    .get(new RegExp(`/bitcoin/testnet/dashboards/address/[^?]+\\?key=${apiKey}`))
    .reply(function (uri) {
      const match = uri.match(/\/dashboards\/address\/([^?]+)\?/);
      const addr = match ? decodeURIComponent(match[1]) : 'unknown';
      return [200, { data: { [addr]: { address: { transaction_count: 0, balance: 0 } } } }];
    });

  const feeNock = nock(MEMPOOL_BASE)
    .get('/api/v1/fees/recommended')
    .reply(200, { fastestFee: 20, halfHourFee: 10, hourFee: 5 });

  return {
    fundsBalanceDone: () => balanceNock.isDone(),
    unspentsDone: () => unspentsNock.isDone(),
    feeDone: () => feeNock.isDone(),
  };
}

export function teardownIndexerMocks(): void {
  nock.cleanAll();
}
