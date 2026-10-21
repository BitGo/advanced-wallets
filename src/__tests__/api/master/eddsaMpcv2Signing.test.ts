import 'should';

import nock from 'nock';
import * as sinon from 'sinon';
import { TxRequest } from '@bitgo-beta/sdk-core';
import {
  Environments,
  IRequestTracer,
  openpgpUtils,
  RequestTracer,
  Wallet,
} from '@bitgo-beta/sdk-core';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import {
  AdvancedWalletManagerClient,
  SignMpcV2Round1Response,
  SignMpcV2Round2Response,
} from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';
import {
  createEddsaMPCv2CustomSigners,
  signAndSendEddsaMPCv2FromTxRequest,
} from '../../../masterBitgoExpress/handlers/eddsa';
import { createMPCSendParamsWithCustomSigningFns } from '../../../masterBitgoExpress/handlers/handleSendMany';
import coinFactory from '../../../shared/coinFactory';
import {
  BitGoAPITestHarness,
  buildEcdsaMpcv2TxRequest,
  nockEcdsaMpcv2SigningFlow,
} from './testUtils';

describe('createEddsaMPCv2CustomSigners', () => {
  const source = 'user' as const;
  const commonKeychain = 'mock-common-keychain';

  const txRequestFixture = { txRequestId: '123456' } as unknown as TxRequest; // minimal fixture: generators forward txRequest opaquely

  const mockRound1Response: SignMpcV2Round1Response = {
    signatureShareRound1: { from: 'user', to: 'bitgo', share: 'mock-round1-share' },
    userGpgPubKey: 'mock-user-gpg-pub-key',
    encryptedRound1Session: 'mock-encrypted-round1-session',
    encryptedUserGpgPrvKey: 'mock-encrypted-user-gpg-prv-key',
    encryptedDataKey: 'mock-encrypted-data-key',
  };
  const mockRound2Response: SignMpcV2Round2Response = {
    signatureShareRound2: { from: 'user', to: 'bitgo', share: 'mock-round2-share' },
    encryptedRound2Session: 'mock-encrypted-round2-session',
  };
  const mockRound3Response = {
    signatureShareRound3: { from: 'user', to: 'bitgo', share: 'mock-round3-share' },
  };

  type AwmCall = {
    method: string;
    source: string;
    commonKeychain: string;
    params: Record<string, unknown>;
  };

  let awmCalls: AwmCall[];
  let awmClient: AdvancedWalletManagerClient;

  beforeEach(() => {
    awmCalls = [];
    // Minimal stub: only the three MPCv2 sign methods are exercised here.
    awmClient = {
      signMPCv2Round1: async (
        source: 'user' | 'backup',
        commonKeychain: string,
        params: Record<string, unknown>,
      ) => {
        awmCalls.push({ method: 'signMPCv2Round1', source, commonKeychain, params });
        return mockRound1Response;
      },
      signMPCv2Round2: async (
        source: 'user' | 'backup',
        commonKeychain: string,
        params: Record<string, unknown>,
      ) => {
        awmCalls.push({ method: 'signMPCv2Round2', source, commonKeychain, params });
        return mockRound2Response;
      },
      signMPCv2Round3: async (
        source: 'user' | 'backup',
        commonKeychain: string,
        params: Record<string, unknown>,
      ) => {
        awmCalls.push({ method: 'signMPCv2Round3', source, commonKeychain, params });
        return mockRound3Response;
      },
    } as unknown as AdvancedWalletManagerClient;
  });

  it('round 1 generator calls AWM with curveType eddsa', async () => {
    const { customEddsaMPCv2Round1Generator } = createEddsaMPCv2CustomSigners(
      awmClient,
      source,
      commonKeychain,
    );

    const response = await customEddsaMPCv2Round1Generator({ txRequest: txRequestFixture });

    response.should.equal(mockRound1Response);
    awmCalls.should.have.length(1);
    awmCalls[0].method.should.equal('signMPCv2Round1');
    awmCalls[0].source.should.equal(source);
    awmCalls[0].commonKeychain.should.equal(commonKeychain);
    awmCalls[0].params.should.have.property('curveType', 'eddsa');
    awmCalls[0].params.should.have.property('txRequest', txRequestFixture);
  });

  it('round 2 generator forwards round 1 encrypted state and curveType eddsa', async () => {
    const { customEddsaMPCv2Round1Generator, customEddsaMPCv2Round2Generator } =
      createEddsaMPCv2CustomSigners(awmClient, source, commonKeychain);

    await customEddsaMPCv2Round1Generator({ txRequest: txRequestFixture });
    const response = await customEddsaMPCv2Round2Generator({
      txRequest: txRequestFixture,
      bitgoPublicGpgKey: 'mock-bitgo-gpg-key',
      encryptedUserGpgPrvKey: 'caller-encrypted-user-gpg-prv-key',
      encryptedRound1Session: 'caller-encrypted-round1-session',
    });

    response.should.equal(mockRound2Response);
    awmCalls.should.have.length(2);
    awmCalls[1].method.should.equal('signMPCv2Round2');
    awmCalls[1].params.should.have.property('curveType', 'eddsa');
    awmCalls[1].params.should.have.property(
      'encryptedDataKey',
      mockRound1Response.encryptedDataKey,
    );
    awmCalls[1].params.should.have.property(
      'encryptedRound1Session',
      mockRound1Response.encryptedRound1Session,
    );
    awmCalls[1].params.should.have.property(
      'encryptedUserGpgPrvKey',
      mockRound1Response.encryptedUserGpgPrvKey,
    );
    awmCalls[1].params.should.have.property('bitgoPublicGpgKey', 'mock-bitgo-gpg-key');
  });

  it('round 3 generator forwards round 1 + round 2 encrypted state and curveType eddsa', async () => {
    const {
      customEddsaMPCv2Round1Generator,
      customEddsaMPCv2Round2Generator,
      customEddsaMPCv2Round3Generator,
    } = createEddsaMPCv2CustomSigners(awmClient, source, commonKeychain);

    await customEddsaMPCv2Round1Generator({ txRequest: txRequestFixture });
    await customEddsaMPCv2Round2Generator({
      txRequest: txRequestFixture,
      bitgoPublicGpgKey: 'mock-bitgo-gpg-key',
      encryptedUserGpgPrvKey: 'caller-encrypted-user-gpg-prv-key',
      encryptedRound1Session: 'caller-encrypted-round1-session',
    });
    const response = await customEddsaMPCv2Round3Generator({
      txRequest: txRequestFixture,
      bitgoPublicGpgKey: 'mock-bitgo-gpg-key',
      encryptedUserGpgPrvKey: 'caller-encrypted-user-gpg-prv-key',
      encryptedRound2Session: 'caller-encrypted-round2-session',
    });

    response.should.equal(mockRound3Response);
    awmCalls.should.have.length(3);
    awmCalls[2].method.should.equal('signMPCv2Round3');
    awmCalls[2].params.should.have.property('curveType', 'eddsa');
    awmCalls[2].params.should.have.property(
      'encryptedDataKey',
      mockRound1Response.encryptedDataKey,
    );
    awmCalls[2].params.should.have.property(
      'encryptedRound2Session',
      mockRound2Response.encryptedRound2Session,
    );
    awmCalls[2].params.should.have.property(
      'encryptedUserGpgPrvKey',
      mockRound1Response.encryptedUserGpgPrvKey,
    );
  });

  it('round 2 before round 1 throws the expected error', async () => {
    const { customEddsaMPCv2Round2Generator } = createEddsaMPCv2CustomSigners(
      awmClient,
      source,
      commonKeychain,
    );

    await customEddsaMPCv2Round2Generator({
      txRequest: txRequestFixture,
      bitgoPublicGpgKey: 'mock-bitgo-gpg-key',
      encryptedUserGpgPrvKey: 'caller-encrypted-user-gpg-prv-key',
      encryptedRound1Session: 'caller-encrypted-round1-session',
    }).should.be.rejectedWith('Round 1 must be completed before Round 2');
    awmCalls.should.have.length(0);
  });

  it('round 3 before round 2 throws the expected error', async () => {
    const { customEddsaMPCv2Round1Generator, customEddsaMPCv2Round3Generator } =
      createEddsaMPCv2CustomSigners(awmClient, source, commonKeychain);

    await customEddsaMPCv2Round1Generator({ txRequest: txRequestFixture });
    await customEddsaMPCv2Round3Generator({
      txRequest: txRequestFixture,
      bitgoPublicGpgKey: 'mock-bitgo-gpg-key',
      encryptedUserGpgPrvKey: 'caller-encrypted-user-gpg-prv-key',
      encryptedRound2Session: 'caller-encrypted-round2-session',
    }).should.be.rejectedWith('Round 2 must be completed before Round 3');
    awmCalls.should.have.length(1);
  });
});
describe('signAndSendEddsaMPCv2FromTxRequest', () => {
  let bitgo: BitGoAPI;
  let wallet: Wallet;
  let awmClient: AdvancedWalletManagerClient;
  let reqId: IRequestTracer;
  const bitgoApiUrl = Environments.local.uri;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const coin = 'tsol'; // Use tsol for EdDSA testing

  before(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    bitgo = new BitGoAPI({ env: 'local' });
    wallet = {
      id: () => 'test-wallet-id',
      baseCoin: {
        getMPCAlgorithm: () => 'eddsa',
      },
      multisigTypeVersion: () => 'MPCv2',
    } as unknown as Wallet;
    awmClient = new AdvancedWalletManagerClient(
      {
        advancedWalletManagerUrl,
        awmServerCaCert: 'dummy-cert',
        tlsMode: 'disabled',
        clientCertAllowSelfSigned: true,
      } as unknown as ConstructorParameters<typeof AdvancedWalletManagerClient>[0],
      coin,
    );
    reqId = new RequestTracer();
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
    BitGoAPITestHarness.clearConstantsCache();
  });

  after(() => {
    nock.enableNetConnect();
  });

  it('should successfully sign an EdDSA MPCv2 transaction', async () => {
    const txRequestData = buildEcdsaMpcv2TxRequest('pendingUserSignature');
    const txRequest = txRequestData as TxRequest;

    const bitgoEddsaMpcv2Key = await openpgpUtils.generateGPGKeyPair('ed25519');

    nock(bitgoApiUrl)
      .persist()
      .get('/api/v1/client/constants')
      .reply(200, {
        constants: {
          mpc: {
            bitgoEddsaMpcv2PublicKey: bitgoEddsaMpcv2Key.publicKey,
            bitgoPublicKey: bitgoEddsaMpcv2Key.publicKey,
          },
        },
      });

    const sendResponse = { ...txRequestData, state: 'signed' };
    const nocks = nockEcdsaMpcv2SigningFlow({
      coin,
      bitgoApiUrl,
      advancedWalletManagerUrl,
      sendResponse,
      expectedCurveType: 'eddsa',
    });

    const result = await signAndSendEddsaMPCv2FromTxRequest(
      bitgo,
      wallet,
      txRequest,
      awmClient,
      'user',
      'mock-common-keychain',
      reqId,
    );

    result.should.eql(sendResponse);

    nocks.round1SignNock.done();
    nocks.round2SignNock.done();
    nocks.round3SignNock.done();
    nocks.sendTxNock.done();
    nocks.awmRound1Nock.done();
    nocks.awmRound2Nock.done();
    nocks.awmRound3Nock.done();
  });
});

describe('createMPCSendParamsWithCustomSigningFns EdDSA dispatch', () => {
  const coin = 'tsol';

  function makeReq(decoded: Record<string, unknown>) {
    return {
      params: { coin },
      decoded,
      bitgo: {} as never,
    } as unknown as Parameters<typeof createMPCSendParamsWithCustomSigningFns>[0];
  }

  afterEach(() => {
    sinon.restore();
  });

  it('returns MPCv2 signing functions for an EdDSA MPCv2 wallet', async () => {
    sinon.stub(coinFactory, 'getCoin').resolves({
      getMPCAlgorithm: () => 'eddsa',
    } as never);
    const wallet = { multisigTypeVersion: () => 'MPCv2' } as unknown as Wallet;
    const awmClientStub = {} as unknown as AdvancedWalletManagerClient;

    const params = await createMPCSendParamsWithCustomSigningFns(
      makeReq({ recipients: [] }),
      wallet,
      awmClientStub,
      { source: 'user', commonKeychain: 'mock-common-keychain' } as never,
    );

    params.should.have.property('customEddsaMPCv2SigningRound1GenerationFunction');
    params.should.have.property('customEddsaMPCv2SigningRound2GenerationFunction');
    params.should.have.property('customEddsaMPCv2SigningRound3GenerationFunction');
    params.should.not.have.property('customCommitmentGeneratingFunction');
    params.should.not.have.property('customRShareGeneratingFunction');
    params.should.not.have.property('customGShareGeneratingFunction');
  });

  it('returns MPCv1 signing functions for an EdDSA MPCv1 wallet', async () => {
    sinon.stub(coinFactory, 'getCoin').resolves({
      getMPCAlgorithm: () => 'eddsa',
    } as never);
    const wallet = {} as unknown as Wallet;
    const awmClientStub = {} as unknown as AdvancedWalletManagerClient;

    const params = await createMPCSendParamsWithCustomSigningFns(
      makeReq({ recipients: [] }),
      wallet,
      awmClientStub,
      { source: 'user', commonKeychain: 'mock-common-keychain' } as never,
    );

    params.should.have.property('customCommitmentGeneratingFunction');
    params.should.have.property('customRShareGeneratingFunction');
    params.should.have.property('customGShareGeneratingFunction');
    params.should.not.have.property('customEddsaMPCv2SigningRound1GenerationFunction');
    params.should.not.have.property('customEddsaMPCv2SigningRound2GenerationFunction');
    params.should.not.have.property('customEddsaMPCv2SigningRound3GenerationFunction');
  });
});
