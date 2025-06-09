import * as t from 'io-ts';
import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import pjson from '../../../package.json';
import { withResponseHandler } from '../../shared/responseHandler';

// Response type for /ping endpoint
const PingResponse: HttpResponse = {
  200: t.type({
    status: t.string,
    timestamp: t.string,
  }),
};

// Response type for /version endpoint
const VersionResponse: HttpResponse = {
  200: t.type({
    version: t.string,
    name: t.string,
  }),
};

// API Specification
export const HealthCheckApiSpec = apiSpec({
  'v1.health.ping': {
    post: httpRoute({
      method: 'POST',
      path: '/ping',
      request: httpRequest({}),
      response: PingResponse,
      description: 'Health check endpoint that returns server status',
    }),
  },
  'v1.health.version': {
    get: httpRoute({
      method: 'GET',
      path: '/version',
      request: httpRequest({}),
      response: VersionResponse,
      description: 'Returns the current version of the server',
    }),
  },
});

// Create router with handlers
export function createHealthCheckRouter(
  serverType: string,
): WrappedRouter<typeof HealthCheckApiSpec> {
  const router = createRouter(HealthCheckApiSpec, {
    onDecodeError: (_err, _req, _res) => {
      console.log(_err);
    },
    onEncodeError: (_err, _req, _res) => {
      console.log(_err);
    },
  });

  // Ping endpoint handler
  router.post('v1.health.ping', [
    withResponseHandler(() =>
      Response.ok({
        status: `${serverType} server is ok!`,
        timestamp: new Date().toISOString(),
      }),
    ),
  ]);

  // Version endpoint handler
  router.get('v1.health.version', [
    withResponseHandler(() =>
      Response.ok({
        version: pjson.version,
        name: pjson.name,
      }),
    ),
  ]);

  return router;
}
