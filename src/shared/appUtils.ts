import express from 'express';
import path from 'path';
import https from 'https';
import http from 'http';
import morgan from 'morgan';
import fs from 'fs';
import timeout from 'connect-timeout';
import bodyParser from 'body-parser';
import _ from 'lodash';
import pjson from '../../package.json';
import logger from '../logger';

import { Config } from '../config';

/**
 * Set up the logging middleware provided by morgan
 */
export function setupLogging(app: express.Application, config: Config): void {
  // Set up morgan for logging, with optional logging into a file
  let middleware;
  if (config.logFile) {
    // create a write stream (in append mode)
    const accessLogPath = path.resolve(config.logFile);
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
 * Setup debug namespaces
 */
export function setupDebugNamespaces(debugNamespace?: string[]): void {
  if (_.isArray(debugNamespace)) {
    for (const ns of debugNamespace) {
      if (ns) {
        logger.debug(`Enabling debug namespace: ${ns}`);
      }
    }
  }
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
    logger.error('Error:', { error: err && err.message ? err.message : String(err) });
    const statusCode = err && err.status ? err.status : 500;
    const result = {
      error: err && err.message ? err.message : String(err),
      name: err && err.name ? err.name : 'Error',
      code: err && err.code ? err.code : undefined,
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
 * Read SSL/TLS certificates from files
 */
export async function readCertificates(
  keyPath: string,
  crtPath: string,
): Promise<{ key: string; cert: string }> {
  const privateKeyPromise = fs.promises.readFile(keyPath, 'utf8');
  const certificatePromise = fs.promises.readFile(crtPath, 'utf8');
  const [key, cert] = await Promise.all([privateKeyPromise, certificatePromise]);
  return { key, cert };
}

/**
 * Setup common health check routes
 */
export function setupHealthCheckRoutes(app: express.Application, serverType: string): void {
  app.get('/ping', (_req, res) => {
    res.json({
      status: `${serverType} server is ok!`,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/version', (_req, res) => {
    res.json({
      version: pjson.version,
      name: pjson.name,
    });
  });
}
