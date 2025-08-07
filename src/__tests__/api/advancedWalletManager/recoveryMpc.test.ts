import 'should';
import * as request from 'supertest';
import nock from 'nock';
import { app as expressApp } from '../../../advancedWalletManagerApp';
import { AdvancedWalletManagerConfig, AppMode, TlsMode } from '../../../shared/types';

describe('recoveryMpc', () => {
  let agent: request.SuperAgentTest;

  // test config
  const kmsUrl = 'http://kms.invalid';
  const sol = 'tsol';
  const sui = 'tsui';
  const accessToken = 'test-token';

  before(async () => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    const config: AdvancedWalletManagerConfig = {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      port: 0, // Let OS assign a free port
      bind: 'localhost',
      timeout: 60000,
      kmsUrl: kmsUrl,
      httpLoggerFile: '',
      tlsMode: TlsMode.DISABLED,

      recoveryMode: true,
    };

    const app = expressApp(config);
    agent = request.agent(app);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  after(() => {
    nock.enableNetConnect();
  });

  describe('ECDSA sol recovery', () => {
    it('should successfully generate MPC solana transactions', async () => {
      const mockKmsUserResponse = {
        prv: '{"uShare":{"i":1,"t":2,"n":3,"y":"85aa6462d927329418f70f6d0863cf6cf33e7da2934f935e5927f1b13062d779","seed":"2f55c80fd6b5583dcde8037b2ee461d2e7d445a4d3e7a9b2a0d3d00b5f534169","chaincode":"66e80f2bf41a5706608352d51ceb07a5aa1729cab6c6993c124d5731546ed9a1"},"bitgoYShare":{"i":1,"j":3,"y":"483e53b72de3aa893df698d0b20b20777fb3d2716cc8483a9e9797174fd52b16","v":"e70696459e46434a2a12cc988e3ae714a61fe96da8a6764d058b849cab50d6dc","u":"49abf8144d265a77cf6d098eff784d6ce56ec77a182f6b39f47d5d8e28f2a802","chaincode":"797348468202f1d7fede0a7851f80162b02e7da306e65075dd864b6789b9bc5b"},"backupYShare":{"i":1,"j":2,"y":"249a9798d0064a989a16cd8f479edf09ffaee73f4175d2ac555ba90ff41b89da","v":"98e31d2b643e40060ba344c6a41fc096ea7e39a1ae879f65e4af645870e90ee0","u":"ac047b1bceab2e1a42d97ab540b39176e545d9c0af4a192aee8e1dae91a4240b","chaincode":"585bdc05c8f84802cbe7b9a1a07d4aa9c5fede93597a622854e9bad83a2d5b78"}}',
        pub: 'b6f5fb808f538a32735a89609e98fab75690a2c79b26f50a54c4cbf0fbca287138b733783f1590e12b4916ef0f6053b22044860117274bda44bd5d711855f174',
        source: 'user',
        type: 'tss',
      };

      const mockKmsBackupResponse = {
        prv: '{"uShare":{"i":2,"t":2,"n":3,"y":"249a9798d0064a989a16cd8f479edf09ffaee73f4175d2ac555ba90ff41b89da","seed":"abab5be2b32d07cf39b2a162af0f78bad8325b2fbdc89d14fd8b4e5767b74097","chaincode":"585bdc05c8f84802cbe7b9a1a07d4aa9c5fede93597a622854e9bad83a2d5b78"},"bitgoYShare":{"i":2,"j":3,"y":"483e53b72de3aa893df698d0b20b20777fb3d2716cc8483a9e9797174fd52b16","v":"e70696459e46434a2a12cc988e3ae714a61fe96da8a6764d058b849cab50d6dc","u":"eb54da28da3da22eb3d61797a02a96264be8940b7115aefbb90b9dd044db7f06","chaincode":"797348468202f1d7fede0a7851f80162b02e7da306e65075dd864b6789b9bc5b"},"userYShare":{"i":2,"j":1,"y":"85aa6462d927329418f70f6d0863cf6cf33e7da2934f935e5927f1b13062d779","v":"76cfdcbf0f769f21c64e0faf0072ebccbcc3aaa844522336af27f8e50ed7ca5f","u":"6ce814af82683423c8d8befd13f6eeeb0cd3f7274d1ebfdd5807fd2e4eaadb08","chaincode":"66e80f2bf41a5706608352d51ceb07a5aa1729cab6c6993c124d5731546ed9a1"}}',
        pub: 'b6f5fb808f538a32735a89609e98fab75690a2c79b26f50a54c4cbf0fbca287138b733783f1590e12b4916ef0f6053b22044860117274bda44bd5d711855f174',
        source: 'backup',
        type: 'tss',
      };

      nock(kmsUrl)
        .get(`/key/${mockKmsUserResponse.pub}`)
        .query({ source: 'user' })
        .reply(200, mockKmsUserResponse)
        .persist();

      nock(kmsUrl)
        .get(`/key/${mockKmsBackupResponse.pub}`)
        .query({ source: 'backup' })
        .reply(200, mockKmsBackupResponse)
        .persist();

      const input = {
        commonKeychain:
          'b6f5fb808f538a32735a89609e98fab75690a2c79b26f50a54c4cbf0fbca287138b733783f1590e12b4916ef0f6053b22044860117274bda44bd5d711855f174',
        unsignedSweepPrebuildTx: {
          txRequests: [
            {
              unsignedTx: '',
              signableHex:
                'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAECvoOqYkvCPusjYyhX4GdUtzSeVIcx6GkwdpSk8SkU0/cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIQtFGO2YBsrubq15CKqJLwXG3VEF1aEs36Rao6EaJDLAQECAAAMAgAAALhJxgAAAAAA',
              derivationPath: 'm/0',
            },
          ],
        },
      };

      const eddsaSignatureResponse = await agent
        .post(`/api/${sol}/mpc/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      eddsaSignatureResponse.status.should.equal(200);
      eddsaSignatureResponse.body.should.have.property('txHex');

      nock.cleanAll();
    });

    it('should throw 500 Internal Server Error if KMS cannot find user or backup keys', async () => {
      const commonKeychain =
        'b6f5fb808f538a32735a89609e98fab75690a2c79b26f50a54c4cbf0fbca287138b733783f1590e12b4916ef0f6053b22044860117274bda44bd5d711855f174';
      const mockKmsUserResponse = {};
      const mockKmsBackupResponse = {};

      nock(kmsUrl)
        .get(`/key/${commonKeychain}`)
        .query({ source: 'user' })
        .reply(200, mockKmsUserResponse)
        .persist();

      nock(kmsUrl)
        .get(`/key/${commonKeychain}`)
        .query({ source: 'backup' })
        .reply(200, mockKmsBackupResponse)
        .persist();

      const input = {
        commonKeychain:
          'b6f5fb808f538a32735a89609e98fab75690a2c79b26f50a54c4cbf0fbca287138b733783f1590e12b4916ef0f6053b22044860117274bda44bd5d711855f174',
        unsignedSweepPrebuildTx: {
          txRequests: [
            {
              unsignedTx: '',
              signableHex:
                'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAECvoOqYkvCPusjYyhX4GdUtzSeVIcx6GkwdpSk8SkU0/cAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIQtFGO2YBsrubq15CKqJLwXG3VEF1aEs36Rao6EaJDLAQECAAAMAgAAALhJxgAAAAAA',
              derivationPath: 'm/0',
            },
          ],
        },
      };

      const eddsaSignatureResponse = await agent
        .post(`/api/${sol}/mpc/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      eddsaSignatureResponse.status.should.equal(500);
      eddsaSignatureResponse.body.should.have.property('error');
      eddsaSignatureResponse.body.error.should.equal('Internal Server Error');

      nock.cleanAll();
    });
  });

  describe('ECDSA sui recovery', () => {
    it('should successfully generate MPC sui transactions', async () => {
      const mockKmsUserResponse = {
        prv: '{"uShare":{"i":1,"t":2,"n":3,"y":"8e10c0d10fb8a5780bba0f62fb86e2a80fd6f04b348985e9174a4f4f66e1baf5","seed":"368eab02c210effbb345d8c3cbe3d00b61292071feb0eafe26d9ce6060145d7b","chaincode":"e32078c8ba161f4c6c10b01abdf8203aed06878bae6a90906be228fd1b196b18"},"bitgoYShare":{"i":1,"j":3,"y":"532ee5aa5be82b9e64c10ff98d3be21901888bbba2293f0db429b8737cbf94ca","v":"72b2a6d7243654f4e80b050f5fa0c9de505b37ebcd7803dfacf22ba8bc60716a","u":"b13b791180c1148405f2137f011831ec5ffd4dd2584f7bef4f5a174debe8df08","chaincode":"87292c10bbdfd6f15e80dd96f3b530aaf0b7b99d933b3d0b61b7a1565b0a89f9"},"backupYShare":{"i":1,"j":2,"y":"5119753ee78a9f43ed2df6bc79d1d69954ada568dce7c3de6aa031ea2f951967","v":"852459fcfe7170cb433cc98115fb2a292b3301834ce89b0e843ad952cca885d1","u":"0854f68dbf402bc928afb86448eab19fbe90fcb387103d1fff35d02af18b230d","chaincode":"e09a186e387c74144c636793294a1c38017e9e4d5c5156f6b6fc824fe90fdaf0"}}',
        pub: 'f2b50b246be21f9819cdf08c721cd5d2dfb01efed33c65abd9030703609eef4c4ae3bd47ae726a5216f4f544daf76d1ddf3cdf769df7249284964ca35f33d001',
        source: 'user',
        type: 'tss',
      };

      const mockKmsBackupResponse = {
        prv: '{"uShare":{"i":2,"t":2,"n":3,"y":"5119753ee78a9f43ed2df6bc79d1d69954ada568dce7c3de6aa031ea2f951967","seed":"e70e6fd6f914b7b854e7b5ab46fff52a530dc3d10aa5a71c2b32559ea349ac4e","chaincode":"e09a186e387c74144c636793294a1c38017e9e4d5c5156f6b6fc824fe90fdaf0"},"bitgoYShare":{"i":2,"j":3,"y":"532ee5aa5be82b9e64c10ff98d3be21901888bbba2293f0db429b8737cbf94ca","v":"72b2a6d7243654f4e80b050f5fa0c9de505b37ebcd7803dfacf22ba8bc60716a","u":"709cfacb0bfa99c38ff319d16e4e2b34ecd8e40025496d21d2932204b785e80d","chaincode":"87292c10bbdfd6f15e80dd96f3b530aaf0b7b99d933b3d0b61b7a1565b0a89f9"},"userYShare":{"i":2,"j":1,"y":"8e10c0d10fb8a5780bba0f62fb86e2a80fd6f04b348985e9174a4f4f66e1baf5","v":"a81795570884a88dc7586c9a49a632a2aea0859eae622c51617387b85e8b5b0a","u":"0857dfc00a1fe3a4a41a752e933788becc6b23c2f5637393906f79b89aa50d0d","chaincode":"e32078c8ba161f4c6c10b01abdf8203aed06878bae6a90906be228fd1b196b18"}}',
        pub: 'f2b50b246be21f9819cdf08c721cd5d2dfb01efed33c65abd9030703609eef4c4ae3bd47ae726a5216f4f544daf76d1ddf3cdf769df7249284964ca35f33d001',
        source: 'backup',
        type: 'tss',
      };

      nock(kmsUrl)
        .get(`/key/${mockKmsUserResponse.pub}`)
        .query({ source: 'user' })
        .reply(200, mockKmsUserResponse)
        .persist();

      nock(kmsUrl)
        .get(`/key/${mockKmsBackupResponse.pub}`)
        .query({ source: 'backup' })
        .reply(200, mockKmsBackupResponse)
        .persist();

      const input = {
        commonKeychain:
          'f2b50b246be21f9819cdf08c721cd5d2dfb01efed33c65abd9030703609eef4c4ae3bd47ae726a5216f4f544daf76d1ddf3cdf769df7249284964ca35f33d001',
        unsignedSweepPrebuildTx: {
          txRequests: [
            {
              unsignedTx: '',
              signableHex:
                '00000200085c41793b000000000020cc1d71fdfab20a29d084030623a682e86f254f3e6a08134cc037de37fea94b21020200010100000101020000010100cc1d71fdfab20a29d084030623a682e86f254f3e6a08134cc037de37fea94b21011a4951d0006f16326d5b74df71b5c81450b4cc74d9f1c357e6e1665d5ca9a067a711d0140000000020d0402c106771059acc3246a145a7baccd512f499f086976fe768569d751bb00dcc1d71fdfab20a29d084030623a682e86f254f3e6a08134cc037de37fea94b21e803000000000000a48821000000000000',
              derivationPath: 'm/0',
            },
          ],
        },
      };

      const eddsaSignatureResponse = await agent
        .post(`/api/${sui}/mpc/recovery`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send(input);

      eddsaSignatureResponse.status.should.equal(200);
      eddsaSignatureResponse.body.should.have.property('txHex');
    });
  });
});
