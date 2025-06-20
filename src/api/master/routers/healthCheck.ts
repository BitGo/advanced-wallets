import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import pjson from '../../../../package.json';
import { responseHandler } from '../../../shared/middleware';
import { PingResponseType, VersionResponseType } from '../../../types/health';

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
export function createHealthCheckRouter(
  serverType: string,
): WrappedRouter<typeof HealthCheckApiSpec> {
  const router = createRouter(HealthCheckApiSpec);

  // Ping endpoint handler
  router.post('v1.health.ping', [
    responseHandler(() =>
      Response.ok({
        status: `${serverType} server is ok!`,
        timestamp: new Date().toISOString(),
      }),
    ),
  ]);

  // Version endpoint handler
  router.get('v1.health.version', [
    responseHandler(() =>
      Response.ok({
        version: pjson.version,
        name: pjson.name,
      }),
    ),
  ]);

  return router;
}
