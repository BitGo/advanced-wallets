import * as PathReporter from 'io-ts/lib/PathReporter';
import { DecodeErrorFormatterFn, EncodeErrorFormatterFn } from '@api-ts/typed-express-router';
import logger from './logger';

export const customDecodeErrorFormatter: DecodeErrorFormatterFn = (errs, _req) => {
  const validationErrors = PathReporter.failure(errs);
  const validationErrorMessage = validationErrors.join('\n');
  return { error: validationErrorMessage };
};

/**
 * typed-express-router validates every outbound response against its io-ts codec in
 * res.sendEncoded(). When the payload fails that check the library falls back to
 * encodeErrorFormatter, whose default swallows the validation error and responds with
 * a bare HTTP 500 and an empty JSON body. Log the real error (message and stack) and
 * surface it in the response body so schema violations are debuggable instead of silent.
 */
export const customEncodeErrorFormatter: EncodeErrorFormatterFn = (err, req) => {
  const errMessage = err instanceof Error ? err.message : String(err);
  const errStack = err instanceof Error ? err.stack : undefined;

  const logLines = [
    `Failed to encode API response for ${req.method} ${req.originalUrl} (api: ${req.apiName}): ${errMessage}`,
  ];
  if (errStack) {
    logLines.push(errStack);
  }
  logger.error(logLines.join('\n'));

  return {
    error: 'Internal Server Error',
    details: errMessage,
  };
};
