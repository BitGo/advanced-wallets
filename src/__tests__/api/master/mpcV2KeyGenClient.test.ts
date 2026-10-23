import 'should';
import nock from 'nock';
import { AdvancedWalletManagerClient } from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';

describe('AdvancedWalletManagerClient MPCv2 key generation', () => {
  const awmUrl = 'http://awm.invalid';
  const signedMessage = { message: 'bWVzc2FnZQ==', signature: 'sig' };
  let client: AdvancedWalletManagerClient;

  before(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    client = new AdvancedWalletManagerClient(
      { advancedWalletManagerUrl: awmUrl, tlsMode: 0, clientCertAllowSelfSigned: true } as never,
      'tsol',
    );
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('initMpcV2KeyGen posts the source to /mpcv2/initialize', async () => {
    const scope = nock(awmUrl)
      .post('/api/tsol/mpcv2/initialize', { source: 'user' })
      .reply(200, { gpgPub: 'pub', encryptedData: 'data', encryptedDataKey: 'key' });

    const res = await client.initMpcV2KeyGen({ source: 'user' });
    res.should.deepEqual({ gpgPub: 'pub', encryptedData: 'data', encryptedDataKey: 'key' });
    scope.isDone().should.be.true();
  });

  it('roundMpcV2KeyGen sends EdDSA round 1 GPG keys and returns the signed message', async () => {
    const body = {
      source: 'backup',
      encryptedData: 'data',
      encryptedDataKey: 'key',
      round: 1,
      bitgoGpgPub: 'bitgo-pub',
      counterPartyGpgPub: 'user-pub',
    };
    const scope = nock(awmUrl).post('/api/tsol/mpcv2/round', body).reply(200, {
      encryptedData: 'd2',
      encryptedDataKey: 'k2',
      round: 2,
      signedMsg: signedMessage,
    });

    const res = await client.roundMpcV2KeyGen({ ...body, source: 'backup' });
    res.signedMsg?.should.deepEqual(signedMessage);
    scope.isDone().should.be.true();
  });

  it('roundMpcV2KeyGen sends EdDSA round 2 signed messages', async () => {
    const body = {
      source: 'user',
      encryptedData: 'data',
      encryptedDataKey: 'key',
      round: 2,
      bitgoMsg: signedMessage,
      counterPartyMsg: signedMessage,
    };
    const scope = nock(awmUrl).post('/api/tsol/mpcv2/round', body).reply(200, {
      encryptedData: 'd3',
      encryptedDataKey: 'k3',
      round: 3,
      signedMsg: signedMessage,
    });

    const res = await client.roundMpcV2KeyGen({ ...body, source: 'user' });
    res.round.should.equal(3);
    scope.isDone().should.be.true();
  });

  it('finalizeMpcV2KeyGen sends EdDSA signed messages and no broadcastMessages', async () => {
    const body = {
      source: 'user',
      encryptedData: 'data',
      encryptedDataKey: 'key',
      bitgoCommonKeychain: 'common',
      bitgoMsg: signedMessage,
      counterPartyMsg: signedMessage,
    };
    const scope = nock(awmUrl)
      .post('/api/tsol/mpcv2/finalize', body)
      .reply(200, { source: 'user', commonKeychain: 'common' });

    const res = await client.finalizeMpcV2KeyGen({ ...body, source: 'user' });
    res.commonKeychain.should.equal('common');
    scope.isDone().should.be.true();
  });

  it('roundMpcV2KeyGen still sends the ECDSA broadcast and p2p messages', async () => {
    const body = {
      source: 'user',
      encryptedData: 'data',
      encryptedDataKey: 'key',
      round: 2,
      broadcastMessages: { bitgo: 'b', counterParty: 'c' },
      p2pMessages: { bitgo: 'p', counterParty: 'q' },
    };
    const scope = nock(awmUrl)
      .post('/api/tsol/mpcv2/round', body)
      .reply(200, { encryptedData: 'd', encryptedDataKey: 'k', round: 3 });

    await client.roundMpcV2KeyGen({ ...body, source: 'user' });
    scope.isDone().should.be.true();
  });
});
