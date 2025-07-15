# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `yarn start` - Start the application in development mode using nodemon for auto-reloading
- `yarn build` - Build the TypeScript code (creates /dist folder)
- `yarn lint` - Run ESLint to check for code issues
- `yarn lint:fix` - Run ESLint and automatically fix issues when possible

### Testing
- `yarn test` - Run all tests
- `yarn test:watch` - Run tests in watch mode
- `yarn test:coverage` - Run tests with coverage report
- `yarn generate-test-ssl` - Generate self-signed SSL certificates for testing

### Container
- `yarn container:build` - Build the container image using Podman (optionally use --build-arg PORT=3080)

## Architecture Overview

Enclaved BitGo Express is a secure cryptocurrency signing server with two operational modes:

### 1. Enclaved Express Mode (`APP_MODE=enclaved`)
- Lightweight server focused solely on secure signing operations
- Runs on port 3080 by default
- Integrates with KMS for key management
- Handles cryptographic operations securely
- Exposes minimal endpoints focused on key generation and signing

### 2. Master Express Mode (`APP_MODE=master-express`)
- Full BitGo API functionality with integrated signing capabilities
- Runs on port 3081 by default
- Acts as an API gateway and communicates with Enclaved Express for signing operations
- Provides a broader set of BitGo wallet operations and transaction handling

### Security Architecture
- Both modes support mutual TLS (mTLS) authentication
- Certificates can be loaded from files or environment variables
- Client certificate validation for secure communications
- Option to validate client certificate fingerprints

### Code Structure
- `src/app.ts` - Main entry point that determines mode and starts the appropriate app
- `src/enclavedApp.ts` - Enclaved Express mode implementation
- `src/masterExpressApp.ts` - Master Express mode implementation
- `src/initConfig.ts` - Configuration loading and validation
- `src/routes/` - Express routes for both modes
- `src/api/` - API implementation for both modes
- `src/kms/` - KMS client and operations
- `src/shared/` - Shared utilities and types

### Configuration
Configuration is managed through environment variables with defaults defined in `src/initConfig.ts`. The application requires specific environment variables depending on the mode:

#### Common Variables
- `APP_MODE` - Set to "enclaved" or "master-express"
- `TLS_MODE` - Set to "mtls" or "disabled"
- `BIND` - Address to bind to (default: localhost)
- `TIMEOUT` - Request timeout in milliseconds (default: 305000)

#### Enclaved Mode Specific
- `ENCLAVED_EXPRESS_PORT` - Port to listen on (default: 3080)
- `KMS_URL` - Required KMS service URL

#### Master Express Mode Specific
- `MASTER_EXPRESS_PORT` - Port to listen on (default: 3081)
- `BITGO_ENV` - BitGo environment (default: test)
- `ENCLAVED_EXPRESS_URL` - Required URL for the Enclaved Express server
- `ENCLAVED_EXPRESS_CERT` - Required path to Enclaved Express certificate

## API Endpoints

### Enclaved Express (Port 3080)
- `POST /ping` - Health check
- `GET /version` - Version information
- `POST /:coin/key/independent` - Generate independent keychain

### Master Express (Port 3081)

#### Health and Status Endpoints
- `POST /ping` - Health check
- `GET /version` - Version information
- `POST /ping/enclavedExpress` - Test connection to Enclaved Express
- `GET /version/enclavedExpress` - Get Enclaved Express version information

#### Wallet Management
- `POST /api/:coin/wallet/generate` - Generate wallet (supports onchain and TSS multisig types)

#### Transaction Operations
- `POST /api/:coin/wallet/:walletId/sendMany` - Send transaction with multiple recipients
- `POST /api/:coin/wallet/:walletId/accelerate` - Accelerate pending transactions (CPFP/RBF)
- `POST /api/:coin/wallet/:walletId/consolidate` - Consolidate wallet addresses
- `POST /api/:coin/wallet/:walletId/consolidateunspents` - Consolidate unspent transaction outputs

#### Recovery
- `POST /api/:coin/wallet/recovery` - Recover wallet funds