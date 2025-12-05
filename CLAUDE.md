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

## Architecture Overview

Advanced Wallet Manager is a secure cryptocurrency signing server with two operational modes:

### 1. Advanced Wallet Manager Mode (`APP_MODE=advanced-wallet-manager`)

- Lightweight server focused solely on secure signing operations
- Runs on port 3080 by default
- Integrates with KMS for key management
- Handles cryptographic operations securely
- Exposes minimal endpoints focused on key generation and signing

### 2. Master Express Mode (`APP_MODE=master-express`)

- Full BitGo API functionality with integrated signing capabilities
- Runs on port 3081 by default
- Acts as an API gateway and communicates with Advanced Wallet Manager for signing operations
- Provides a broader set of BitGo wallet operations and transaction handling

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
- `ADVANCED_WALLET_MANAGER_URL` - Required URL for the Advanced Wallet Manager
- `ADVANCED_WALLET_MANAGER_CERT` - Required path to Advanced Wallet Manager certificate


## Abbreviations and Nomenclature
- (DKG) Distributed Key Generation
- (DSG) Distributed Signing Generation
- (HSM) Hardware Security Module
- (WP) Wallet Platform
- (SDK) Refers to the BitGoJs SDK https://github.com/BitGo/BitGoJS

## Error Handling

The application uses consistent error handling patterns across both modes:

- `BitgoExpressError` - Base error class for all custom errors
- `ValidationError` - 422 Unprocessable Entity errors for invalid input parameters
- `NotFoundError` - 404 Not Found errors for resources that don't exist
- `BadRequestError` - 400 Bad Request errors for invalid request format
- `UnauthorizedError` - 401 Unauthorized errors for authentication failures
- `ForbiddenError` - 403 Forbidden errors for authorization issues
- `ConflictError` - 409 Conflict errors for state conflicts

API responses follow a standard error format with `error` and `details` fields.

## API Endpoints

### Advanced Wallet Manager (Port 3080)

#### Health and Information
- `POST /ping` - Health check
- `GET /version` - Version information

#### Key Management
- `POST /:coin/key/independent` - Generate independent keychain

#### Transaction Signing
- `POST /api/:coin/multisig/sign` - Sign a multisig transaction
- `POST /api/:coin/multisig/recovery` - Recover a multisig transaction
- `POST /api/:coin/mpc/recovery` - Sign a recovery transaction with EdDSA user & backup keyshares
- `POST /api/:coin/mpc/sign/:shareType` - Sign an MPC transaction

#### MPC Key Operations
- `POST /api/:coin/mpc/key/initialize` - Initialize MPC for EdDSA key generation
- `POST /api/:coin/mpc/key/finalize` - Finalize key generation
- `POST /api/:coin/mpcv2/initialize` - Initialize MPC v2 
- `POST /api/:coin/mpcv2/round` - Perform a round in the MPC protocol
- `POST /api/:coin/mpcv2/finalize` - Finalize the MPC DKG protocol

### Master Express (Port 3081)

#### Health and Status Endpoints

- `POST /ping` - Health check
- `GET /version` - Version information
- `POST /ping/advancedWalletManager` - Test connection to Advanced Wallet Manager
- `GET /version/advancedWalletManager` - Get Advanced Wallet Manager version information

#### Wallet Management

- `POST /api/v1/:coin/advancedwallet/generate` - Generate wallet (supports onchain and TSS multisig types)

#### Transaction Operations

- `POST /api/v1/:coin/advancedwallet/:walletId/sendMany` - Send transaction with multiple recipients
- `POST /api/v1/:coin/advancedwallet/:walletId/accelerate` - Accelerate pending transactions (CPFP/RBF)
- `POST /api/v1/:coin/advancedwallet/:walletId/consolidate` - Consolidate wallet addresses
- `POST /api/v1/:coin/advancedwallet/:walletId/consolidateunspents` - Consolidate unspent transaction outputs
- `POST /api/v1/:coin/advancedwallet/:walletId/txrequest/:txRequestId/signAndSend` - Sign a TxRequest and broadcast it (MPC wallets only)

#### Recovery

- `POST /api/v1/:coin/advancedwallet/recovery` - Recover wallet funds
- `POST /api/v1/:coin/advancedwallet/recoveryconsolidations` - Consolidate and recover funds from multiple addresses
