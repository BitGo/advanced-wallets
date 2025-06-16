import { apiSpec } from '@api-ts/io-ts-http';
import { HealthCheckApiSpec } from './healthCheck';
import { MasterApiSpec } from './masterApiSpec';

// Combine all API specifications
const combinedSpec = apiSpec({
  ...HealthCheckApiSpec,
  ...MasterApiSpec,
});

// Export the OpenAPI specification
export default {
  openapi: '3.1.0',
  info: {
    title: '@bitgo/master-bitgo-express',
    version: '0.0.1',
    description: 'BitGo Master Express - Gateway for on Prem BitGo services',
  },
  ...combinedSpec,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your Bearer token in the format "Bearer {token}"',
      },
    },
  },
  security: [
    {
      bearerAuth: [],
    },
  ],
};

// Also export the combined API spec for internal use
export const FullApiSpec = combinedSpec;
