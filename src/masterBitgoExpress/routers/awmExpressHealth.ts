import * as t from 'io-ts';
import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import { MasterExpressConfig } from '../../shared/types';
import logger from '../../shared/logger';
import { responseHandler } from '../../shared/middleware';
import { AdvancedWalletManagerClient } from '../clients/advancedWalletManagerClient';
import { PingResponseType } from '../../types/health';
import { customDecodeErrorFormatter } from '../../shared/errorFormatters';

// Response type for /ping/advancedWalletManager endpoint
const PingAwmResponse: HttpResponse = {
  200: t.type({
    status: t.string,
    awmResponse: PingResponseType,
  }),
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

/**
 * Advanced Wallets - Ping Advanced Wallet Manager
 *
 * Test your connection between the Advanced Wallet Manager (AWM) and the Master Bitgo Express (MBE) servers.
 *
 * @tag Advanced Wallets
 * @operationId advancedwallet.mbe.awm.ping
 */
const PingAwmRoute = httpRoute({
  method: 'POST',
  path: '/ping/advancedWalletManager',
  request: httpRequest({}),
  response: PingAwmResponse,
  description: 'Ping the advanced wallet manager server',
});

export const AdvancedWalletManagerHealthSpec = apiSpec({
  'advancedwallet.mbe.awm.ping': {
    post: PingAwmRoute,
  },
});

// Create router with handlers
export function createAdvancedWalletManagerHealthRouter(
  cfg: MasterExpressConfig,
): WrappedRouter<typeof AdvancedWalletManagerHealthSpec> {
  const router = createRouter(AdvancedWalletManagerHealthSpec, {
    decodeErrorFormatter: customDecodeErrorFormatter,
  });

  // Create an instance of awmClient
  const awmClient = new AdvancedWalletManagerClient(cfg);

  // Ping endpoint handler
  router.post('advancedwallet.mbe.awm.ping', [
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

  return router;
}
