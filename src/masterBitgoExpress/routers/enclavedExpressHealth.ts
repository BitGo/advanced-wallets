import * as t from 'io-ts';
import { apiSpec, httpRoute, httpRequest, HttpResponse } from '@api-ts/io-ts-http';
import { createRouter, type WrappedRouter } from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import https from 'https';
import superagent from 'superagent';
import { MasterExpressConfig, TlsMode } from '../../initConfig';
import logger from '../../logger';
import { responseHandler } from '../../shared/middleware';

// Response type for /ping/enclavedExpress endpoint
const PingEnclavedResponse: HttpResponse = {
  200: t.type({
    status: t.string,
    // TODO: Move to common definition between enclavedExpress and masterExpress
    enclavedResponse: t.type({
      message: t.string,
      timestamp: t.string,
    }),
  }),
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
});

// Create router with handlers
export function createEnclavedExpressRouter(
  cfg: MasterExpressConfig,
): WrappedRouter<typeof EnclavedExpressApiSpec> {
  const router = createRouter(EnclavedExpressApiSpec, {
    onDecodeError: (err, _req, _res) => {
      logger.error('Decode error:', { error: err });
    },
    onEncodeError: (err, _req, _res) => {
      logger.error('Encode error:', { error: err });
    },
  });

  // Ping endpoint handler
  router.post('v1.enclaved.ping', [
    responseHandler(async () => {
      logger.debug('Pinging enclaved express');

      try {
        let response;
        if (cfg.tlsMode === TlsMode.MTLS) {
          // Use Master Express's own certificate as client cert when connecting to Enclaved Express
          const httpsAgent = new https.Agent({
            rejectUnauthorized: !cfg.allowSelfSigned,
            ca: cfg.enclavedExpressCert,
            // Provide client certificate for mTLS
            key: cfg.tlsKey,
            cert: cfg.tlsCert,
          });

          response = await superagent
            .post(`${cfg.enclavedExpressUrl}/ping`)
            .ca(cfg.enclavedExpressCert)
            .agent(httpsAgent)
            .send();
        } else {
          // When TLS is disabled, use plain HTTP without any TLS configuration
          response = await superagent.post(`${cfg.enclavedExpressUrl}/ping`).send();
        }

        return Response.ok({
          status: 'Successfully pinged enclaved express',
          enclavedResponse: response.body,
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

  return router;
}
