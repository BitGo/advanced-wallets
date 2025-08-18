import { apiSpec } from '@api-ts/io-ts-http';
import { HealthCheckApiSpec } from './healthCheck';
import { MasterBitGoExpressApiSpec } from './masterBitGoExpressApiSpec';
import { AdvancedWalletManagerHealthSpec } from './awmExpressHealth';

// Combine all API specifications
const combinedSpec = apiSpec({
  ...HealthCheckApiSpec,
  ...MasterBitGoExpressApiSpec,
  ...AdvancedWalletManagerHealthSpec,
});

export const FullApiSpec = combinedSpec;
