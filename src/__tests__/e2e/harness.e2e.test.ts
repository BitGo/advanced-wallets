import 'should';
import { loadE2EConfig, requireConfig } from './helpers';

/**
 * Harness sanity check (no network). Proves the runner, ts-node wiring, and
 * config loading are healthy so `npm run test:e2e` is green before any service
 * scenarios exist. Real pipeline scenarios live in *.e2e.test.ts siblings.
 */
describe('E2E harness', () => {
  it('loads config with local-compose defaults', () => {
    const cfg = loadE2EConfig();
    cfg.mbeUrl.should.be.a.String();
    cfg.bridgeUrl.should.be.a.String();
    cfg.coin.should.be.a.String();
    cfg.pollIntervalMs.should.be.a.Number();
    cfg.pollTimeoutMs.should.be.above(0);
  });

  it('requireConfig throws when a needed value is missing', () => {
    const cfg = loadE2EConfig();
    delete cfg.accessToken;
    (() => requireConfig(cfg, ['accessToken'])).should.throw(/missing required values/);
  });
});
