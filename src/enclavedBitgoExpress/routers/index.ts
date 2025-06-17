import { EnclavedAPiSpec as ApiSpec } from './enclavedApiSpec';
import { HealthCheckApiSpec } from './healthCheck';

export const EnclavedApiSpec = {
  ...HealthCheckApiSpec,
  ...ApiSpec,
};
export type EnclavedApiSpec = typeof EnclavedApiSpec;
