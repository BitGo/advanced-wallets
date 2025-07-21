import * as t from 'io-ts';
import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import { MasterExpressConfig } from '../../../shared/types';
import logger from '../../../logger';
import { responseHandler } from '../../../shared/middleware';
import { SecuredExpressClient } from '../clients/securedExpressClient';
import { PingResponseType, VersionResponseType } from '../../../types/health';

// Response type for /ping/securedExpress endpoint
export const PingSecuredResponse: HttpResponse = {
  200: t.type({
    status: t.string,
    securedResponse: PingResponseType,
  }),
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

export const VersionSecuredResponse: HttpResponse = {
  200: VersionResponseType,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// API Specification
export const securedExpressApiSpec = apiSpec({
  'v1.secured.ping': {
    post: httpRoute({
      method: 'POST',
      path: '/ping/securedExpress',
      request: httpRequest({}),
      response: PingSecuredResponse,
      description: 'Ping the secured express server',
    }),
  },
  'v1.secured.version': {
    get: httpRoute({
      method: 'GET',
      path: '/version/securedExpress',
      request: httpRequest({}),
      response: VersionSecuredResponse,
      description: 'Get the version of the secured express server',
    }),
  },
});

// Create router with handlers
export function createSecuredExpressRouter(
  cfg: MasterExpressConfig,
): WrappedRouter<typeof securedExpressApiSpec> {
  const router = createRouter(securedExpressApiSpec);

  // Create an instance of securedExpressClient
  const securedExpressClient = new SecuredExpressClient(cfg);

  // Ping endpoint handler
  router.post('v1.secured.ping', [
    responseHandler(async () => {
      logger.debug('Pinging secured express');

      try {
        // Use the client's ping method instead of direct HTTP request
        const pingResponse = await securedExpressClient.ping();

        return Response.ok({
          status: 'Successfully pinged secured express',
          securedResponse: pingResponse,
        });
      } catch (error) {
        logger.error('Failed to ping secured express:', { error });
        return Response.internalError({
          error: 'Failed to ping secured express',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  ]);

  router.get('v1.secured.version', [
    responseHandler(async () => {
      logger.debug('Getting version from secured express');

      try {
        // Use the client's getVersion method instead of direct HTTP request
        const versionResponse = await securedExpressClient.getVersion();

        return Response.ok({
          version: versionResponse.version,
          name: versionResponse.name,
        });
      } catch (error) {
        logger.error('Failed to get version from secured express:', { error });
        return Response.internalError({
          error: 'Failed to get version from secured express',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  ]);

  return router;
}
