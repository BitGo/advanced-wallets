import * as t from 'io-ts';
import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import { MasterExpressConfig } from '../../initConfig';
import logger from '../../logger';
import { responseHandler } from '../../shared/middleware';
import { EnclavedExpressClient } from '../enclavedExpressClient';
import { PingResponseType, VersionResponseType } from '../../types/health';

// Response type for /ping/enclavedExpress endpoint
const PingEnclavedResponse: HttpResponse = {
  200: t.type({
    status: t.string,
    enclavedResponse: PingResponseType,
  }),
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

const VersionEnclavedResponse: HttpResponse = {
  200: VersionResponseType,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// API Specification
export const EnclavedExpressApiSpec = apiSpec({
  'v1.enclaved.ping': {
    post: httpRoute({
      method: 'POST',
      path: '/ping/enclavedExpress',
      request: httpRequest({}),
      response: PingEnclavedResponse,
      description: 'Ping the enclaved express server',
    }),
  },
  'v1.enclaved.version': {
    get: httpRoute({
      method: 'GET',
      path: '/version/enclavedExpress',
      request: httpRequest({}),
      response: VersionEnclavedResponse,
      description: 'Get the version of the enclaved express server',
    }),
  },
});

// Create router with handlers
export function createEnclavedExpressRouter(
  cfg: MasterExpressConfig,
): WrappedRouter<typeof EnclavedExpressApiSpec> {
  const router = createRouter(EnclavedExpressApiSpec);

  // Create an instance of EnclavedExpressClient
  const enclavedClient = new EnclavedExpressClient(cfg);

  // Ping endpoint handler
  router.post('v1.enclaved.ping', [
    responseHandler(async () => {
      logger.debug('Pinging enclaved express');

      try {
        // Use the client's ping method instead of direct HTTP request
        const pingResponse = await enclavedClient.ping();

        return Response.ok({
          status: 'Successfully pinged enclaved express',
          enclavedResponse: {
            status: pingResponse.status,
            timestamp: pingResponse.timestamp,
          },
        });
      } catch (error) {
        logger.error('Failed to ping enclaved express:', { error });
        return Response.internalError({
          error: 'Failed to ping enclaved express',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  ]);

  router.get('v1.enclaved.version', [
    responseHandler(async () => {
      logger.debug('Getting version from enclaved express');

      try {
        // Use the client's getVersion method instead of direct HTTP request
        const versionResponse = await enclavedClient.getVersion();

        return Response.ok({
          version: versionResponse.version,
          name: versionResponse.name,
        });
      } catch (error) {
        logger.error('Failed to get version from enclaved express:', { error });
        return Response.internalError({
          error: 'Failed to get version from enclaved express',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  ]);

  return router;
}
