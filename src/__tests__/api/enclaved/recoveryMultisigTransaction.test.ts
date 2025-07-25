import 'should';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../enclavedApp';
import { AppMode, EnclavedConfig, TlsMode } from '../../../shared/types';
import sinon from 'sinon';
import * as middleware from '../../../shared/middleware';
import { BitGoRequest } from '../../../types/request';
import { BitGoAPI as BitGo } from '@bitgo-beta/sdk-api';
import * as kmsUtils from '../../../api/enclaved/utils';

describe('UTXO recovery', () => {
  let agent: request.SuperAgentTest;
  let mockRetrieveKmsPrvKey: sinon.SinonStub;
  const coin = 'tbtc';
  const config: EnclavedConfig = {
    appMode: AppMode.ENCLAVED,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    httpLoggerFile: '',
    tlsMode: TlsMode.DISABLED,
    allowSelfSigned: true,
    kmsUrl: 'kms.example.com',
    recoveryMode: true,
  };

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    // Initialize BitGo with test environment
    const bitgo = new BitGo({
      env: 'test',
      accessToken: 'test_token',
    });

    // Setup middleware stubs before creating app
    sinon.stub(middleware, 'prepareBitGo').callsFake(() => (req, res, next) => {
      (req as BitGoRequest<EnclavedConfig>).bitgo = bitgo;
      (req as BitGoRequest<EnclavedConfig>).config = config;
      next();
    });

    // Mock KMS key retrieval
    mockRetrieveKmsPrvKey = sinon.stub(kmsUtils, 'retrieveKmsPrvKey');
    mockRetrieveKmsPrvKey
      .withArgs({
        pub: 'xpub661MyMwAqRbcF3g1sUm7T5pN8ViCr9bS6XiQbq7dVXFdPEGYfhGgjjV2AFxTYVWik29y7NHmCZjWYDkt4RGw57HNYpHnoHeeqJV6s8hwcsV',
        source: 'user',
        cfg: config,
      })
      .resolves(
        'xprv9s21ZrQH143K2ZbYmTE75wsdaTsiSgsajJnooSi1wBieWRwQ89xSBwAYK1VJR795Y8XFCCXYHHs4sk2Heg6dkX3CHMBq5bw8DwBWByWx883',
      );

    mockRetrieveKmsPrvKey
      .withArgs({
        pub: 'xpub661MyMwAqRbcEywGPF6Pg1FDUtHGyxsn7nph8dcy8GFLKvQ8hSCKgUm8sNbJhegDbmLtMpMnGZtrqfRXCjeDtfJ2UGDSzNTkRuvAQ5KNPcH',
        source: 'backup',
        cfg: config,
      })
      .resolves(
        'xprv9s21ZrQH143K2VroHDZPJsJUvrSnaW9vkZu6LFDMZviMT84z9tt58gSf25PzAMJC9pb1qRUBiYcsgcKWTDhwmwazsDAvzzDB5qrE3XDfawH',
      );

    // Create app after middleware is stubbed
    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should recover a UTXO wallet by signing with user and backup keys', async () => {
    const userPub =
      'xpub661MyMwAqRbcF3g1sUm7T5pN8ViCr9bS6XiQbq7dVXFdPEGYfhGgjjV2AFxTYVWik29y7NHmCZjWYDkt4RGw57HNYpHnoHeeqJV6s8hwcsV';
    const backupPub =
      'xpub661MyMwAqRbcEywGPF6Pg1FDUtHGyxsn7nph8dcy8GFLKvQ8hSCKgUm8sNbJhegDbmLtMpMnGZtrqfRXCjeDtfJ2UGDSzNTkRuvAQ5KNPcH';
    const bitgoPub =
      'xpub661MyMwAqRbcGcBurxn9ptqqKGmMhnKa8D7TeZkaWpfQNTeG4qKEJ67eb6Hy58kZBwPHqjUt5iApUwvFVk9ffQYaV42RRom2p7yU5bcCwpq';

    const unsignedSweepPrebuildTx = {
      txHex:
        '0100000001edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f417027900000000',
      txInfo: {
        unspents: [
          {
            id: '3bc8f46fcbbc04e4b4a61f1a67a2cca381254524ca6d5e26bfaaf5fe83a5d7ed:0',
            address: 'tb1qprdy6jwxrrr2qrwgd2tzl8z99hqp29jn6f3sguxulqm448myj6jsy2nwsu',
            value: 4000,
            chain: 20,
            index: 0,
            valueString: '4000',
          },
        ],
      },
      feeInfo: {},
      coin: 'tbtc',
    };

    const response = await agent.post(`/api/${coin}/multisig/recovery`).send({
      userPub,
      backupPub,
      bitgoPub,
      unsignedSweepPrebuildTx,
      walletContractAddress: '',
      coin,
    });

    response.status.should.equal(200);
    response.body.should.have.property('txHex');
    response.body.txHex.should.equal(
      '01000000000101edd7a583fef5aabf265e6dca24452581a3cca2671a1fa6b4e404bccb6ff4c83b0000000000ffffffff01780f0000000000002200202120dcf53e62a4cc9d3843993aa2258bd14fbf911a4ea4cf4f3ac840f41702790400473044022043a9256810ef47ce36a092305c0b1ef675bce53e46418eea8cacbf1643e541d90220450766e048b841dac658d0a2ba992628bfe131dff078c3a574cadf67b4946647014730440220360045a15e459ed44aa3e52b86dd6a16dddaf319821f4dcc15627686f377edd102205cb3d5feab1a773c518d43422801e01dd1bc586bb09f6a9ed23a1fc0cfeeb5310169522103a1c425fd9b169e6ab5ed3de596acb777ccae0cda3d91256238b5e739a3f14aae210222a76697605c890dc4365132f9ae0d351952a1aad7eecf78d9923766dbe74a1e21033b21c0758ffbd446204914fa1d1c5921e9f82c2671dac89737666aa9375973e953ae00000000',
    );

    // Verify KMS key retrieval
    mockRetrieveKmsPrvKey
      .calledWith({
        pub: userPub,
        source: 'user',
        cfg: config,
      })
      .should.be.true();
    mockRetrieveKmsPrvKey
      .calledWith({
        pub: backupPub,
        source: 'backup',
        cfg: config,
      })
      .should.be.true();
  });
});
