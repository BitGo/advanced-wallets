import express from 'express';
import debug from 'debug';

const debugLogger = debug('advancedWalletManager:routes');

// promiseWrapper implementation
export function promiseWrapper(promiseRequestHandler: any) {
  return async function promWrapper(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    debugLogger(`handle: ${req.method} ${req.originalUrl}`);
    try {
      const result = await promiseRequestHandler(req, res, next);
      if (result && typeof result === 'object') {
        if ('status' in result && 'body' in result) {
          const { status, body } = result as { status: number; body: unknown };
          return res.status(status).json(body);
        }
        return res.status(200).json(result);
      }
      return res.status(200).json(result);
    } catch (e) {
      const err = e as Error;
      return res.status(500).json({ error: err.message || String(err) });
    }
  };
}
