import * as PathReporter from 'io-ts/lib/PathReporter';
import { DecodeErrorFormatterFn } from '@api-ts/typed-express-router';

export const customDecodeErrorFormatter: DecodeErrorFormatterFn = (errs, _req) => {
  const validationErrors = PathReporter.failure(errs);
  const validationErrorMessage = validationErrors.join('\n');
  return { error: validationErrorMessage };
};
