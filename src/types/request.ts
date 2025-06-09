import express from 'express';
import { type BitGo } from 'bitgo';
import { MasterExpressConfig } from '../types';

// Extended request type for BitGo Express
export interface BitGoRequest extends express.Request {
  bitgo: BitGo;
  config: MasterExpressConfig;
}

export function isBitGoRequest(req: express.Request): req is BitGoRequest {
  return (req as BitGoRequest).bitgo !== undefined && (req as BitGoRequest).config !== undefined;
}
