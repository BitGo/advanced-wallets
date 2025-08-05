import express from 'express';
import path from 'path';
import https from 'https';
import http from 'http';
import morgan from 'morgan';
import fs from 'fs';
import timeout from 'connect-timeout';
import bodyParser from 'body-parser';
import pjson from '../../package.json';
import logger from '../logger';

import { Config, TlsMode, MasterExpressConfig } from '../shared/types';
import { isAdvancedWalletManagerConfig, isMasterExpressConfig } from '../initConfig';

/**
 * Set up the logging middleware provided by morgan
 */
export function setupLogging(app: express.Application, config: Config): void {
  // Set up morgan for logging, with optional logging into a file
  if (process.env.NODE_ENV === 'test' || process.env.LOG_LEVEL === 'silent') {
    return;
  }
  let middleware;
  if (config.httpLoggerFile) {
    // create a write stream (in append mode)
    const accessLogPath = path.resolve(config.httpLoggerFile);
    const accessLogStream = fs.createWriteStream(accessLogPath, { flags: 'a' });
    logger.info(`Log location: ${accessLogPath}`);
    // setup the logger
    middleware = morgan('combined', { stream: accessLogStream });
  } else {
    middleware = morgan('combined');
  }

  app.use(middleware);
}

/**
 * Create common Express middleware
 */
export function setupCommonMiddleware(app: express.Application, config: Config): void {
  // Be more robust about accepting URLs with double slashes
  app.use(function replaceUrlSlashes(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    req.url = req.url.replace(/\/{2,}/g, '/');
    next();
  });

  // Set timeout
  app.use(timeout(config.timeout) as any);

  // Add body parser
  app.use(bodyParser.json({ limit: '20mb' }));
}

/**
 * Create error handling middleware
 */
export function createErrorHandler() {
  return function (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) {
    logger.debug('Error:', { error: err && err.message ? err.message : String(err) });
    const statusCode = err && err.status ? err.status : 500;
    const result = {
      error: err && err.message ? err.message : String(err),
      name: err && err.name ? err.name : 'Error',
      code: err && err.code ? err.code : undefined,
      details: err && err.details ? err.details : undefined,
      result: err && err.result ? err.result : undefined,
      stack: process.env.NODE_ENV === 'development' && err && err.stack ? err.stack : undefined,
      version: pjson.version,
    };
    return res.status(statusCode).json(result);
  };
}

/**
 * Create HTTP server
 */
export function createHttpServer(app: express.Application): http.Server {
  return http.createServer(app);
}

/**
 * Configure server timeouts
 */
export function configureServerTimeouts(server: https.Server | http.Server, config: Config): void {
  if (config.keepAliveTimeout !== undefined) {
    server.keepAliveTimeout = config.keepAliveTimeout;
  }
  if (config.headersTimeout !== undefined) {
    server.headersTimeout = config.headersTimeout;
  }
}

/**
 * Prepare IPC socket
 */
export async function prepareIpc(ipcSocketFilePath: string): Promise<void> {
  if (process.platform === 'win32') {
    throw new Error(`IPC option is not supported on platform ${process.platform}`);
  }
  try {
    const stat = fs.statSync(ipcSocketFilePath);
    if (!stat.isSocket()) {
      throw new Error('IPC socket is not actually a socket');
    }
    fs.unlinkSync(ipcSocketFilePath);
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      throw e;
    }
  }
}

/**
 * Create mTLS middleware for validating client certificates
 */
export function createMtlsMiddleware(config: {
  tlsMode: TlsMode;
  clientCertAllowSelfSigned?: boolean;
  mtlsAllowedClientFingerprints?: string[];
}): express.RequestHandler {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const clientCert = (req as any).socket?.getPeerCertificate();

    // Check if client certificate is actually present (not just an empty object)
    const hasValidClientCert =
      clientCert && Object.keys(clientCert).length > 0 && clientCert.subject;

    // If mTLS is enabled, client certificate is always required
    if (config.tlsMode === TlsMode.MTLS && !hasValidClientCert) {
      return res.status(403).json({
        error: 'mTLS Authentication Failed',
        message: 'Client certificate is required for this endpoint',
        details: 'Please provide a valid client certificate in your request',
      });
    }

    // If client cert is provided, validate it
    if (hasValidClientCert) {
      // Check if self-signed certificates are allowed
      if (!config.clientCertAllowSelfSigned && clientCert.issuer.CN === clientCert.subject.CN) {
        return res.status(403).json({
          error: 'mTLS Authentication Failed',
          message: 'Self-signed certificates are not allowed',
          details: 'Please use a certificate issued by a trusted CA',
        });
      }

      // Check fingerprint restrictions if configured
      if (config.mtlsAllowedClientFingerprints?.length) {
        const fingerprint = clientCert.fingerprint256?.replace(/:/g, '').toUpperCase();
        if (!fingerprint || !config.mtlsAllowedClientFingerprints?.includes(fingerprint)) {
          return res.status(403).json({
            error: 'mTLS Authentication Failed',
            message: 'Client certificate fingerprint not authorized',
            details: `Certificate fingerprint ${fingerprint} is not in the allowed list`,
          });
        }
      }
    }

    // Store client certificate info for logging
    if (hasValidClientCert) {
      (req as any).clientCert = clientCert;
    }
    next();
  };
}

export function validateTlsCertificates(config: Config) {
  if (isAdvancedWalletManagerConfig(config)) {
    if (!config.serverTlsKey || !config.serverTlsCert) {
      throw new Error('SERVER_TLS_KEY and SERVER_TLS_CERT are required when TLS mode is MTLS');
    }
  } else if (isMasterExpressConfig(config)) {
    if (!config.serverTlsKey || !config.serverTlsCert) {
      throw new Error('SERVER_TLS_KEY and SERVER_TLS_CERT are required when TLS mode is MTLS');
    }
  }
}

/**
 * Validate Master Express configuration
 */
export function validateMasterExpressConfig(config: MasterExpressConfig) {
  if (config.tlsMode === TlsMode.MTLS) {
    if (!config.awmServerCaCertPath) {
      throw new Error('AWM_SERVER_CA_CERT_PATH is required when TLS mode is MTLS');
    }
  }
}
