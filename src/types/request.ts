import express from 'express';
import { type BitGoAPI } from '@bitgo-beta/sdk-api';
import { Config } from '../shared/types';
import { AdvancedWalletManagerClient } from '../api/master/clients/advancedWalletManagerClient';

// Extended request type for BitGo Express
export interface BitGoRequest<T extends Config = Config> extends express.Request {
  bitgo: BitGoAPI;
  config: T;
  advancedWalletManagerClient: AdvancedWalletManagerClient;
}

export function isBitGoRequest<T extends Config>(req: express.Request): req is BitGoRequest<T> {
  return (
    (req as BitGoRequest<T>).bitgo !== undefined && (req as BitGoRequest<T>).config !== undefined
  );
}
