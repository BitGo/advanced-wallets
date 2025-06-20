import express from 'express';
import { type BitGo } from 'bitgo';
import { Config } from '../shared/types';
import { EnclavedExpressClient } from '../api/master/clients/enclavedExpressClient';

// Extended request type for BitGo Express
export interface BitGoRequest<T extends Config = Config> extends express.Request {
  bitgo: BitGo;
  config: T;
  enclavedExpressClient: EnclavedExpressClient;
}

export function isBitGoRequest<T extends Config>(req: express.Request): req is BitGoRequest<T> {
  return (
    (req as BitGoRequest<T>).bitgo !== undefined && (req as BitGoRequest<T>).config !== undefined
  );
}
