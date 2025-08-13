import * as t from 'io-ts';
import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import { MasterExpressConfig } from '../../shared/types';
import logger from '../../shared/logger';
import { responseHandler } from '../../shared/middleware';
import { AdvancedWalletManagerClient } from '../clients/advancedWalletManagerClient';
import { PingResponseType, VersionResponseType } from '../../types/health';

// Response type for /ping/advancedWalletManager endpoint
const PingAwmResponse: HttpResponse = {
  200: t.type({
    status: t.string,
    advancedWalletManagerResponse: PingResponseType,
  }),
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

const VersionAwmResponse: HttpResponse = {
  200: VersionResponseType,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// API Specification
export const AdvancedWalletManagerHealthSpec = apiSpec({
  'v1.advancedwalletmanager.ping': {
    post: httpRoute({
      method: 'POST',
      path: '/ping/advancedWalletManager',
      request: httpRequest({}),
      response: PingAwmResponse,
      description: 'Ping the advanced wallet manager server',
    }),
  },
  'v1.advancedwalletmanager.version': {
    get: httpRoute({
      method: 'GET',
      path: '/version/advancedWalletManager',
      request: httpRequest({}),
      response: VersionAwmResponse,
      description: 'Get the version of the advanced wallet manager server',
    }),
  },
});

// Create router with handlers
export function createAdvancedWalletManagerHealthRouter(
  cfg: MasterExpressConfig,
): WrappedRouter<typeof AdvancedWalletManagerHealthSpec> {
  const router = createRouter(AdvancedWalletManagerHealthSpec);

  // Create an instance of awmClient
  const awmClient = new AdvancedWalletManagerClient(cfg);

  // Ping endpoint handler
  router.post('v1.advancedwalletmanager.ping', [
    responseHandler(async () => {
      logger.debug('Pinging advanced wallet manager');

      try {
        // Use the client's ping method instead of direct HTTP request
        const pingResponse = await awmClient.ping();

        return Response.ok({
          status: 'Successfully pinged advanced wallet manager',
          awmResponse: {
            status: pingResponse.status,
            timestamp: pingResponse.timestamp,
          },
        });
      } catch (error) {
        logger.error('Failed to ping advanced wallet manager:', { error });
        return Response.internalError({
          error: 'Failed to ping advanced wallet manager',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  ]);

  router.get('v1.advancedwalletmanager.version', [
    responseHandler(async () => {
      try {
        // Use the client's getVersion method instead of direct HTTP request
        const versionResponse = await awmClient.getVersion();

        return Response.ok({
          version: versionResponse.version,
          name: versionResponse.name,
        });
      } catch (error) {
        logger.error('Failed to get version from advanced wallet manager:', { error });
        return Response.internalError({
          error: 'Failed to get version from advanced wallet manager',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  ]);

  return router;
}
