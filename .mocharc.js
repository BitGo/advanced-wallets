module.exports = {
  require: ['ts-node/register'],
  extension: ['ts'],
  timeout: 0,
  ui: 'bdd',
  spec: 'src/**/__tests__/**/*.test.ts',
  recursive: true,
  exit: true
};
