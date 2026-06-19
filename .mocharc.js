module.exports = {
  require: ['ts-node/register'],
  extension: ['ts'],
  timeout: 0,
  ui: 'bdd',
  spec: 'src/**/__tests__/**/*.test.ts',
  // E2E scenarios require live external services + WP testnet; they run via
  // `npm run test:e2e` (.mocharc.e2e.js), not under `npm test`.
  ignore: ['src/**/*.e2e.test.ts'],
  recursive: true,
  exit: true
};
