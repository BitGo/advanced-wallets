import { Request, Response, NextFunction } from 'express';
import { isMasterExpressConfig } from '../../../shared/types';
import { createAdvancedWalletManagerClient } from '../clients/advancedWalletManagerClient';
import { BitGoRequest } from '../../../types/request';

/**
 * Middleware to validate master express configuration and advanced wallet manager client
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

  // Validate advanced wallet manager client
  const advancedWalletManagerClient = createAdvancedWalletManagerClient(
    bitgoReq.config,
    bitgoReq.params?.coin,
  );
  if (!advancedWalletManagerClient) {
    return res.status(500).json({
      error: 'Please configure advanced wallet manager configs.',
      details: 'Advanced wallet manager features will be disabled',
    });
  }

  // Attach the client to the request for use in route handlers
  bitgoReq.advancedWalletManagerClient = advancedWalletManagerClient;
  next();
}
