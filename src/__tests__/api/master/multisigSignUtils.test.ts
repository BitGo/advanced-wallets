import 'should';
import assert from 'assert';
import nock from 'nock';
import sinon from 'sinon';
import { Keychain, PrebuildTransactionResult } from '@bitgo-beta/sdk-core';
import {
  buildMultisigSignBody,
  parseMultisigSignJobContext,
  SignedMultisigTransactionSchema,
  submitMultisigSignJob,
} from '../../../masterBitgoExpress/handlers/utils/multisigSignUtils';
import { AppMode, KeySource, MasterExpressConfig } from '../../../shared/types';
import { BitGoRequest } from '../../../types/request';
import { DEFAULT_ASYNC_MODE_CONFIG } from './testUtils';
import { OsoBridgeClient } from '../../../masterBitgoExpress/clients/bridgeClient';

describe('multisigSignUtils', () => {
  const bridgeUrl = 'http://bridge.invalid';
  const coin = 'tbtc';
  const txPrebuild = {
    txHex: '70736274ff',
    txInfo: { nP2SHInputs: 0, nSegwitInputs: 1, nOutputs: 1 },
    walletId: 'test-wallet-id',
  } as PrebuildTransactionResult;
  const userPub =
    'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';

  describe('buildMultisigSignBody', () => {
    it('builds the AWM multisig sign payload', () => {
      const body = buildMultisigSignBody({
        source: 'user',
        signingKeychain: { pub: userPub, source: 'user' } as Keychain,
        txPrebuilt: txPrebuild,
        walletPubs: [userPub, 'backup-pub', 'bitgo-pub'],
      });

      body.should.eql({
        source: 'user',
        pub: userPub,
        txPrebuild,
        walletPubs: [userPub, 'backup-pub', 'bitgo-pub'],
      });
    });

    it('omits walletPubs when not provided', () => {
      const body = buildMultisigSignBody({
        source: 'backup',
        signingKeychain: { pub: userPub, source: 'backup' } as Keychain,
        txPrebuilt: txPrebuild,
      });

      body.should.eql({
        source: 'backup',
        pub: userPub,
        txPrebuild,
      });
      assert(!('walletPubs' in body));
    });

    it('throws when signing keychain pub is missing', () => {
      (() =>
        buildMultisigSignBody({
          source: 'user',
          signingKeychain: { source: 'user' } as Keychain,
          txPrebuilt: txPrebuild,
        })).should.throw(/Signing keychain pub not found for user/);
    });
  });

  describe('submitMultisigSignJob', () => {
    afterEach(() => {
      sinon.restore();
      nock.cleanAll();
    });

    function makeAsyncReq(): BitGoRequest<MasterExpressConfig> {
      return {
        config: {
          appMode: AppMode.MASTER_EXPRESS,
          asyncModeConfig: {
            enabled: true,
            awmAsyncUrl: bridgeUrl,
            pollIntervalInMs: 30000,
            jobTtlInSeconds: 3600,
            jobTtlMpcInSeconds: 7200,
          },
        } as MasterExpressConfig,
        bridgeClient: new OsoBridgeClient(bridgeUrl, 60000),
      } as unknown as BitGoRequest<MasterExpressConfig>;
    }

    it('returns null when async mode is disabled', async () => {
      const req = {
        config: { asyncModeConfig: DEFAULT_ASYNC_MODE_CONFIG },
      } as BitGoRequest<MasterExpressConfig>;

      const result = await submitMultisigSignJob(
        req,
        coin,
        {
          source: 'user',
          pub: userPub,
          txPrebuild,
        },
        {
          walletId: 'test-wallet-id',
          wpSubmitKind: 'sendMany',
          wpSubmitParams: { recipients: [] },
        },
      );

      assert.strictEqual(result, null);
    });

    it('submits multisig_sign to the bridge with correct path and headers', async () => {
      const jobId = 'job-123';
      const signBody = buildMultisigSignBody({
        source: 'user',
        signingKeychain: { pub: userPub, source: 'user' } as Keychain,
        txPrebuilt: txPrebuild,
      });
      const jobContext = {
        walletId: 'test-wallet-id',
        wpSubmitKind: 'sendMany' as const,
        wpSubmitParams: { recipients: [{ address: 'tb1qtest', amount: '100000' }] },
      };

      const bridgeNock = nock(bridgeUrl)
        .post(`/api/${coin}/multisig/sign`, (body) => {
          body.should.eql({ ...signBody, ...jobContext });
          return true;
        })
        .matchHeader('X-OSO-Source', KeySource.USER)
        .matchHeader('X-OSO-Operation', 'multisig_sign')
        .reply(202, { jobId });

      const result = await submitMultisigSignJob(makeAsyncReq(), coin, signBody, jobContext);
      assert(result);
      result.should.eql({ jobId, status: 'pending' });
      bridgeNock.done();
    });
  });

  describe('SignedMultisigTransactionSchema', () => {
    it('accepts a top-level txHex', () => {
      SignedMultisigTransactionSchema.parse({ txHex: 'signed-tx-hex' }).should.eql({
        txHex: 'signed-tx-hex',
      });
    });

    it('accepts halfSigned.txHex from UTXO user signing', () => {
      SignedMultisigTransactionSchema.parse({
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: userPub,
      }).should.eql({
        halfSigned: { txHex: 'signed-tx-hex' },
        source: 'user',
        pub: userPub,
      });
    });

    it('accepts halfSigned.signature from ETH-style signing', () => {
      SignedMultisigTransactionSchema.parse({
        halfSigned: {
          signature: '0xabc',
          operationHash: '0xdef',
          recipients: [{ address: '0x123', amount: '1000' }],
        },
      }).should.eql({
        halfSigned: {
          signature: '0xabc',
          operationHash: '0xdef',
          recipients: [{ address: '0x123', amount: '1000' }],
        },
      });
    });

    it('rejects bodies missing txHex and halfSigned', () => {
      (() => SignedMultisigTransactionSchema.parse({ bad: 'shape' })).should.throw(
        /expected txHex or halfSigned/,
      );
    });
  });

  describe('parseMultisigSignJobContext', () => {
    it('parses walletId, wpSubmitKind, and wpSubmitParams from job body', () => {
      parseMultisigSignJobContext({
        walletId: 'test-wallet-id',
        wpSubmitKind: 'sendMany',
        wpSubmitParams: { recipients: [] },
        source: 'user',
        pub: userPub,
      }).should.eql({
        walletId: 'test-wallet-id',
        wpSubmitKind: 'sendMany',
        wpSubmitParams: { recipients: [] },
      });
    });

    it('throws when wpSubmitKind is missing or unsupported', () => {
      (() =>
        parseMultisigSignJobContext({
          walletId: 'test-wallet-id',
          wpSubmitParams: { recipients: [] },
        })).should.throw(/unsupported wpSubmitKind/);

      (() =>
        parseMultisigSignJobContext({
          walletId: 'test-wallet-id',
          wpSubmitKind: 'accelerate',
          wpSubmitParams: { recipients: [] },
        })).should.throw(/unsupported wpSubmitKind: accelerate/);
    });
  });
});
