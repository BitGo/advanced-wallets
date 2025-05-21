import { Config } from '../../src/config';

declare module 'express-serve-static-core' {
  export interface Request {
    config: Config;
  }
}
