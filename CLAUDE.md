# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

- `npm start` - Start the application in development mode using nodemon for auto-reloading
- `npm run build` - Build the TypeScript code (creates /dist folder)
- `npm run lint` - Run ESLint to check for code issues
- `npm run lint:fix` - Run ESLint and automatically fix issues when possible

### Testing

- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run generate-test-ssl` - Generate self-signed SSL certificates for testing

### Container

- `npm run container:build` - Build the container image using Podman (optionally use --build-arg PORT=3080)

## Advanced Wallet Manager

The Advanced Wallet Manager (AWM) is a secure, standalone service responsible for cryptographic operations, such as key generation and signing. It is designed to be deployed in a secure environment, ensuring that private key material is never exposed to the host system. The AWM communicates with BitGo's services and the Master Express application via mTLS, providing a secure channel for all sensitive operations.

### Key Features

- **Secure Key Management**: All cryptographic keys are generated and stored within the secure environment, preventing unauthorized access.
- **Cryptographic Operations**: The AWM handles all signing and key generation requests, ensuring that private keys never leave the secure boundary.
- **mTLS Communication**: All communication between the AWM and other services is secured using mutual TLS, ensuring both authentication and encryption.
- **Standalone Deployment**: The AWM can be deployed independently of the Master Express application, allowing for flexible and scalable architectures.

### Security Architecture

- Both modes support mutual TLS (mTLS) authentication
- Certificates can be loaded from files or environment variables
- Client certificate validation for secure communications
- Option to validate client certificate fingerprints

### Code Structure

- `src/app.ts` - Main entry point that determines mode and starts the appropriate app
- `src/advancedWalletManagerApp.ts` - Advanced Wallet Manager mode implementation
- `src/masterExpressApp.ts` - Master Express mode implementation
- `src/initConfig.ts` - Configuration loading and validation
- `src/routes/` - Express routes for both modes
- `src/api/` - API implementation for both modes
- `src/kms/` - KMS client and operations
- `src/shared/` - Shared utilities and types

### Configuration

Configuration is managed through environment variables with defaults defined in `src/initConfig.ts`. The application requires specific environment variables depending on the mode:

#### Common Variables

- `APP_MODE` - Set to "advanced-wallet-manager" or "master-express"
- `TLS_MODE` - Set to "mtls" or "disabled"
- `BIND` - Address to bind to (default: localhost)
- `TIMEOUT` - Request timeout in milliseconds (default: 305000)

#### Advanced Wallet Manager Mode Specific

- `ADVANCED_WALLET_MANAGER_PORT` - Port to listen on (default: 3080)
- `KMS_URL` - Required KMS service URL

#### Master Express Mode Specific

- `MASTER_EXPRESS_PORT` - Port to listen on (default: 3081)
- `BITGO_ENV` - BitGo environment (default: test)
- `ADVANCED_WALLET_MANAGER_URL` - Required URL for the Advanced Wallet Manager server
- `ADVANCED_WALLET_MANAGER_CERT` - Required path to Advanced Wallet Manager certificate

## API Endpoints

### Advanced Wallet Manager (Port 3080)

- `POST /ping` - Health check
- `GET /version` - Version information
- `POST /:coin/key/independent` - Generate independent keychain

### Master Express (Port 3081)

#### Health and Status Endpoints

- `POST /ping` - Health check
- `GET /version` - Version information
- `POST /ping/awm` - Test connection to Advanced Wallet Manager
- `GET /version/awm` - Get Advanced Wallet Manager version information

#### Wallet Management

- `POST /api/:coin/wallet/generate` - Generate wallet (supports onchain and TSS multisig types)

#### Transaction Operations

- `POST /api/:coin/wallet/:walletId/sendMany` - Send transaction with multiple recipients
- `POST /api/:coin/wallet/:walletId/accelerate` - Accelerate pending transactions (CPFP/RBF)
- `POST /api/:coin/wallet/:walletId/consolidate` - Consolidate wallet addresses
- `POST /api/:coin/wallet/:walletId/consolidateunspents` - Consolidate unspent transaction outputs

#### Recovery

- `POST /api/:coin/wallet/recovery` - Recover wallet funds
