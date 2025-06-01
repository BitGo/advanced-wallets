import * as t from 'io-ts';
import * as h from '@api-ts/io-ts-http';

export const PingResponse = t.type({
  status: t.string,
  timeStamp: t.string,
});
export type PingResponse = t.TypeOf<typeof PingResponse>;

/**
 * Request to ping the server to check if it is alive
 *
 * @operationId api.v1.health.pingMasterExpress
 */
export const PingServerRequest = h.httpRoute({
  path: '/ping',
  method: 'POST',
  request: h.httpRequest({}),
  description: 'Ping the server to check if it is alive',
  response: {
    200: PingResponse,
    500: t.type({
      error: t.string,
      details: t.string,
    }),
  },
});

export const GetVersionResponse = t.type({
  version: t.string,
  name: t.string,
});
export type GetVersionResponse = t.TypeOf<typeof GetVersionResponse>;

/**
 * Request to get the version of the server
 *
 * @operationId api.v1.health.getVersion
 */
export const GetVersionRequest = h.httpRoute({
  path: '/version',
  method: 'GET',
  request: h.httpRequest({}),
  response: {
    200: GetVersionResponse,
    500: t.type({
      error: t.string,
      details: t.string,
    }),
  },
});

export const InternalErrorResponse = t.type({
  error: t.union([t.string, t.undefined]),
  details: t.union([t.string, t.undefined]),
});

export const enclavedPingResponse = t.type({
  status: t.string,
  timeStamp: t.string,
});
export type EnclavedPingResponse = t.TypeOf<typeof enclavedPingResponse>;

/**
 * Request to ping the enclaved express server
 *
 * @operationId api.v1.pingEnclavedExpress
 */
export const PingEnclavedExpressRequest = h.httpRoute({
  path: '/ping/enclavedExpress',
  method: 'POST',
  request: h.httpRequest({}),
  response: {
    200: t.type({
      status: t.string,
      enclavedResponse: enclavedPingResponse,
    }),
    500: InternalErrorResponse,
  },
});

// TODO: Fill out full response type
export const WalletGenerateRequest = {
  label: t.string,
  enterprise: t.string,
  multiSigType: t.string,
};

// TODO: Update response type
export const WalletGenerateResponse = t.type({
  wallet: t.any,
  userKeychain: t.any,
  backupKeychain: t.any,
  bitgoKeychain: t.any,
});

/**
 * Request to generate a new wallet
 *
 * @operationId api.v1.generateWallet
 */
export const GenerateWalletRequest = h.httpRoute({
  path: '/api/{coin}/wallet/generate',
  method: 'POST',
  request: h.httpRequest({
    params: {
      coin: t.string,
    },
    // TODO: Remove once middleware is setup
    headers: {
      'user-agent': t.union([t.string, t.undefined]),
      Authorization: t.union([t.string, t.undefined]),
    },
    body: WalletGenerateRequest,
  }),
  response: {
    200: WalletGenerateResponse,
    400: InternalErrorResponse,
    500: InternalErrorResponse,
    501: InternalErrorResponse,
  },
});

export const MasterExpressApi = h.apiSpec({
  'api.v1.health.pingMasterExpress': {
    post: PingServerRequest,
  },
  'api.v1.health.getVersion': {
    get: GetVersionRequest,
  },
  'api.v1.pingEnclavedExpress': {
    post: PingEnclavedExpressRequest,
  },
  'api.v1.generateWallet': {
    post: GenerateWalletRequest,
  },
});
