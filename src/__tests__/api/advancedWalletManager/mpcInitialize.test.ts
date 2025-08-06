import nock from 'nock';
import 'should';
import * as sinon from 'sinon';
import * as express from 'express';
import * as request from 'supertest';
import { AppMode, AdvancedWalletManagerConfig, TlsMode } from '../../../shared/types';
import { app as enclavedApp } from '../../../advancedWalletManagerApp';

describe('MPC Initialize', () => {
  let agent: request.SuperAgentTest;
  let app: express.Application;
  let cfg: AdvancedWalletManagerConfig;
  const kmsUrl = 'http://kms.com';

  // Sample data key response from KMS
  const mockDataKeyResponse = {
    plaintextKey:
      '75,212,73,155,238,206,208,243,103,70,241,121,120,187,188,212,215,169,49,49,158,151,220,182,129,163,146,206,31,176,24,114',
    encryptedKey:
      '1,2,3,0,120,222,140,157,217,111,195,208,47,200,213,217,82,189,16,171,207,16,138,46,228,224,190,138,63,132,239,80,164,8,124,105,140,1,7,221,102,148,133,184,75,102,109,103,40,227,59,0,4,66,0,0,0,126,48,124,6,9,42,134,72,134,247,13,1,7,6,160,111,48,109,2,1,0,48,104,6,9,42,134,72,134,247,13,1,7,1,48,30,6,9,96,134,72,1,101,3,4,1,46,48,17,4,12,182,95,181,221,231,6,80,219,103,86,56,83,2,1,16,128,59,214,99,174,74,198,0,141,19,136,106,211,254,68,242,173,237,13,192,176,121,74,142,141,240,161,253,119,56,144,29,201,133,58,246,2,202,166,201,161,193,29,162,12,243,174,67,27,114,208,168,214,248,170,203,214,117,49,128,218',
  };

  before(() => {
    // app config
    cfg = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      httpLoggerFile: '',
      kmsUrl: kmsUrl,
      tlsMode: TlsMode.DISABLED,
      clientCertAllowSelfSigned: true,
    };

    // configStub = sinon.stub(configModule, 'initConfig').returns(cfg);

    app = enclavedApp(cfg);
    agent = request.agent(app);
  });

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    // Mock KMS service
    nock(kmsUrl).post('/generateDataKey').reply(200, mockDataKeyResponse);
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  it('should successfully initialize MPC key generation for user source', async () => {
    // Mock request object
    const result = await agent.post('/api/tsol/mpc/key/initialize').send({
      source: 'user',
      bitgoGpgPub:
        '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' +
        '\n' +
        'xk8EYqEU5hMFK4EEAAoCAwQDdbAIZrsblEXIavyg2go6p9oG0SqWTgFsdHTc\n' +
        'BhqdIS/WjQ8pj75q+vLqFtV9hlImYGInsIWh97fsigzB2owyzRhoc20gPGhz\n' +
        'bUB0ZXN0LmJpdGdvLmNvbT7ChAQTEwgAFQUCYqEU5wILCQIVCAIWAAIbAwIe\n' +
        'AQAhCRCJNRsIDGunexYhBHRL5D/8nRM3opQnXok1GwgMa6d7tg8A/24A9awq\n' +
        'SCJx7RddiUzFHcKhVvvo3R5N7bHaOGP3TP79AP0TavF2WzhUXmZSjt3IK23O\n' +
        '7/aknbijVeq52ghbWb1SwsJ1BBATCAAGBQJioRTnACEJEAWuA35KJgtgFiEE\n' +
        'ZttLPR0KcYvjgvJCBa4DfkomC2BsrwD/Z+43zOw+WpfPHxe+ypyVog5fnOKl\n' +
        'XwleH6zDvqUWmWkA/iaHC6ullYkSG4Mv68k6qbtgR/pms/X7rkfa0QQFJy5p\n' +
        'zlMEYqEU5hIFK4EEAAoCAwSsLqmfonjMF3o0nZ5JHvLpmfTA1RIVDsAEoRON\n' +
        'tZA6rAA23pGl6s3Iyt4/fX9Adzoh3EElOjMsgi8Aj3dFpuqiAwEIB8J4BBgT\n' +
        'CAAJBQJioRTnAhsMACEJEIk1GwgMa6d7FiEEdEvkP/ydEzeilCdeiTUbCAxr\n' +
        'p3vM7AD9GPp6HhYNEh2VVCDtFSt14Bni5FVM5icpVDo6w9ibvWAA/2Ti3Jv4\n' +
        'IhIxl81/wqAgqigIblrz6vjtagr9/ykXQCW3\n' +
        '=skCo\n' +
        '-----END PGP PUBLIC KEY BLOCK-----\n',
    });

    // Assert the response structure
    result.should.have.property('statusCode', 200);
    result.body.should.have.property('bitgoPayload');
    result.body.bitgoPayload.from.should.equal('user');
    result.body.bitgoPayload.to.should.equal('bitgo');
    result.body.bitgoPayload.should.have.property('privateShare');
    result.body.bitgoPayload.privateShare.should.not.be.empty();
  });

  it('should successfully initialize MPC key generation for backup source', async () => {
    // Mock request object
    const result = await agent.post('/api/tsol/mpc/key/initialize').send({
      source: 'backup',
      bitgoGpgPub:
        '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' +
        '\n' +
        'xk8EYqEU5hMFK4EEAAoCAwQDdbAIZrsblEXIavyg2go6p9oG0SqWTgFsdHTc\n' +
        'BhqdIS/WjQ8pj75q+vLqFtV9hlImYGInsIWh97fsigzB2owyzRhoc20gPGhz\n' +
        'bUB0ZXN0LmJpdGdvLmNvbT7ChAQTEwgAFQUCYqEU5wILCQIVCAIWAAIbAwIe\n' +
        'AQAhCRCJNRsIDGunexYhBHRL5D/8nRM3opQnXok1GwgMa6d7tg8A/24A9awq\n' +
        'SCJx7RddiUzFHcKhVvvo3R5N7bHaOGP3TP79AP0TavF2WzhUXmZSjt3IK23O\n' +
        '7/aknbijVeq52ghbWb1SwsJ1BBATCAAGBQJioRTnACEJEAWuA35KJgtgFiEE\n' +
        'ZttLPR0KcYvjgvJCBa4DfkomC2BsrwD/Z+43zOw+WpfPHxe+ypyVog5fnOKl\n' +
        'XwleH6zDvqUWmWkA/iaHC6ullYkSG4Mv68k6qbtgR/pms/X7rkfa0QQFJy5p\n' +
        'zlMEYqEU5hIFK4EEAAoCAwSsLqmfonjMF3o0nZ5JHvLpmfTA1RIVDsAEoRON\n' +
        'tZA6rAA23pGl6s3Iyt4/fX9Adzoh3EElOjMsgi8Aj3dFpuqiAwEIB8J4BBgT\n' +
        'CAAJBQJioRTnAhsMACEJEIk1GwgMa6d7FiEEdEvkP/ydEzeilCdeiTUbCAxr\n' +
        'p3vM7AD9GPp6HhYNEh2VVCDtFSt14Bni5FVM5icpVDo6w9ibvWAA/2Ti3Jv4\n' +
        'IhIxl81/wqAgqigIblrz6vjtagr9/ykXQCW3\n' +
        '=skCo\n' +
        '-----END PGP PUBLIC KEY BLOCK-----\n',
      counterPartyGpgPub:
        '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' +
        '\n' +
        'xk8EYqEU5hMFK4EEAAoCAwQDdbAIZrsblEXIavyg2go6p9oG0SqWTgFsdHTc\n' +
        'BhqdIS/WjQ8pj75q+vLqFtV9hlImYGInsIWh97fsigzB2owyzRhoc20gPGhz\n' +
        'bUB0ZXN0LmJpdGdvLmNvbT7ChAQTEwgAFQUCYqEU5wILCQIVCAIWAAIbAwIe\n' +
        'AQAhCRCJNRsIDGunexYhBHRL5D/8nRM3opQnXok1GwgMa6d7tg8A/24A9awq\n' +
        'SCJx7RddiUzFHcKhVvvo3R5N7bHaOGP3TP79AP0TavF2WzhUXmZSjt3IK23O\n' +
        '7/aknbijVeq52ghbWb1SwsJ1BBATCAAGBQJioRTnACEJEAWuA35KJgtgFiEE\n' +
        'ZttLPR0KcYvjgvJCBa4DfkomC2BsrwD/Z+43zOw+WpfPHxe+ypyVog5fnOKl\n' +
        'XwleH6zDvqUWmWkA/iaHC6ullYkSG4Mv68k6qbtgR/pms/X7rkfa0QQFJy5p\n' +
        'zlMEYqEU5hIFK4EEAAoCAwSsLqmfonjMF3o0nZ5JHvLpmfTA1RIVDsAEoRON\n' +
        'tZA6rAA23pGl6s3Iyt4/fX9Adzoh3EElOjMsgi8Aj3dFpuqiAwEIB8J4BBgT\n' +
        'CAAJBQJioRTnAhsMACEJEIk1GwgMa6d7FiEEdEvkP/ydEzeilCdeiTUbCAxr\n' +
        'p3vM7AD9GPp6HhYNEh2VVCDtFSt14Bni5FVM5icpVDo6w9ibvWAA/2Ti3Jv4\n' +
        'IhIxl81/wqAgqigIblrz6vjtagr9/ykXQCW3\n' +
        '=skCo\n' +
        '-----END PGP PUBLIC KEY BLOCK-----\n',
    });

    // Assert the response structure
    result.should.have.property('statusCode', 200);
    result.body.should.have.property('bitgoPayload');
    result.body.bitgoPayload.from.should.equal('backup');
    result.body.bitgoPayload.to.should.equal('bitgo');
    result.body.bitgoPayload.should.have.property('privateShare');
    result.body.bitgoPayload.privateShare.should.not.be.empty();

    // For backup source with counterPartyGpgPub, counterPartyKeyShare should be defined
    result.body.should.have.property('counterPartyKeyShare');
    result.body.counterPartyKeyShare.from.should.equal('backup');
    result.body.counterPartyKeyShare.to.should.equal('user');
    result.body.counterPartyKeyShare.should.have.property('privateShare');
    result.body.counterPartyKeyShare.privateShare.should.not.be.empty();
  });

  it('should fail when backup source is missing counterPartyGpgPub', async () => {
    // Mock request without the required counterPartyGpgPub
    const result = await agent.post('/api/tsol/mpc/key/initialize').send({
      source: 'backup',
      bitgoGpgPub:
        '-----BEGIN PGP PUBLIC KEY BLOCK-----\n' +
        '\n' +
        'xk8EYqEU5hMFK4EEAAoCAwQDdbAIZrsblEXIavyg2go6p9oG0SqWTgFsdHTc\n' +
        'BhqdIS/WjQ8pj75q+vLqFtV9hlImYGInsIWh97fsigzB2owyzRhoc20gPGhz\n' +
        'bUB0ZXN0LmJpdGdvLmNvbT7ChAQTEwgAFQUCYqEU5wILCQIVCAIWAAIbAwIe\n' +
        'AQAhCRCJNRsIDGunexYhBHRL5D/8nRM3opQnXok1GwgMa6d7tg8A/24A9awq\n' +
        'SCJx7RddiUzFHcKhVvvo3R5N7bHaOGP3TP79AP0TavF2WzhUXmZSjt3IK23O\n' +
        '7/aknbijVeq52ghbWb1SwsJ1BBATCAAGBQJioRTnACEJEAWuA35KJgtgFiEE\n' +
        'ZttLPR0KcYvjgvJCBa4DfkomC2BsrwD/Z+43zOw+WpfPHxe+ypyVog5fnOKl\n' +
        'XwleH6zDvqUWmWkA/iaHC6ullYkSG4Mv68k6qbtgR/pms/X7rkfa0QQFJy5p\n' +
        'zlMEYqEU5hIFK4EEAAoCAwSsLqmfonjMF3o0nZ5JHvLpmfTA1RIVDsAEoRON\n' +
        'tZA6rAA23pGl6s3Iyt4/fX9Adzoh3EElOjMsgi8Aj3dFpuqiAwEIB8J4BBgT\n' +
        'CAAJBQJioRTnAhsMACEJEIk1GwgMa6d7FiEEdEvkP/ydEzeilCdeiTUbCAxr\n' +
        'p3vM7AD9GPp6HhYNEh2VVCDtFSt14Bni5FVM5icpVDo6w9ibvWAA/2Ti3Jv4\n' +
        'IhIxl81/wqAgqigIblrz6vjtagr9/ykXQCW3\n' +
        '=skCo\n' +
        '-----END PGP PUBLIC KEY BLOCK-----\n',
    });

    // Expect an error
    result.should.have.property('statusCode', 400);
    result.body.should.have.property('error');
    result.body.error.should.equal('BadRequestError');
    result.body.details.should.containEql('gpgKey is required on backup key share generation');
  });
});
