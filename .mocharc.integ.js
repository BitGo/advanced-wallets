module.exports = {
  require: ['ts-node/register'],
  extension: ['ts'],
  timeout: 30000,
  ui: 'bdd',
  spec: 'src/**/__tests__/integration/**/*.integ.test.ts',
  recursive: true,
  exit: true,
};
