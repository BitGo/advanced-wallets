import 'should';
import nock from 'nock';
import sinon from 'sinon';
import supertest from 'supertest';
import { Utils } from '@bitgo-beta/sdk-coin-sol';
import * as kmsUtils from '../../../api/enclaved/utils';
import { app as expressApp } from '../../../enclavedApp';
import { AppMode, EnclavedConfig, TlsMode } from '../../../shared/types';

describe('EdDSA Recovery Signing', () => {
  let agent: supertest.SuperTest<supertest.Test>;
  const config: EnclavedConfig = {
    appMode: AppMode.ENCLAVED,
    port: 0,
    bind: 'localhost',
    timeout: 60000,
    logFile: '',
    tlsMode: TlsMode.DISABLED,
    mtlsRequestCert: false,
    allowSelfSigned: true,
    kmsUrl: 'kms.example.com',
  };

  const commonKeychain =
    'e6af376e5e8cb910688746ee78ad6bb5072818aaa70cf345e172d1728d3740fd0018a89bd38b25e63c1c669862b565fc151ba135a11fb95a6bdf948c2822a1ed';
  const signableHex =
    'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAED1l2GN0NLHRG0qHWRP6mckcSGuMt1oLCXmHg+B4OFFqpDCXlFFOMMuhONo9GflGJ/CFuIQFPG0ToHYr8qudDrvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAuQDjxexg8jPVFGuhkiej/ogeUNLSvaV6hS1u9xWv2YQBAgIAAQwCAAAA+HAeAAAAAAA=';
  const derivationPath = 'm/0';

  const userPrvShare = {
    uShare: {
      i: 1,
      t: 2,
      n: 3,
      y: 'e7d6491f125400cd25cdea85b33f131e0fbdb5681f2e32a7dc57ec9ba7efc7d2',
      seed: 'e7247dccc0003331932a882eb93e592cb818e55a55d661cbac2f33b7b0e9e50c',
      chaincode: '9b7190d99201cb97ccb0a9b85248dd5253f379c854a7c3b1515c6f99e8c574d8',
    },
    bitgoYShare: {
      i: 1,
      j: 3,
      y: '1972f140e84e0c55ed8de80c72fa3baa9e36add9c90b038ce0e88c5c641e1e72',
      v: 'c38f3af39f3f6a4a248b20dd8180a1488ebfbaf44a7449760ceda95df1ba21b4',
      u: '67ea6988da9e3f84de92be2f8acc7b2352c86699cb9ae15d7ce316237f138a0d',
      chaincode: '82500a3f5d6ff41b764bb892c832c1c88b07fa1943e45afb8a05eb7aae66b869',
    },
    backupYShare: {
      i: 1,
      j: 2,
      y: '526502a209e56ec7f935ff7e4186b42b691e16fdda66c73cd796a6e10c8e5b10',
      v: '9a2baa9f8141c12f24dea60c5e3ac002536563eafecc9bbb94d39edb18b37297',
      u: 'fb995729e12302ecb9e740ccc6cb0001449125abc7210f6eaf12666823e50305',
      chaincode: 'e2570d82e4196632f920044d4839c6e136202d5408939aad907d397790f674ac',
    },
  };

  const backupPrvShare = {
    uShare: {
      i: 2,
      t: 2,
      n: 3,
      y: '526502a209e56ec7f935ff7e4186b42b691e16fdda66c73cd796a6e10c8e5b10',
      seed: '931322cb88f58ac02a4a654e73077046c608602329fddb73a3ac684cd661a480',
      chaincode: 'e2570d82e4196632f920044d4839c6e136202d5408939aad907d397790f674ac',
    },
    bitgoYShare: {
      i: 2,
      j: 3,
      y: '1972f140e84e0c55ed8de80c72fa3baa9e36add9c90b038ce0e88c5c641e1e72',
      v: 'c38f3af39f3f6a4a248b20dd8180a1488ebfbaf44a7449760ceda95df1ba21b4',
      u: '97d4a560c35e5f5b7d511e689a305fce4a344ebc24632344fa2a9aff75803605',
      chaincode: '82500a3f5d6ff41b764bb892c832c1c88b07fa1943e45afb8a05eb7aae66b869',
    },
    userYShare: {
      i: 2,
      j: 1,
      y: 'e7d6491f125400cd25cdea85b33f131e0fbdb5681f2e32a7dc57ec9ba7efc7d2',
      v: '4174c7d5fea5922d1f70fb5e86049027cc1ee14fd2b276f8ac2bcc5887d89102',
      u: 'bd082934f69a8442187e782920c16d09b83cab6ecfa6486a06fd01ea5be75307',
      chaincode: '9b7190d99201cb97ccb0a9b85248dd5253f379c854a7c3b1515c6f99e8c574d8',
    },
  };

  beforeEach(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
    agent = supertest(expressApp(config));
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should successfully sign a Solana recovery transaction', async () => {
    // Mock KMS key retrieval
    const mockRetrieveKmsPrvKey = sinon.stub(kmsUtils, 'retrieveKmsPrvKey');
    mockRetrieveKmsPrvKey
      .withArgs({
        pub: commonKeychain,
        source: 'user',
        cfg: config,
        options: { useLocalEncipherment: false },
      })
      .resolves(JSON.stringify(userPrvShare));

    mockRetrieveKmsPrvKey
      .withArgs({
        pub: commonKeychain,
        source: 'backup',
        cfg: config,
        options: { useLocalEncipherment: false },
      })
      .resolves(JSON.stringify(backupPrvShare));

    const response = await agent.post('/api/tsol/mpc/recovery').send({
      commonKeychain,
      unsignedSweepPrebuildTx: {
        txRequests: [
          {
            signableHex,
            derivationPath,
            unsignedTx: signableHex,
          },
        ],
      },
    });

    response.status.should.equal(200);
    response.body.should.have.property('txHex');
    Utils.validateRawTransaction(response.body.txHex, true, true);

    // Verify KMS key retrieval calls
    mockRetrieveKmsPrvKey
      .calledWith({
        pub: commonKeychain,
        source: 'user',
        cfg: config,
        options: { useLocalEncipherment: false },
      })
      .should.be.true();

    mockRetrieveKmsPrvKey
      .calledWith({
        pub: commonKeychain,
        source: 'backup',
        cfg: config,
        options: { useLocalEncipherment: false },
      })
      .should.be.true();
  });

  it('should fail if user private key is missing', async () => {
    const mockRetrieveKmsPrvKey = sinon.stub(kmsUtils, 'retrieveKmsPrvKey');
    mockRetrieveKmsPrvKey
      .withArgs({
        pub: commonKeychain,
        source: 'user',
        cfg: config,
        options: { useLocalEncipherment: false },
      })
      .resolves(undefined);

    const response = await agent.post('/api/tsol/mpc/recovery').send({
      commonKeychain,
      unsignedSweepPrebuildTx: {
        txRequests: [
          {
            signableHex,
            derivationPath,
            unsignedTx: signableHex,
          },
        ],
      },
    });

    response.status.should.equal(500);
    response.body.should.have.property('details', 'Missing required private keys for recovery');
  });

  it('should fail if backup private key is missing', async () => {
    const mockRetrieveKmsPrvKey = sinon.stub(kmsUtils, 'retrieveKmsPrvKey');
    mockRetrieveKmsPrvKey
      .withArgs({
        pub: commonKeychain,
        source: 'user',
        cfg: config,
        options: { useLocalEncipherment: false },
      })
      .resolves(JSON.stringify(userPrvShare));

    mockRetrieveKmsPrvKey
      .withArgs({
        pub: commonKeychain,
        source: 'backup',
        cfg: config,
        options: { useLocalEncipherment: false },
      })
      .resolves(undefined);

    const response = await agent.post('/api/tsol/mpc/recovery').send({
      commonKeychain,
      unsignedSweepPrebuildTx: {
        txRequests: [
          {
            signableHex,
            derivationPath,
            unsignedTx: signableHex,
          },
        ],
      },
    });

    response.status.should.equal(500);
    response.body.should.have.property('details', 'Missing required private keys for recovery');
  });
});
