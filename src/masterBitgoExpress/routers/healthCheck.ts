import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import pjson from '../../../package.json';
import { responseHandler } from '../../shared/middleware';
import { PingResponseType, VersionResponseType } from '../../types/health';
import { customDecodeErrorFormatter } from '../../shared/errorFormatters';

// API Response types
const PingResponse: HttpResponse = {
  200: PingResponseType,
};

const VersionResponse: HttpResponse = {
  200: VersionResponseType,
};

/**
 * Ping (MBE)
 *
 * Test your connection to the Master Bitgo Express (MBE) server.
 *
 * @tag Advanced Wallets
 * @operationId advancedwallet.mbe.ping
 */
const PingRoute = httpRoute({
  method: 'POST',
  path: '/ping',
  request: httpRequest({}),
  response: PingResponse,
  description: 'Health check endpoint that returns server status',
});

/**
 * Check Version (MBE)
 *
 * Check your version of the Master Bitgo Express (MBE) server.
 *
 * @tag Advanced Wallets
 * @operationId advancedwallet.mbe.version
 */
const VersionRoute = httpRoute({
  method: 'GET',
  path: '/version',
  request: httpRequest({}),
  response: VersionResponse,
  description: 'Returns the current version of the server',
});

export const HealthCheckApiSpec = apiSpec({
  'advancedwallet.mbe.ping': {
    post: PingRoute,
  },

  'advancedwallet.mbe.version': {
    get: VersionRoute,
  },
});

// Create router with handlers
export function createHealthCheckRouter(
  serverType: string,
): WrappedRouter<typeof HealthCheckApiSpec> {
  const router = createRouter(HealthCheckApiSpec, {
    decodeErrorFormatter: customDecodeErrorFormatter,
  });

  // Ping endpoint handler
  router.post('advancedwallet.mbe.ping', [
    responseHandler(() =>
      Response.ok({
        status: `${serverType} server is ok!`,
        timestamp: new Date().toISOString(),
      }),
    ),
  ]);

  // Version endpoint handler
  router.get('advancedwallet.mbe.version', [
    responseHandler(() =>
      Response.ok({
        version: pjson.version,
        name: pjson.name,
      }),
    ),
  ]);

  return router;
}
