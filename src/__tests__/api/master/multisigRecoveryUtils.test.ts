import 'should';
import assert from 'assert';
import nock from 'nock';
import {
  parseSignedRecoveryTransaction,
  submitMultisigRecoveryJob,
} from '../../../masterBitgoExpress/handlers/utils/multisigRecoveryUtils';
import { SignedMultisigTransactionSchema } from '../../../masterBitgoExpress/handlers/utils/multisigSignUtils';
import { AppMode, KeySource, MasterExpressConfig } from '../../../shared/types';
import { BitGoRequest } from '../../../types/request';
import { DEFAULT_ASYNC_MODE_CONFIG } from './testUtils';
import { OsoBridgeClient } from '../../../masterBitgoExpress/clients/bridgeClient';

describe('multisigRecoveryUtils', () => {
  const bridgeUrl = 'http://bridge.invalid';
  const coin = 'tbtc';
  const userPub =
    'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
  const backupPub =
    'xpub661MyMwAqRbcEvJQx6spkkHLRgtjxmVdyDSvbDt2m9NFpbkHdcu5WJsHHHqFxNATbNHnhMWJiwckoMqF75EpcNhU9xeVM4oDS7urM3os4BH';
  const recoveryBody = {
    userPub,
    backupPub,
    bitgoPub: 'xpub_bitgo',
    unsignedSweepPrebuildTx: { txHex: 'unsigned-tx-hex' },
    walletContractAddress: '',
  };

  describe('submitMultisigRecoveryJob', () => {
    afterEach(() => {
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

      const result = await submitMultisigRecoveryJob(req, coin, recoveryBody);
      assert.strictEqual(result, null);
    });

    it('submits multisig_recovery to the bridge with correct path and headers', async () => {
      const jobId = 'job-123';
      const bridgeNock = nock(bridgeUrl)
        .post(`/api/${coin}/multisig/recovery`, (body) => {
          body.should.eql(recoveryBody);
          return true;
        })
        .matchHeader('X-OSO-Source', KeySource.USER)
        .matchHeader('X-OSO-Operation', 'multisig_recovery')
        .reply(202, { jobId });

      const result = await submitMultisigRecoveryJob(makeAsyncReq(), coin, recoveryBody);
      assert(result);
      result.should.eql({ jobId, status: 'pending' });
      bridgeNock.done();
    });

    it('defaults to the user source when sources is omitted', async () => {
      const jobId = 'job-123';
      const bridgeNock = nock(bridgeUrl)
        .post(`/api/${coin}/multisig/recovery`)
        .matchHeader('X-OSO-Source', KeySource.USER)
        .reply(202, { jobId });

      const result = await submitMultisigRecoveryJob(makeAsyncReq(), coin, recoveryBody);
      assert(result);
      result.should.eql({ jobId, status: 'pending' });
      bridgeNock.done();
    });

    it('submits with user,backup sources for split-AWM recovery', async () => {
      const jobId = 'job-456';
      const bridgeNock = nock(bridgeUrl)
        .post(`/api/${coin}/multisig/recovery`, (body) => {
          body.should.eql(recoveryBody);
          return true;
        })
        .matchHeader('X-OSO-Source', `${KeySource.USER},${KeySource.BACKUP}`)
        .matchHeader('X-OSO-Operation', 'multisig_recovery')
        .reply(202, { jobId });

      const result = await submitMultisigRecoveryJob(makeAsyncReq(), coin, recoveryBody, [
        KeySource.USER,
        KeySource.BACKUP,
      ]);
      assert(result);
      result.should.eql({ jobId, status: 'pending' });
      bridgeNock.done();
    });
  });

  describe('parseSignedRecoveryTransaction', () => {
    it('accepts a top-level txHex', () => {
      parseSignedRecoveryTransaction({ txHex: 'signed-tx-hex' }).should.eql({
        txHex: 'signed-tx-hex',
      });
    });

    it('rejects bodies missing txHex and halfSigned', () => {
      (() => parseSignedRecoveryTransaction({ bad: 'shape' })).should.throw(
        /expected txHex or halfSigned/,
      );
    });

    it('uses the same schema as multisig sign responses', () => {
      const body = { halfSigned: { txHex: 'signed-tx-hex' } };
      parseSignedRecoveryTransaction(body).should.eql(
        SignedMultisigTransactionSchema.parse(body) as { halfSigned: { txHex: string } },
      );
    });
  });
});
