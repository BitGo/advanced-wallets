import { Request, Response, NextFunction } from 'express';
import { isMasterExpressConfig } from '../../../initConfig';
import { createEnclavedExpressClient } from '../clients/enclavedExpressClient';
import { BitGoRequest } from '../../../types/request';

/**
 * Middleware to validate master express configuration and enclaved express client
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

  // Validate enclaved express client
  const enclavedExpressClient = createEnclavedExpressClient(bitgoReq.config, bitgoReq.params?.coin);
  if (!enclavedExpressClient) {
    return res.status(500).json({
      error: 'Please configure enclaved express configs.',
      details: 'Enclaved express features will be disabled',
    });
  }

  // Attach the client to the request for use in route handlers
  bitgoReq.enclavedExpressClient = enclavedExpressClient;
  next();
}
