import nock from 'nock';
import 'should';
import { OsoBridgeClient } from '../../../masterBitgoExpress/clients/bridgeClient';
import { BridgeJobResponse } from '../../../masterBitgoExpress/clients/bridgeClient.types';
import { KeySource } from '../../../shared/types';

const BASE_URL = 'http://bridge.invalid';
const TIMEOUT = 60000;

const mockJob: BridgeJobResponse = {
  jobId: 'job-123',
  status: 'awaiting_bitgo',
  version: 1,
  coin: 'tbtc',
  operationType: 'multisig_sign',
  request: {
    endpoint: '/api/tbtc/multisig/sign',
    method: 'POST',
    body: {},
  },
  createdAt: 1717880400,
  updatedAt: 1717880400,
  ttl: 3600,
};

describe('OsoBridgeClient', () => {
  let client: OsoBridgeClient;

  before(() => {
    nock.disableNetConnect();
    client = new OsoBridgeClient(BASE_URL, TIMEOUT);
  });

  after(() => {
    nock.enableNetConnect();
  });

  afterEach(() => nock.cleanAll());

  describe('constructor', () => {
    it('throws when url is empty', () => {
      (() => new OsoBridgeClient('', TIMEOUT)).should.throw(
        'OsoBridgeClient: awmAsyncUrl is required',
      );
    });

    it('strips trailing slash from url', () => {
      const c = new OsoBridgeClient(`${BASE_URL}/`, TIMEOUT);
      nock(BASE_URL).get('/health').reply(200, { status: 'ok' });
      return c.health().should.be.fulfilled();
    });
  });

  describe('submit()', () => {
    it('sets X-OSO-Source for a single source', async () => {
      const n = nock(BASE_URL)
        .post('/api/tbtc/multisig/sign')
        .matchHeader('x-oso-source', 'user')
        .reply(202, { jobId: 'job-123' });

      await client.submit({
        path: '/api/tbtc/multisig/sign',
        body: { foo: 'bar' },
        sources: [KeySource.USER],
        operationType: 'multisig_sign',
      });

      n.done();
    });

    it('sets X-OSO-Source as comma-joined for multiple sources', async () => {
      const n = nock(BASE_URL)
        .post('/api/tbtc/key/independent')
        .matchHeader('x-oso-source', 'user,backup')
        .reply(202, { jobId: 'job-456' });

      await client.submit({
        path: '/api/tbtc/key/independent',
        body: { foo: 'bar' },
        sources: [KeySource.USER, KeySource.BACKUP],
        operationType: 'multisig_keygen',
      });

      n.done();
    });

    it('sets X-OSO-Operation header', async () => {
      const n = nock(BASE_URL)
        .post('/api/tbtc/multisig/sign')
        .matchHeader('x-oso-operation', 'multisig_sign')
        .reply(202, { jobId: 'job-123' });

      await client.submit({
        path: '/api/tbtc/multisig/sign',
        body: { foo: 'bar' },
        sources: [KeySource.USER],
        operationType: 'multisig_sign',
      });

      n.done();
    });

    it('sets X-Idempotency-Key when provided', async () => {
      const n = nock(BASE_URL)
        .post('/api/tbtc/multisig/sign')
        .matchHeader('x-idempotency-key', 'idem-key-abc')
        .reply(202, { jobId: 'job-123' });

      await client.submit({
        path: '/api/tbtc/multisig/sign',
        body: { foo: 'bar' },
        sources: [KeySource.USER],
        operationType: 'multisig_sign',
        idempotencyKey: 'idem-key-abc',
      });

      n.done();
    });

    it('omits X-Idempotency-Key when not provided', async () => {
      const n = nock(BASE_URL)
        .post('/api/tbtc/multisig/sign')
        .matchHeader('x-idempotency-key', (val) => val === undefined)
        .reply(202, { jobId: 'job-123' });

      await client.submit({
        path: '/api/tbtc/multisig/sign',
        body: { foo: 'bar' },
        sources: [KeySource.USER],
        operationType: 'multisig_sign',
      });

      n.done();
    });

    it('forwards body as-is', async () => {
      const body = { signablePayload: 'deadbeef', walletId: 'w-123' };
      const n = nock(BASE_URL)
        .post('/api/tbtc/multisig/sign', body)
        .reply(202, { jobId: 'job-123' });

      await client.submit({
        path: '/api/tbtc/multisig/sign',
        body,
        sources: [KeySource.USER],
        operationType: 'multisig_sign',
      });

      n.done();
    });

    it('returns jobId from response', async () => {
      nock(BASE_URL).post('/api/tbtc/multisig/sign').reply(202, { jobId: 'job-789' });

      const result = await client.submit({
        path: '/api/tbtc/multisig/sign',
        body: {},
        sources: [KeySource.USER],
        operationType: 'multisig_sign',
      });

      result.should.have.property('jobId', 'job-789');
    });

    it('normalizes path without leading slash', async () => {
      const n = nock(BASE_URL).post('/api/tbtc/multisig/sign').reply(202, { jobId: 'job-123' });

      await client.submit({
        path: 'api/tbtc/multisig/sign',
        body: {},
        sources: [KeySource.USER],
        operationType: 'multisig_sign',
      });

      n.done();
    });

    it('throws on invalid response shape', async () => {
      nock(BASE_URL).post('/api/tbtc/multisig/sign').reply(202, { notAJobId: true });

      await client
        .submit({
          path: '/api/tbtc/multisig/sign',
          body: {},
          sources: [KeySource.USER],
          operationType: 'multisig_sign',
        })
        .should.be.rejectedWith(/bridge returned unexpected response for submit/);
    });

    it('throws on 400', async () => {
      nock(BASE_URL).post('/api/tbtc/multisig/sign').reply(400, { message: 'bad input' });

      await client
        .submit({
          path: '/api/tbtc/multisig/sign',
          body: {},
          sources: [KeySource.USER],
          operationType: 'multisig_sign',
        })
        .should.be.rejectedWith('bad input');
    });
  });

  describe('getJob()', () => {
    it('GETs /job/:jobId and returns BridgeJobResponse', async () => {
      const n = nock(BASE_URL).get('/job/job-123').reply(200, mockJob);

      const result = await client.getJob('job-123');

      result.should.have.property('jobId', 'job-123');
      result.should.have.property('status', 'awaiting_bitgo');
      n.done();
    });

    it('throws on 404', async () => {
      nock(BASE_URL).get('/job/missing').reply(404, { message: 'job not found' });

      await client.getJob('missing').should.be.rejectedWith('job not found');
    });

    it('throws on invalid response shape', async () => {
      nock(BASE_URL).get('/job/job-123').reply(200, { bad: 'shape' });

      await client
        .getJob('job-123')
        .should.be.rejectedWith(/bridge returned unexpected response for getJob/);
    });
  });

  describe('updateJob()', () => {
    it('PATCHes /job/:jobId with correct body', async () => {
      const n = nock(BASE_URL)
        .patch('/job/job-123', { version: 1, status: 'complete', result: { txid: 'abc' } })
        .reply(204);

      await client.updateJob({
        jobId: 'job-123',
        version: 1,
        status: 'complete',
        result: { txid: 'abc' },
      });

      n.done();
    });

    it('returns void on 204', async () => {
      nock(BASE_URL).patch('/job/job-123').reply(204);

      const result = await client.updateJob({
        jobId: 'job-123',
        version: 1,
        status: 'failed',
        error: 'timeout',
      });

      (result === undefined).should.be.true();
    });

    it('throws on 409', async () => {
      nock(BASE_URL).patch('/job/job-123').reply(409, { message: 'version conflict' });

      await client
        .updateJob({ jobId: 'job-123', version: 1, status: 'complete' })
        .should.be.rejectedWith('version conflict');
    });
  });

  describe('listJobs()', () => {
    it('GETs /jobs without query when status omitted', async () => {
      const n = nock(BASE_URL)
        .get('/jobs')
        .reply(200, { jobs: [mockJob] });

      const result = await client.listJobs({});

      result.jobs.should.have.length(1);
      result.jobs[0].should.have.property('jobId', 'job-123');
      n.done();
    });

    it('GETs /jobs?status=awaiting_bitgo when status provided', async () => {
      const n = nock(BASE_URL)
        .get('/jobs')
        .query({ status: 'awaiting_bitgo' })
        .reply(200, { jobs: [mockJob] });

      const result = await client.listJobs({ status: 'awaiting_bitgo' });

      result.jobs.should.have.length(1);
      n.done();
    });

    it('returns empty array when jobs list is empty', async () => {
      nock(BASE_URL).get('/jobs').reply(200, { jobs: [] });

      const result = await client.listJobs({});

      result.jobs.should.have.length(0);
    });

    it('throws on malformed envelope missing jobs array', async () => {
      nock(BASE_URL)
        .get('/jobs')
        .reply(200, { data: [mockJob] });

      await client
        .listJobs({})
        .should.be.rejectedWith(/bridge returned unexpected envelope for listJobs/);
    });
  });

  describe('health()', () => {
    it('GETs /health and returns body', async () => {
      const n = nock(BASE_URL).get('/health').reply(200, { status: 'ok' });

      const result = await client.health();

      result.should.have.property('status', 'ok');
      n.done();
    });
  });

  describe('error handling', () => {
    it('throws on 401', async () => {
      nock(BASE_URL).get('/job/job-123').reply(401, { message: 'unauthorized' });

      await client.getJob('job-123').should.be.rejectedWith('unauthorized');
    });

    it('throws with status code on unexpected status', async () => {
      nock(BASE_URL).get('/job/job-123').reply(503, { message: 'service unavailable' });

      await client
        .getJob('job-123')
        .should.be.rejectedWith(
          /OsoBridgeClient returned unexpected response \[503\]: service unavailable/,
        );
    });
  });
});
