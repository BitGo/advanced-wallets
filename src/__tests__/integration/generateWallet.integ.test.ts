import 'should';
import { startServices, IntegServices } from './helpers/setup';
import { LOCALHOST } from './helpers/servers';
import { SigningMode } from '../../shared/types';
import type { GenerateWalletResponseBody } from '../../masterBitgoExpress/routers/generateWalletRoute';

describe('Generate wallet: LOCAL signing', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices();
  });

  after(async () => {
    await services.teardown();
  });

  beforeEach(() => {
    services.keyProvider.calls.length = 0;
    services.bitgo.calls.length = 0;
  });

  it('generates a tbtc onchain wallet end-to-end', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify({
          enterprise: 'test-enterprise',
          label: 'test-wallet',
          multisigType: 'onchain',
        }),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as GenerateWalletResponseBody;
    body.should.have.property('wallet');
    body.wallet.should.have.property('id', 'test-wallet-id');

    /** In local mode, AWM stores keys via POST /key — POST /key/generate must NOT be called */
    const keyProviderStoreCalls = services.keyProvider.calls.filter((c) => c.path === '/key');
    keyProviderStoreCalls.should.have.length(2);

    const keyProviderGenerateCalls = services.keyProvider.calls.filter(
      (c) => c.path === '/key/generate',
    );
    keyProviderGenerateCalls.should.have.length(0);

    /** BitGo received 3 keychain adds */
    const bitgoKeyCalls = services.bitgo.calls.filter(
      (c) => c.method === 'POST' && c.path.endsWith('/key'),
    );
    bitgoKeyCalls.should.have.length(3);

    /** and 1 wallet add */
    const walletAddCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/wallet/add'));
    walletAddCalls.should.have.length(1);
  });
});

describe('Generate wallet: EXTERNAL signing', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ signingMode: SigningMode.EXTERNAL });
  });

  after(async () => {
    await services.teardown();
  });

  beforeEach(() => {
    services.keyProvider.calls.length = 0;
    services.bitgo.calls.length = 0;
  });

  it('generates a tbtc onchain wallet — key provider generates keys (external signing mode)', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/tbtc/advancedwallet/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
        body: JSON.stringify({
          enterprise: 'test-enterprise',
          label: 'test-wallet',
          multisigType: 'onchain',
        }),
      },
    );

    res.status.should.equal(200);
    const body = (await res.json()) as GenerateWalletResponseBody;
    body.should.have.property('wallet');
    body.wallet.should.have.property('id', 'test-wallet-id');

    /**
     * In external mode, AWM delegates key generation to the key provider.
     */
    const keyProviderGenerateCalls = services.keyProvider.calls.filter(
      (c) => c.path === '/key/generate',
    );
    keyProviderGenerateCalls.should.have.length(2);

    /** POST /key should NOT be called — AWM never generates keys locally in external mode */
    const keyProviderStoreCalls = services.keyProvider.calls.filter((c) => c.path === '/key');
    keyProviderStoreCalls.should.have.length(0);

    /** BitGo receives 3 keychain adds */
    const bitgoKeyCalls = services.bitgo.calls.filter(
      (c) => c.method === 'POST' && c.path.endsWith('/key'),
    );
    bitgoKeyCalls.should.have.length(3);

    /** and 1 wallet add */
    const walletAddCalls = services.bitgo.calls.filter((c) => c.path.endsWith('/wallet/add'));
    walletAddCalls.should.have.length(1);
  });
});
