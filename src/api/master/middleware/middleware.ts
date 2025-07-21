import { Request, Response, NextFunction } from 'express';
import { isMasterExpressConfig } from '../../../shared/types';
import { createSecuredExpressClient } from '../clients/securedExpressClient';
import { BitGoRequest } from '../../../types/request';

/**
 * Middleware to validate master express configuration and secured express client
 */
export function validateMasterExpressConfig(req: Request, res: Response, next: NextFunction) {
  const bitgoReq = req as BitGoRequest;

  // Validate master express config
  if (!isMasterExpressConfig(bitgoReq.config)) {
    return res.status(500).json({
      error: 'Invalid configuration',
      details: 'Expected req.config to be of type MasterExpressConfig',
    });
  }

  // Validate secured express client
  const securedExpressClient = createSecuredExpressClient(bitgoReq.config, bitgoReq.params?.coin);
  if (!securedExpressClient) {
    return res.status(500).json({
      error: 'Please configure secured express configs.',
      details: 'Secured express features will be disabled',
    });
  }

  // Attach the client to the request for use in route handlers
  bitgoReq.securedExpressClient = securedExpressClient;
  next();
}
