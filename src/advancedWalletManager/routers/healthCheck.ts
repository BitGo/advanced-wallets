import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import { responseHandler } from '../../shared/middleware';
import { PingResponseType, VersionResponseType } from '../../types/health';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pjson = require('../../../package.json');

// API Response types
const PingResponse: HttpResponse = {
  200: PingResponseType,
};

const VersionResponse: HttpResponse = {
  200: VersionResponseType,
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
export function createHealthCheckRouter(): WrappedRouter<typeof HealthCheckApiSpec> {
  const router = createRouter(HealthCheckApiSpec);

  router.get('v1.health.version', [
    responseHandler(() =>
      Response.ok({
        version: pjson.version,
        name: pjson.name,
      }),
    ),
  ]);

  router.post('v1.health.ping', [
    (req, res) => {
      const response: PingResponseType = {
        status: 'advanced wallet manager server is ok!',
        timestamp: new Date().toISOString(),
      };
      res.status(200).json(response);
    },
  ]);

  return router;
}
