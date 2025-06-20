import { apiSpec } from '@api-ts/io-ts-http';
import { HealthCheckApiSpec } from './healthCheck';
import { MasterApiSpec } from './masterApiSpec';
import { EnclavedExpressApiSpec } from './enclavedExpressHealth';

// Combine all API specifications
const combinedSpec = apiSpec({
  ...HealthCheckApiSpec,
  ...MasterApiSpec,
  ...EnclavedExpressApiSpec,
});

export const FullApiSpec = combinedSpec;
