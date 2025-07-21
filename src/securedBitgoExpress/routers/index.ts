import { SecuredExpressApiSpec as ApiSpec } from './securedExpressApiSpec';
import { HealthCheckApiSpec } from './healthCheck';

export const SecuredExpressApiSpec = {
  ...HealthCheckApiSpec,
  ...ApiSpec,
};
export type SecuredExpressApiSpec = typeof SecuredExpressApiSpec;
