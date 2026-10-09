import 'should';

import nock from 'nock';
import { TxRequest } from '@bitgo-beta/sdk-core';
import { TlsMode } from '../../../shared/types';
import { MasterExpressConfig } from '../../../shared/types';
import { AdvancedWalletManagerClient } from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';

describe('AdvancedWalletManagerClient MPCv2 curveType forwarding', () => {
  const awmUrl = 'http://awm.invalid';
  const coin = 'tsol';

  const cfg = {
    advancedWalletManagerUrl: awmUrl,
    awmServerCaCert: '',
    tlsMode: TlsMode.DISABLED,
  } as unknown as MasterExpressConfig;

  // Minimal fixture: the client forwards txRequest opaquely.
  const mockTxRequest = {
    apiVersion: 'full',
    walletId: '68489ecff6fb16304670b327db8eb31a',
    transactions: [
      {
        unsignedTx: {
          derivationPath: 'm/0',
          signableHex: 'testMessage',
        },
      },
    ],
  };
  // Minimal fixture: the client forwards txRequest opaquely.
  const txRequestFixture = mockTxRequest as unknown as TxRequest;

  const mockRound1Response = {
    signatureShareRound1: { from: 'user', to: 'bitgo', payload: 'mock-round1-payload' },
    userGpgPubKey: 'mock-user-gpg-pub-key',
    encryptedRound1Session: 'mock-encrypted-round1-session',
    encryptedUserGpgPrvKey: 'mock-encrypted-user-gpg-prv-key',
    encryptedDataKey: 'mock-encrypted-data-key',
  };

  afterEach(() => {
    nock.cleanAll();
  });

  it('should include curveType in the round 1 request body when provided', async () => {
    const client = new AdvancedWalletManagerClient(cfg, coin);

    const nockScope = nock(awmUrl)
      .post('/api/tsol/mpc/sign/mpcv2round1', (body) => {
        body.should.have.property('curveType', 'eddsa');
        return true;
      })
      .reply(200, mockRound1Response);

    const response = await client.signMPCv2Round1('user', 'mock-pub', {
      txRequest: txRequestFixture,
      curveType: 'eddsa',
    });

    response.should.have.property('signatureShareRound1');
    nockScope.done();
  });

  it('should omit curveType from the round 1 request body when not provided', async () => {
    const client = new AdvancedWalletManagerClient(cfg, coin);

    const nockScope = nock(awmUrl)
      .post('/api/tsol/mpc/sign/mpcv2round1', (body) => {
        body.should.not.have.property('curveType');
        return true;
      })
      .reply(200, mockRound1Response);

    const response = await client.signMPCv2Round1('user', 'mock-pub', {
      txRequest: txRequestFixture,
    });

    response.should.have.property('signatureShareRound1');
    nockScope.done();
  });

  it('should include curveType in the round 2 request body when provided', async () => {
    const client = new AdvancedWalletManagerClient(cfg, coin);

    const mockRound2Response = {
      signatureShareRound2: { from: 'user', to: 'bitgo', payload: 'mock-round2-payload' },
      encryptedRound2Session: 'mock-encrypted-round2-session',
    };

    const nockScope = nock(awmUrl)
      .post('/api/tsol/mpc/sign/mpcv2round2', (body) => {
        body.should.have.property('curveType', 'eddsa');
        return true;
      })
      .reply(200, mockRound2Response);

    const response = await client.signMPCv2Round2('user', 'mock-pub', {
      txRequest: txRequestFixture,
      encryptedUserGpgPrvKey: 'mock-encrypted-user-gpg-prv-key',
      encryptedRound1Session: 'mock-encrypted-round1-session',
      encryptedDataKey: 'mock-encrypted-data-key',
      bitgoPublicGpgKey: 'mock-bitgo-gpg-key',
      curveType: 'eddsa',
    });

    response.should.have.property('signatureShareRound2');
    nockScope.done();
  });

  it('should include curveType in the round 3 request body when provided', async () => {
    const client = new AdvancedWalletManagerClient(cfg, coin);

    const mockRound3Response = {
      signatureShareRound3: { from: 'user', to: 'bitgo', payload: 'mock-round3-payload' },
    };

    const nockScope = nock(awmUrl)
      .post('/api/tsol/mpc/sign/mpcv2round3', (body) => {
        body.should.have.property('curveType', 'eddsa');
        return true;
      })
      .reply(200, mockRound3Response);

    const response = await client.signMPCv2Round3('user', 'mock-pub', {
      txRequest: txRequestFixture,
      encryptedUserGpgPrvKey: 'mock-encrypted-user-gpg-prv-key',
      encryptedRound2Session: 'mock-encrypted-round2-session',
      encryptedDataKey: 'mock-encrypted-data-key',
      bitgoPublicGpgKey: 'mock-bitgo-gpg-key',
      curveType: 'eddsa',
    });

    response.should.have.property('signatureShareRound3');
    nockScope.done();
  });
});
