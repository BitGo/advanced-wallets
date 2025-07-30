import { apiSpec } from '@api-ts/io-ts-http';
import { MasterApiSpec } from './masterApiSpec';
import { AwmApiSpec } from './advancedWalletManagerHealth';
import { HealthCheckApiSpec } from './healthCheck';

export const FullApiSpec = apiSpec({
  ...MasterApiSpec,
  ...AwmApiSpec,
  ...HealthCheckApiSpec,
});

export type FullApiSpec = typeof FullApiSpec;
