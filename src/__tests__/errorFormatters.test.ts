import 'should';
import assert from 'assert';
import sinon from 'sinon';
import { WrappedRequest } from '@api-ts/typed-express-router';
import logger from '../shared/logger';
import { customEncodeErrorFormatter } from '../shared/errorFormatters';

function makeFakeRequest(): WrappedRequest {
  return {
    method: 'POST',
    originalUrl: '/api/v1/tbtc/advancedwallet/generate',
    apiName: 'v1.wallet.generate',
  } as unknown as WrappedRequest;
}

describe('customEncodeErrorFormatter', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('logs the real validation error with request context and stack, and returns it in the response body', () => {
    const loggerErrorSpy = sinon.spy(logger, 'error');
    const req = makeFakeRequest();
    const err = new Error('response does not match expected type SomeResponseCodec');

    const body = customEncodeErrorFormatter(err, req) as Record<string, unknown>;

    assert.equal(body.error, 'Internal Server Error');
    assert.equal(body.details, 'response does not match expected type SomeResponseCodec');

    assert.equal(loggerErrorSpy.callCount, 1);
    const logged = loggerErrorSpy.firstCall.args[0] as unknown as string;
    logged.should.containEql(
      'Failed to encode API response for POST /api/v1/tbtc/advancedwallet/generate (api: v1.wallet.generate)',
    );
    logged.should.containEql('response does not match expected type SomeResponseCodec');
    // The stack trace points at the codec check that failed
    logged.should.containEql('Error: response does not match expected type SomeResponseCodec');
  });

  it('falls back to String() for non-Error throwables', () => {
    const req = makeFakeRequest();

    const body = customEncodeErrorFormatter('not an Error', req) as Record<string, unknown>;

    assert.equal(body.error, 'Internal Server Error');
    assert.equal(body.details, 'not an Error');
  });
});
