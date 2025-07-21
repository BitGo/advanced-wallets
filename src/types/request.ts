import express from 'express';
import { type BitGo } from 'bitgo';
import { Config } from '../shared/types';
import { SecuredExpressClient } from '../api/master/clients/securedExpressClient';

// Extended request type for BitGo Express
export interface BitGoRequest<T extends Config = Config> extends express.Request {
  bitgo: BitGo;
  config: T;
  securedExpressClient: SecuredExpressClient;
}

export function isBitGoRequest<T extends Config>(req: express.Request): req is BitGoRequest<T> {
  return (
    (req as BitGoRequest<T>).bitgo !== undefined && (req as BitGoRequest<T>).config !== undefined
  );
}
