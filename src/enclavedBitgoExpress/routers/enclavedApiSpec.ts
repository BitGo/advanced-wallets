import * as t from 'io-ts';
import {
  apiSpec,
  httpRoute,
  httpRequest,
  HttpResponse,
  Method as HttpMethod,
} from '@api-ts/io-ts-http';
import {
  createRouter,
  type WrappedRouter,
  TypedRequestHandler,
} from '@api-ts/typed-express-router';
import { Response } from '@api-ts/response';
import express from 'express';
import { BitGoRequest } from '../../types/request';
import { EnclavedConfig } from '../../types';
import { postIndependentKey } from '../../api/enclaved/postIndependentKey';
import { signMultisigTransaction } from '../../api/enclaved/signMultisigTransaction';
import { prepareBitGo, responseHandler } from '../../shared/middleware';

// Request type for /key/independent endpoint
const IndependentKeyRequest = {
  source: t.string,
  seed: t.union([t.undefined, t.string]),
};

// Response type for /key/independent endpoint
const IndependentKeyResponse: HttpResponse = {
  // TODO: Define proper response type
  200: t.any,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// Request type for /multisig/sign endpoint
const SignMultisigRequest = {
  source: t.string,
  pub: t.string,
  txPrebuild: t.any, // TransactionPrebuild type from BitGo
};

// Response type for /multisig/sign endpoint
const SignMultisigResponse: HttpResponse = {
  // TODO: Define proper response type for signed multisig transaction
  200: t.any,
  500: t.type({
    error: t.string,
    details: t.string,
  }),
};

// API Specification
export const EnclavedAPiSpec = apiSpec({
  'v1.multisig.sign': {
    post: httpRoute({
      method: 'POST',
      path: '/{coin}/multisig/sign',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: SignMultisigRequest,
      }),
      response: SignMultisigResponse,
      description: 'Sign a multisig transaction',
    }),
  },
  'v1.key.independent': {
    post: httpRoute({
      method: 'POST',
      path: '/{coin}/key/independent',
      request: httpRequest({
        params: {
          coin: t.string,
        },
        body: IndependentKeyRequest,
      }),
      response: IndependentKeyResponse,
      description: 'Generate an independent key',
    }),
  },
});

export type EnclavedApiSpecRouteHandler<
  ApiName extends keyof typeof EnclavedAPiSpec,
  Method extends keyof (typeof EnclavedAPiSpec)[ApiName] & HttpMethod,
> = TypedRequestHandler<typeof EnclavedAPiSpec, ApiName, Method>;

export type EnclavedApiSpecRouteRequest<
  ApiName extends keyof typeof EnclavedAPiSpec,
  Method extends keyof (typeof EnclavedAPiSpec)[ApiName] & HttpMethod,
> = BitGoRequest<EnclavedConfig> & Parameters<EnclavedApiSpecRouteHandler<ApiName, Method>>[0];

export type GenericEnclavedApiSpecRouteRequest = EnclavedApiSpecRouteRequest<any, any>;

// Create router with handlers
export function createKeyGenRouter(config: EnclavedConfig): WrappedRouter<typeof EnclavedAPiSpec> {
  const router = createRouter(EnclavedAPiSpec);
  // Add middleware
  router.use(express.json());
  router.use(prepareBitGo(config));

  // Independent key generation endpoint handler
  router.post('v1.key.independent', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.key.independent', 'post'>;
      const result = await postIndependentKey(typedReq);
      return Response.ok(result);
    }),
  ]);

  // Multisig transaction signing endpoint handler
  router.post('v1.multisig.sign', [
    responseHandler<EnclavedConfig>(async (req) => {
      const typedReq = req as EnclavedApiSpecRouteRequest<'v1.multisig.sign', 'post'>;
      const result = await signMultisigTransaction(typedReq);
      return Response.ok(result);
    }),
  ]);

  return router;
}
