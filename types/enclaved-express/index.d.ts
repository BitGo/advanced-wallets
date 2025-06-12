import { Config } from '../../src/initConfig';

declare module 'express-serve-static-core' {
  export interface Request {
    config: Config;
  }
}
