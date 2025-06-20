import { Config, isMasterExpressConfig } from '../shared/types';
import express from 'express';
import { BitGoRequest } from '../types/request';
import { BitGo } from 'bitgo';

export * from './responseHandler';

export function prepareBitGo(config: Config) {
  const BITGOEXPRESS_USER_AGENT = `BitGoExpress/${process.env.npm_package_version}`;

  return function prepBitGo(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    let accessToken;
    if (req.headers.authorization) {
      const authSplit = req.headers.authorization.split(' ');
      if (authSplit.length === 2 && authSplit[0].toLowerCase() === 'bearer') {
        accessToken = authSplit[1];
      }
    }

    const userAgent = req.headers['user-agent']
      ? BITGOEXPRESS_USER_AGENT + ' ' + req.headers['user-agent']
      : BITGOEXPRESS_USER_AGENT;

    const bitgoConstructorParams: any = {
      userAgent,
    };

    // Add master express specific params
    if (isMasterExpressConfig(config)) {
      bitgoConstructorParams.env = config.env;
      bitgoConstructorParams.customRootURI = config.customRootUri;
      bitgoConstructorParams.accessToken = accessToken;
    }

    (req as BitGoRequest<Config>).bitgo = new BitGo(bitgoConstructorParams);
    (req as BitGoRequest<Config>).config = config;

    next();
  };
}
