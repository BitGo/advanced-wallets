import 'should';
import nock from 'nock';
import * as sinon from 'sinon';
import {
  Environments,
  IRequestTracer,
  openpgpUtils,
  RequestTracer,
  TxRequest,
  Wallet,
} from '@bitgo-beta/sdk-core';
import { BitGoAPI } from '@bitgo-beta/sdk-api';
import { AdvancedWalletManagerClient } from '../../../masterBitgoExpress/clients/advancedWalletManagerClient';
import { signAndSendEcdsaMPCv2FromTxRequest } from '../../../masterBitgoExpress/handlers/ecdsa';
import {
  BitGoAPITestHarness,
  buildEcdsaMpcv2TxRequest,
  nockEcdsaMpcv2SigningFlow,
} from './testUtils';

describe('Ecdsa Signing Handler', () => {
  let bitgo: BitGoAPI;
  let wallet: Wallet;
  let awmClient: AdvancedWalletManagerClient;
  let reqId: IRequestTracer;
  const bitgoApiUrl = Environments.local.uri;
  const advancedWalletManagerUrl = 'http://advancedwalletmanager.invalid';
  const coin = 'hteth'; // Use hteth for ECDSA testing
  const walletId = 'test-wallet-id';

  before(() => {
    // Disable all real network connections
    nock.disableNetConnect();
  });

  beforeEach(() => {
    bitgo = new BitGoAPI({ env: 'local' });
    wallet = {
      id: () => 'test-wallet-id',
      baseCoin: {
        getMPCAlgorithm: () => 'ecdsa',
      },
      multisigTypeVersion: () => 2,
    } as unknown as Wallet;
    awmClient = new AdvancedWalletManagerClient(
      {
        advancedWalletManagerUrl,
        awmServerCaCert: 'dummy-cert',
        tlsMode: 'disabled',
        clientCertAllowSelfSigned: true,
      } as any,
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
    // Re-enable network connections after tests
    nock.enableNetConnect();
  });

  it('should successfully sign an ECDSA MPCv2 transaction', async () => {
    const txRequestData = buildEcdsaMpcv2TxRequest('pendingUserSignature');
    const txRequest = txRequestData as TxRequest;
    const userPubKey = 'test-user-pub-key';

    const bitgoGpgKey = await openpgpUtils.generateGPGKeyPair('secp256k1');
    const bitgoEd25519Key = await openpgpUtils.generateGPGKeyPair('ed25519');

    nock(bitgoApiUrl)
      .persist()
      .get('/api/v1/client/constants')
      .reply(200, {
        constants: {
          mpc: {
            bitgoMPCv2PublicKey: bitgoGpgKey.publicKey,
            bitgoPublicKey: bitgoEd25519Key.publicKey,
          },
        },
      });

    const sendResponse = { ...txRequestData, state: 'signed' };
    const nocks = nockEcdsaMpcv2SigningFlow({
      coin,
      bitgoApiUrl,
      advancedWalletManagerUrl,
      sendResponse,
      walletId,
      userGpgPubKey: bitgoGpgKey.publicKey,
    });

    const result = await signAndSendEcdsaMPCv2FromTxRequest(
      bitgo,
      wallet,
      txRequest,
      awmClient,
      'user',
      userPubKey,
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
