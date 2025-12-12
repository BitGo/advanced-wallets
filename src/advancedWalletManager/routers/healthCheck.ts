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
 * Ping (AWM)
 *
 * Test your connection to the Advanced Wallet Manager (AWM) server.
 *
 * @tag Advanced Wallets
 * @operationId advancedwallet.awm.ping
 */
const PingRoute = httpRoute({
  method: 'POST',
  path: '/ping',
  request: httpRequest({}),
  response: PingResponse,
  description: 'Health check endpoint that returns server status',
});

/**
 * Check Version (AWM)
 *
 * Check your version of the Advanced Wallet Manager (AWM) server.
 *
 * @tag Advanced Wallets
 * @operationId advancedwallet.awm.version
 */
const VersionRoute = httpRoute({
  method: 'GET',
  path: '/version',
  request: httpRequest({}),
  response: VersionResponse,
  description: 'Returns the current version of the server',
});

export const HealthCheckApiSpec = apiSpec({
  'advancedwallet.awm.ping': {
    post: PingRoute,
  },
  'advancedwallet.awm.version': {
    get: VersionRoute,
  },
});

// Create router with handlers
export function createHealthCheckRouter(): WrappedRouter<typeof HealthCheckApiSpec> {
  const router = createRouter(HealthCheckApiSpec, {
    decodeErrorFormatter: customDecodeErrorFormatter,
  });
  // Ping endpoint handler
  router.post('advancedwallet.awm.ping', [
    responseHandler(() =>
      Response.ok({
        status: 'advanced wallet manager server is ok!',
        timestamp: new Date().toISOString(),
      }),
    ),
  ]);

  // Version endpoint handler
  router.get('advancedwallet.awm.version', [
    responseHandler(() =>
      Response.ok({
        version: pjson.version,
        name: pjson.name,
      }),
    ),
  ]);

  return router;
}
