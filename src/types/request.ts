import express from 'express';
import { BitGoBase } from '@bitgo/sdk-core';
import { MasterExpressConfig } from '../types';

// Extended request type for BitGo Express
export interface BitGoRequest extends express.Request {
  bitgo: BitGoBase;
  config: MasterExpressConfig;
}
