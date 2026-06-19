module.exports = {
  require: ['ts-node/register'],
  extension: ['ts'],
  // Testnet confirmations are slow; allow generous per-test budgets.
  timeout: 120000,
  ui: 'bdd',
  spec: 'src/**/__tests__/e2e/**/*.e2e.test.ts',
  recursive: true,
  exit: true,
};
