import { apiSpec } from '@api-ts/io-ts-http';
import { HealthCheckApiSpec } from './healthCheck';
import { MasterApiSpec } from './masterApiSpec';
import { securedExpressApiSpec } from './securedExpressHealth';

// Combine all API specifications
const combinedSpec = apiSpec({
  ...HealthCheckApiSpec,
  ...MasterApiSpec,
  ...securedExpressApiSpec,
});

export const FullApiSpec = combinedSpec;
