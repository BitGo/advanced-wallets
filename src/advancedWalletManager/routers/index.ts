import { AdvancedWalletManagerApiSpec as ApiSpec } from './advancedWalletManagerApiSpec';
import { HealthCheckApiSpec } from './healthCheck';

export const AdvancedWalletManagerApiSpec = {
  ...HealthCheckApiSpec,
  ...ApiSpec,
};
export type AdvancedWalletManagerApiSpec = typeof AdvancedWalletManagerApiSpec;
