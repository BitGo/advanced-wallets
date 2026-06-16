import 'should';
import assert from 'assert';
import { startServices, IntegServices } from './helpers/setup';
import { LOCALHOST } from './helpers/servers';
import { makeBridgeJob } from '../api/master/testUtils';

const JOB_ID = 'test-job-id';

describe('GET /api/v1/advancedwallet/job/:jobId: ASYNC mode', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices({ asyncMode: true });
  });

  after(async () => {
    await services.teardown();
  });

  beforeEach(() => {
    assert(services.bridge, 'bridge must be defined in async mode');
    services.bridge.calls.length = 0;
    services.bridge.clearJobs();
  });

  it('returns awaiting_client when bridge status is awaiting_oso', async () => {
    assert(services.bridge, 'bridge must be defined in async mode');
    services.bridge.setJob(makeBridgeJob({ status: 'awaiting_oso' }, JOB_ID));

    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/advancedwallet/job/${JOB_ID}`,
      { headers: { Authorization: 'Bearer test-token' } },
    );

    res.status.should.equal(200);
    const body = await res.json();
    body.should.eql({ jobId: JOB_ID, status: 'awaiting_client' });
  });

  it('returns 404 when bridge job is not found', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/advancedwallet/job/${JOB_ID}`,
      { headers: { Authorization: 'Bearer test-token' } },
    );

    res.status.should.equal(404);
    const body = await res.json();
    body.error.should.equal('NotFoundError');
    body.details.should.equal('job not found');
  });
});

describe('GET /api/v1/advancedwallet/job/:jobId: sync mode', () => {
  let services: IntegServices;

  before(async () => {
    services = await startServices();
  });

  after(async () => {
    await services.teardown();
  });

  it('returns 400 when async mode is disabled', async () => {
    const res = await fetch(
      `http://${LOCALHOST}:${services.mbePort}/api/v1/advancedwallet/job/${JOB_ID}`,
      { headers: { Authorization: 'Bearer test-token' } },
    );

    res.status.should.equal(400);
    const body = await res.json();
    body.error.should.equal('BadRequestError');
    body.details.should.equal('Job polling requires async mode');
  });
});
