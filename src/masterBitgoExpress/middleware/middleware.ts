import { Request, Response, NextFunction } from 'express';
import { isMasterExpressConfig } from '../../shared/types';
import { createAwmClient, createAwmBackupClient } from '../clients/advancedWalletManagerClient';
import { OsoBridgeClient } from '../clients/bridgeClient';
import { BitGoRequest } from '../../types/request';

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
  const awmClient = createAwmClient(bitgoReq.config, bitgoReq.params?.coin);
  if (!awmClient) {
    return res.status(500).json({
      error: 'Please configure advanced wallet manager configs.',
      details: 'Advanced Wallet Manager features will be disabled',
    });
  }

  // Attach the client to the request for use in route handlers
  bitgoReq.awmUserClient = awmClient;

  // Create backup client if backup URL is configured; falls back to primary client
  try {
    const awmBackupClient = createAwmBackupClient(bitgoReq.config, bitgoReq.params?.coin);
    bitgoReq.awmBackupClient = awmBackupClient ?? awmClient;
  } catch (error) {
    const err = error as Error;
    return res.status(500).json({
      error: 'Failed to initialize backup advanced wallet manager client.',
      details: err.message,
    });
  }

  if (bitgoReq.config.asyncModeConfig.enabled) {
    bitgoReq.bridgeClient = new OsoBridgeClient(
      bitgoReq.config.asyncModeConfig.awmAsyncUrl,
      bitgoReq.config.timeout,
    );
  }

  next();
}
