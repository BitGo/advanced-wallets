# Advanced Wallets

> **⚠️ BETA SOFTWARE - NOT OFFICIALLY RELEASED**
>
> This project is currently in beta and has not been officially released for production use. APIs, features, and documentation may change without notice. Use at your own risk in production environments.

![Beta](https://img.shields.io/badge/status-beta-yellow) ![License](https://img.shields.io/badge/license-Apache%202.0-green)

Advanced wallets are a type of self-custody cryptocurrency wallet that enable passwordless transactions by integrating your own Key Management Service (KMS) or Hardware Security Module (HSM) for user and backup private keys. Advanced wallets enable isolating sensitive key generation and signing operations in a dedicated, self-hosted service within your own secure environment.

Advanced wallets operate in two modes:

- **Advanced Wallet Manager Mode** - A lightweight, dedicated keygen/signing server with no internet access that handles all sensitive cryptographic operations. Connects exclusively to your KMS/HSM for secure key operations. This mode includes support for wallet recoveries.
- **Master Express Mode** - An Express application that's the orchestrator between the Advanced Wallet Manager and [BitGo APIs](https://developers.bitgo.com/reference/overview#/). This mode serves as an API gateway with integrated signing capabilities.

Key features include:

- **Complete Infrastructure Control** - Host and manage all components in your own secure environment.
- **KMS/HSM Integration** - Bring your own KMS or HSM by implementing the provided [KMS API interface specification](./kms-api-spec.yaml). Reference implementations available for [AWS HSM](./demo-kms-script/aws-interface.md) and [Dinamo HSM](./demo-kms-script/dinamo-interface.md).
- **Network Isolation** - Advanced Wallet Manager operates in a completely isolated network segment with no external internet access.
- **mTLS Security** - Optional mutual TLS with client certificate validation for secure inter-service communications.
- **Flexible Configuration** - Environment-based setup with file or variable-based certificates.

## Table of Contents

- [Architecture](#architecture)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [Quick Start (No mTLS)](#quick-start-no-mtls---fastest-way-to-test)
- [Configuration](#configuration)
- [Container Deployment](#container-deployment-with-podman)
- [Docker Compose Deployment](#docker-compose-deployment)
- [API Endpoints](#api-endpoints)
  - [API Documentation](#api-documentation)
- [Production Setup](#production-setup)
- [License](#license)

## Architecture

- **Advanced Wallet Manager** (Port 3080) - An isolated signing server with no internet access that only connects to your KMS API implementation for key operations.
- **Master Express** (Port 3081) - An API gateway providing end-to-end wallet creation and transaction support, integrating [BitGo APIs](https://developers.bitgo.com/reference/overview#/) with secure communication to Advanced Wallet Manager.

## Installation

### Prerequisites

- **Node.js** 22.1.0 or higher.
- **npm** or **yarn** package manager.
- **OpenSSL** for certificate generation.
- **Docker** and **Docker Compose** for containerized deployment (or you can use **Podman** as alternative to Docker).
- **KMS API Implementation** - You must implement the [KMS API interface specification](./kms-api-spec.yaml) to connect your KMS/HSM to the Advanced Wallet Manager. Reference implementations available:
  - [AWS HSM Implementation Example](./demo-kms-script/aws-interface.md)
  - [Dinamo HSM Implementation Example](./demo-kms-script/dinamo-interface.md)

### Setup

#### 1. Clone the Repository

```bash
git clone <repository-url>
cd advanced-wallets
```

#### 2. Install Dependencies

```bash
npm install
```

#### 3. Build the Project

```bash
npm run build
```

#### 4. Generate Test Certificates (Optional)

```bash
# Generate private key and certificate for testing
openssl genrsa -out demo.key 2048
openssl req -new -x509 -key demo.key -out demo.crt -days 365 -subj "/CN=localhost"
```

### Development Setup

For local development, you can use nodemon for automatic restarts:

```bash
# Install nodemon globally (if not already installed)
npm install -g nodemon

# Start in development mode
npm start
```

### Container Setup

For containerized deployment, build the Docker images:

```bash
# Build Master Express (default port 3081)
npm run container:build:master-bitgo-express

# Build Advanced Wallet Manager (port 3080)
npm run container:build:advanced-wallet-manager
```

## Quick Start

### Quick Start (No mTLS) - Fastest Way to Test

For quick testing without mTLS security, you can disable TLS entirely. This is useful for local development and testing.

#### 1. Start Advanced Wallet Manager (Port 3080)

```bash
TLS_MODE=disabled \
BITGO_ENV=test \
APP_MODE=advanced-wallet-manager \
ADVANCED_WALLET_MANAGER_PORT=3080 \
KMS_URL=http://localhost:3000 \
npm start
```

#### 2. Start Master BitGo Express (Port 3081)

Run the following in a new terminal:

```bash
TLS_MODE=disabled \
BITGO_ENV=test \
APP_MODE=master-express \
MASTER_EXPRESS_PORT=3081 \
ADVANCED_WALLET_MANAGER_URL=http://localhost:3080 \
npm start
```

#### 3. Test Connection

```bash
# Test Advanced Wallet Manager
curl -X POST http://localhost:3080/ping

# Test Master Express
curl -X POST http://localhost:3081/ping

# Test connection between services
curl -X POST http://localhost:3081/ping/advancedWalletManager
```

> **Note:** You should only use `TLS_MODE=disabled` for local development and testing. Always use mTLS in production environments. For information about configuring mTLS in production, see the [Production Setup](#production-setup) section.

## Configuration

### Core Settings

| Variable    | Description          | Default       | Required                                         |
| ----------- | -------------------- | ------------- | ------------------------------------------------ |
| `APP_MODE`  | Application mode     | -             | ✅ `advanced-wallet-manager` or `master-express` |
| `BIND`      | Address to bind to   | `localhost`   | ❌                                               |
| `TIMEOUT`   | Request timeout (ms) | `305000`      | ❌                                               |
| `NODE_ENV`  | Node environment     | `development` | ❌                                               |
| `LOG_LEVEL` | Log level            | `info`        | ❌                                               |

### Advanced Wallet Manager Settings

| Variable                       | Description                        | Default | Required |
| ------------------------------ | ---------------------------------- | ------- | -------- |
| `ADVANCED_WALLET_MANAGER_PORT` | Port to listen on                  | `3080`  | ❌       |
| `KMS_URL`                      | URL to your KMS API implementation | -       | ✅       |

> **Note:** The `KMS_URL` points to your implementation of the KMS API interface. You must implement this interface to connect your KMS/HSM. See [Prerequisites](#prerequisites) for the specification and examples.

### Master Express Settings

| Variable                       | Description                                                   | Default | Required |
| ------------------------------ | ------------------------------------------------------------- | ------- | -------- |
| `MASTER_EXPRESS_PORT`          | Port to listen on                                             | `3081`  | ❌       |
| `BITGO_ENV`                    | BitGo environment (`prod`, `test`, `staging`, `dev`, `local`) | `test`  | ❌       |
| `ADVANCED_WALLET_MANAGER_URL`  | Advanced Wallet Manager URL                                   | -       | ✅       |
| `BITGO_CUSTOM_ROOT_URI`        | Custom BitGo API root URI (overrides `BITGO_ENV`)             | -       | ❌       |
| `BITGO_DISABLE_ENV_CHECK`      | Disable environment check                                     | `true`  | ❌       |
| `BITGO_AUTH_VERSION`           | BitGo authentication version                                  | `2`     | ❌       |
| `BITGO_CUSTOM_BITCOIN_NETWORK` | Custom Bitcoin network                                        | -       | ❌       |

### Additional Settings

| Variable             | Description                                         | Default                | Applies To |
| -------------------- | --------------------------------------------------- | ---------------------- | ---------- |
| `RECOVERY_MODE`      | Enable recovery mode for wallet recovery operations | `false`                | Both       |
| `HTTP_LOGFILE`       | Path to HTTP access log file                        | `logs/http-access.log` | Both       |
| `KEEP_ALIVE_TIMEOUT` | Keep-alive timeout in milliseconds                  | -                      | Both       |
| `HEADERS_TIMEOUT`    | Headers timeout in milliseconds                     | -                      | Both       |
| `IPC`                | IPC socket path (alternative to TCP port binding)   | -                      | Both       |

### TLS/mTLS Configuration

#### Basic TLS Settings

| Variable                        | Description                           | Default |
| ------------------------------- | ------------------------------------- | ------- |
| `TLS_MODE`                      | TLS mode (`mtls` or `disabled`)       | `mtls`  |
| `CLIENT_CERT_ALLOW_SELF_SIGNED` | Allow self-signed client certificates | `false` |

#### Server Certificates (for incoming connections)

| Variable               | Description                      | Format     |
| ---------------------- | -------------------------------- | ---------- |
| `SERVER_TLS_KEY_PATH`  | Server private key file path     | File path  |
| `SERVER_TLS_CERT_PATH` | Server certificate file path     | File path  |
| `SERVER_TLS_KEY`       | Server private key (alternative) | PEM string |
| `SERVER_TLS_CERT`      | Server certificate (alternative) | PEM string |

#### Client Authentication

| Variable                           | Description                             | Format               |
| ---------------------------------- | --------------------------------------- | -------------------- |
| `MTLS_ALLOWED_CLIENT_FINGERPRINTS` | Allowed client certificate fingerprints | Comma-separated list |

#### Outbound mTLS Certificates

**For Master Express → Advanced Wallet Manager:**

| Variable                            | Description                               | Format                     |
| ----------------------------------- | ----------------------------------------- | -------------------------- |
| `AWM_CLIENT_TLS_KEY_PATH`           | Client private key file path              | File path                  |
| `AWM_CLIENT_TLS_KEY`                | Client private key (alternative)          | PEM string                 |
| `AWM_CLIENT_TLS_CERT_PATH`          | Client certificate file path              | File path                  |
| `AWM_CLIENT_TLS_CERT`               | Client certificate (alternative)          | PEM string                 |
| `AWM_SERVER_CA_CERT_PATH`           | AWM server CA certificate file path       | File path                  |
| `AWM_SERVER_CA_CERT`                | AWM server CA certificate (alternative)   | PEM string                 |
| `AWM_SERVER_CERT_ALLOW_SELF_SIGNED` | Allow self-signed AWM server certificates | Boolean (default: `false`) |

**For Advanced Wallet Manager → KMS:**

| Variable                            | Description                               | Format                     |
| ----------------------------------- | ----------------------------------------- | -------------------------- |
| `KMS_CLIENT_TLS_KEY_PATH`           | Client private key file path              | File path                  |
| `KMS_CLIENT_TLS_KEY`                | Client private key (alternative)          | PEM string                 |
| `KMS_CLIENT_TLS_CERT_PATH`          | Client certificate file path              | File path                  |
| `KMS_CLIENT_TLS_CERT`               | Client certificate (alternative)          | PEM string                 |
| `KMS_SERVER_CA_CERT_PATH`           | KMS server CA certificate file path       | File path                  |
| `KMS_SERVER_CA_CERT`                | KMS server CA certificate (alternative)   | PEM string                 |
| `KMS_SERVER_CERT_ALLOW_SELF_SIGNED` | Allow self-signed KMS server certificates | Boolean (default: `false`) |

> **Note:** For security reasons, when `TLS_MODE=mtls`, outbound client certificates are required and cannot reuse server certificates. When `TLS_MODE=disabled`, these certificates aren't required.

## Container Deployment with Podman

### Build Commands

```bash
# For Master Express (default port 3081)
npm run container:build:master-bitgo-express

# For Advanced Wallet Manager (default port 3080)
npm run container:build:advanced-wallet-manager

# Or specify custom ports
npm run container:build:master-bitgo-express -- --build-arg PORT=3081
npm run container:build:advanced-wallet-manager -- --build-arg PORT=3082
```

### Run Containers

For local development, you must run both the Advanced Wallet Manager and the Master Express containers:

```bash
# Start Advanced Wallet Manager container
podman run -d \
  -p 3080:3080 \
  -v $(pwd)/certs:/app/certs:Z \
  -e APP_MODE=advanced-wallet-manager \
  -e BIND=0.0.0.0 \
  -e TLS_MODE=mtls \
  -e SERVER_TLS_KEY_PATH=/app/certs/advanced-wallet-manager-key.pem \
  -e SERVER_TLS_CERT_PATH=/app/certs/advanced-wallet-manager-cert.pem \
  -e KMS_URL=host.containers.internal:3000 \
  -e NODE_ENV=development \
  -e CLIENT_CERT_ALLOW_SELF_SIGNED=true \
  advanced-wallet-manager

# View logs
podman logs -f <container_id>

# Test the endpoint (note: using https)
curl -k -X POST https://localhost:3080/ping

# Start Master Express container
podman run -d \
  -p 3081:3081 \
  -v $(pwd)/certs:/app/certs:Z \
  -e APP_MODE=master-express \
  -e BIND=0.0.0.0 \
  -e TLS_MODE=mtls \
  -e SERVER_TLS_KEY_PATH=/app/certs/test-ssl-key.pem \
  -e SERVER_TLS_CERT_PATH=/app/certs/test-ssl-cert.pem \
  -e ADVANCED_WALLET_MANAGER_URL=https://host.containers.internal:3080 \
  -e AWM_SERVER_CA_CERT_PATH=/app/certs/advanced-wallet-manager-cert.pem \
  -e CLIENT_CERT_ALLOW_SELF_SIGNED=true \
  master-bitgo-express

# View logs
podman logs -f <container_id>

# Test the endpoints (note: using https and mTLS)
# For Advanced Wallet Manager
curl -k --cert certs/test-ssl-cert.pem --key certs/advanced-wallet-manager-key.pem -X POST https://localhost:3080/ping

# For Master Express
curl -k --cert certs/test-ssl-cert.pem --key certs/test-ssl-key.pem -X POST https://localhost:3081/ping

# Test the connection
curl -k -X POST https://localhost:3081/ping/advancedWalletManager
```

> **Note:**
>
> - `host.containers.internal` is a special DNS name that resolves to the host machine from inside containers.
> - The `:Z` option in volume mounts is specific to SELinux-enabled systems and ensures proper volume labeling.
> - The logs directory is created with appropriate permissions if it doesn't already exist.

## Docker Compose Deployment

The application includes a Docker Compose configuration that runs both Advanced Wallet Manager (AWM) and Master BitGo Express (MBE) services with proper network isolation for enhanced security.

### Architecture Overview

The Docker Compose setup creates two isolated services:

- **Advanced Wallet Manager (AWM)**: Runs in an isolated internal network with no external access for maximum security.
- **Master BitGo Express (MBE)**: Connects to both internal network (for AWM communication) and public network (for external API access).
- **Network Isolation**: AWM is completely isolated from external networks and only accessible through MBE.

### Network Configuration

The setup creates two distinct networks:

1. **my-internal-network**:

   - Internal bridge network with `internal: true`
   - Used for secure AWM isolation and MBE-to-AWM communication
   - No external internet access for security

2. **my-public-network**:
   - Public bridge network
   - Used for external access to MBE APIs
   - Connected to host networking

### Prerequisites

1. **Install Docker and Docker Compose**
2. **Ensure your KMS API implementation is running** on your host machine (typically on port 3000)

### Quick Start

#### 1. Start Services

```bash
# Navigate to project directory
cd advanced-wallet

# Start both services in background
docker-compose up -d
```

#### 2. Stop Services

```bash
# Stop and remove containers
docker-compose down
```

## API Endpoints

### Advanced Wallet Manager (Port 3080)

- `POST /ping` - Health check.
- `GET /version` - Version information.
- `POST /:coin/key/independent` - Generate independent keychain.

### Master Express (Port 3081)

- `POST /ping` - Health check.
- `GET /version` - Version information.
- `POST /ping/advancedWalletManager` - Test connection to Advanced Wallet Manager.
- `POST /api/:coin/wallet/generate` - Generate wallet (with Advanced Wallet Manager integration).

### API Documentation

**Master Express OpenAPI Specification**

You can vew the OpenAPI specification for Master Express at [`masterBitgoExpress.json`](./masterBitgoExpress.json).

To regenerate the API documentation:

```bash
npm run generate:openapi:masterExpress
```

This generates or updates the `masterBitgoExpress.json` file with the latest API specification. You can view this file with any OpenAPI viewer such as:

- [Swagger Editor](https://editor.swagger.io/)
- [Redoc](https://redocly.github.io/redoc/)
- VS Code OpenAPI extensions

## Production Setup

### Quick Start (with mTLS)

For production deployments with proper mTLS security:

#### 1. Start Advanced Wallet Manager (Port 3080)

```bash
export APP_MODE=advanced-wallet-manager
export TLS_MODE=mtls
export ADVANCED_WALLET_MANAGER_PORT=3080
export KMS_URL=https://production-kms.example.com:3000
# Server certificates for incoming mTLS connections
export SERVER_TLS_KEY_PATH=/secure/certs/awm-server.key
export SERVER_TLS_CERT_PATH=/secure/certs/awm-server.crt
# Client certificates for outbound connections to KMS
export KMS_CLIENT_TLS_KEY_PATH=/secure/certs/awm-kms-client.key
export KMS_CLIENT_TLS_CERT_PATH=/secure/certs/awm-kms-client.crt
export KMS_SERVER_CA_CERT_PATH=/secure/certs/kms-ca.crt
# Security settings - production-grade
export CLIENT_CERT_ALLOW_SELF_SIGNED=false
export KMS_SERVER_CERT_ALLOW_SELF_SIGNED=false
export MTLS_ALLOWED_CLIENT_FINGERPRINTS=sha256:1a2b3c...,sha256:4d5e6f...
export BITGO_ENV=prod
npm start
```

#### 2. Start Master Express (Port 3081)

Run the following in a new terminal:

```bash
export APP_MODE=master-express
export TLS_MODE=mtls
export MASTER_EXPRESS_PORT=3081
export BITGO_ENV=prod
export ADVANCED_WALLET_MANAGER_URL=https://awm.internal.example.com:3080
# Server certificates for incoming mTLS connections
export SERVER_TLS_KEY_PATH=/secure/certs/mbe-server.key
export SERVER_TLS_CERT_PATH=/secure/certs/mbe-server.crt
# Client certificates for outbound connections to AWM
export AWM_CLIENT_TLS_KEY_PATH=/secure/certs/mbe-awm-client.key
export AWM_CLIENT_TLS_CERT_PATH=/secure/certs/mbe-awm-client.crt
export AWM_SERVER_CA_CERT_PATH=/secure/certs/awm-ca.crt
# Security settings - production-grade
export CLIENT_CERT_ALLOW_SELF_SIGNED=false
export AWM_SERVER_CERT_ALLOW_SELF_SIGNED=false
export MTLS_ALLOWED_CLIENT_FINGERPRINTS=sha256:7g8h9i...,sha256:0j1k2l...
npm start
```

#### 3. Test Connection

For testing, you can use the IP address of the server or `localhost` if you're running it locally. In production deployments, configure your DNS or load balancer to point to the appropriate servers.

```bash
# Test Advanced Wallet Manager (replace localhost with your server IP/hostname)
curl --cert /path/to/client-cert.crt --key /path/to/client-key.key \
  --cacert /secure/certs/awm-ca.crt \
  https://localhost:3080/ping

# Test Master Express (replace localhost with your server IP/hostname)
curl --cert /path/to/client-cert.crt --key /path/to/client-key.key \
  --cacert /secure/certs/mbe-ca.crt \
  https://localhost:3081/ping

# Test connection between services
curl --cert /path/to/client-cert.crt --key /path/to/client-key.key \
  --cacert /secure/certs/mbe-ca.crt \
  https://localhost:3081/ping/advancedWalletManager
```

**Testing with Demo Certificates:**

For local testing, you can generate and use demo certificates with the self-signed configuration flags:

- Generate demo certificates: `npm run generate-test-ssl` (creates `demo.key` and `demo.crt`).
- Set `CLIENT_CERT_ALLOW_SELF_SIGNED=true`, `KMS_SERVER_CERT_ALLOW_SELF_SIGNED=true`, and `AWM_SERVER_CERT_ALLOW_SELF_SIGNED=true`.
- Use the demo certificates for all certificate paths (server and client).
- **Important:** Demo certificates and self-signed configurations should never be used in production.

### Best Practices

1. **Use CA-signed certificates** instead of self-signed.
2. **Set `CLIENT_CERT_ALLOW_SELF_SIGNED=false`** and server-specific allow self-signed flags to `false` in production.
3. **Configure client certificate allowlisting** with `MTLS_ALLOWED_CLIENT_FINGERPRINTS`.
4. **Use separate certificates** for each service (server, AWM client, KMS client).
5. **Regularly rotate certificates**.
6. **Secure private key storage** and use appropriate file permissions.
7. **Always use `TLS_MODE=mtls`** in production environments.

### Certificate Management

#### Getting Client Certificate Fingerprints

To obtain certificate fingerprints for `MTLS_ALLOWED_CLIENT_FINGERPRINTS`:

```bash
openssl x509 -in /path/to/client-cert.crt -noout -fingerprint -sha256 | cut -d'=' -f2
```

The output format is: `sha256:AB:CD:EF:...` which you can use in the configuration.

#### Certificate Requirements for Production

- All certificates should be CA-signed certificates issued by your organization's PKI.
- Each service must use separate certificates (server cert, AWM client cert, KMS client cert).
- Client certificates for outbound connections must be different from server certificates.
- Store private keys in secure locations with restricted file permissions:
  ```bash
  chmod 400 /secure/certs/*.key
  chown root:root /secure/certs/*.key
  ```
- Use `BIND=0.0.0.0` only if the service needs to be accessible from other machines.
- Regularly rotate certificates according to your security policy.

## License

Apache License 2.0 - see [LICENSE](./LICENSE) file for details.

Copyright 2025 BitGo
