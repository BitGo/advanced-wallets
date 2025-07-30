import { Config } from '../../src/shared/types';

declare module 'express-serve-static-core' {
  export interface Request {
    config: Config;
  }
}
