module.exports = {
  require: ['ts-node/register'],
  extension: ['ts'],
  timeout: 60000,
  reporter: 'min',
  'reporter-option': ['cdn=true', 'json=false', 'consoleReporter=spec'],
  exit: true,
};
