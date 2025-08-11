# Advanced Wallets

A secure, mTLS-enabled cryptocurrency signing server with two operational modes: Advanced Wallet Manager (dedicated signer) and Master Express (API gateway with integrated signing capabilities).

## Overview

This application provides secure cryptocurrency operations with mutual TLS (mTLS) authentication:

- **Advanced Wallet Manager Mode**: Lightweight keygen/signing server for secure key operations. Includes support for recovery.
- **Master Express Mode**: An express app that acts as the orchestrator between the Advanced Wallet Manager and BitGo APIs.
- **mTLS Security**: Client certificate validation for secure communications
- **Flexible Configuration**: Environment-based setup with file or variable-based certificates

## Architecture

- **Advanced Wallet Manager** (Port 3080): Isolated signing server with no internet access, only connects to KMS API for key operations.
- **Master Express** (Port 3081): Full BitGo API functionality with secure communication to Advanced Wallet Manager

## Installation

### Prerequisites

- **Node.js** 22.1.0 or higher
- **npm** or **yarn** package manager
- **OpenSSL** for certificate generation
- **Docker** and **Docker Compose** (for containerized deployment)
- **Podman** (alternative to Docker for containerized deployment)

### Setup

1. **Clone the repository:**

```bash
git clone <repository-url>
cd advanced-wallets
```

2. **Install dependencies:**

```bash
npm install
```

3. **Build the project:**

```bash
npm run build
```

4. **Generate test certificates (optional):**

```bash
# Generate private key and certificate for testing
openssl genrsa -out server.key 2048
openssl req -new -x509 -key server.key -out server.crt -days 365 -subj "/CN=localhost"
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
npm run container:build

# Build Advanced Wallet Manager (port 3080)
npm run container:build --build-arg PORT=3080
```

## Quick Start

### 1. Start Advanced Wallet Manager

```bash
export APP_MODE=advanced-wallet-manager
export KMS_URL=https://your-kms-service
export SERVER_TLS_KEY_PATH=./server.key
export SERVER_TLS_CERT_PATH=./server.crt
export KMS_SERVER_CA_CERT_PATH=./server.crt
export KMS_SERVER_CERT_ALLOW_SELF_SIGNED=true
export CLIENT_CERT_ALLOW_SELF_SIGNED=true
npm start
```

### 2. Start Master Express

```bash
export APP_MODE=master-express
export BITGO_ENV=test
export SERVER_TLS_KEY_PATH=./server.key
export SERVER_TLS_CERT_PATH=./server.crt
export ADVANCED_WALLET_MANAGER_URL=https://localhost:3080
export AWM_SERVER_CA_CERT_PATH=./server.crt
export AWM_SERVER_CERT_ALLOW_SELF_SIGNED=true
export CLIENT_CERT_ALLOW_SELF_SIGNED=true
npm start
```

### 3. Test the Connection

```bash
curl -k -X POST https://localhost:3081/ping/advancedWalletManager
```

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

| Variable                       | Description       | Default | Required |
| ------------------------------ | ----------------- | ------- | -------- |
| `ADVANCED_WALLET_MANAGER_PORT` | Port to listen on | `3080`  | ❌       |
| `KMS_URL`                      | KMS service URL   | -       | ✅       |

### Master Express Settings

| Variable                      | Description                 | Default | Required |
| ----------------------------- | --------------------------- | ------- | -------- |
| `MASTER_EXPRESS_PORT`         | Port to listen on           | `3081`  | ❌       |
| `BITGO_ENV`                   | BitGo environment           | `test`  | ❌       |
| `ADVANCED_WALLET_MANAGER_URL` | Advanced Wallet Manager URL | -       | ✅       |

### TLS/mTLS Configuration

#### Basic TLS Settings

| Variable            | Description                     | Default |
| ------------------- | ------------------------------- | ------- |
| `TLS_MODE`          | TLS mode (`mtls` or `disabled`) | `mtls`  |
| `ALLOW_SELF_SIGNED` | Allow self-signed certificates  | `false` |

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

- `AWM_CLIENT_TLS_KEY_PATH` / `AWM_CLIENT_TLS_KEY`
- `AWM_CLIENT_TLS_CERT_PATH` / `AWM_CLIENT_TLS_CERT`
- `AWM_SERVER_CA_CERT_PATH` / `AWM_SERVER_CA_CERT`

**For Advanced Wallet Manager → KMS:**

- `KMS_CLIENT_TLS_KEY_PATH` / `KMS_CLIENT_TLS_KEY`
- `KMS_CLIENT_TLS_CERT_PATH` / `KMS_CLIENT_TLS_CERT`
- `KMS_SERVER_CA_CERT_PATH` / `KMS_SERVER_CA_CERT`

## Container Deployment with Podman

### Build Commands

```bash
# For Master Express (default port 3081)
npm run container:build

# For Advanced Wallet Manager (port 3080)
npm run container:build --build-arg PORT=3080
```

### Run Containers

For local development, you'll need to run both the Advanced Wallet Manager and Master Express containers:

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
  bitgo-onprem-express

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
  bitgo-onprem-express

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

**Notes:**

- `host.containers.internal` is a special DNS name that resolves to the host machine from inside containers
- The `:Z` option in volume mounts is specific to SELinux-enabled systems and ensures proper volume labeling
- The logs directory will be created with appropriate permissions if it doesn't exist

## Docker Compose Deployment

The application includes a Docker Compose configuration that runs both Advanced Wallet Manager (AWM) and Master BitGo Express (MBE) services with proper network isolation for enhanced security.

### Architecture Overview

The Docker Compose setup creates two isolated services:

- **Advanced Wallet Manager (AWM)**: Runs in an isolated internal network with no external access for maximum security
- **Master BitGo Express (MBE)**: Connected to both internal network (for AWM communication) and public network (for external API access)
- **Network Isolation**: AWM is completely isolated from external networks and only accessible through MBE

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
2. **Ensure KMS service is running** on your host machine (typically on port 3000)

### Quick Start

1. **Start the services:**

```bash
# Navigate to project directory
cd advanced-wallet

# Start both services in background
docker-compose up -d
```

2. **Stop the services:**

```bash
# Stop and remove containers
docker-compose down
```

## API Endpoints

### Advanced Wallet Manager (Port 3080)

- `POST /ping` - Health check
- `GET /version` - Version information
- `POST /:coin/key/independent` - Generate independent keychain

### Master Express (Port 3081)

- `POST /ping` - Health check
- `GET /version` - Version information
- `POST /ping/advancedWalletManager` - Test connection to Advanced Wallet Manager
- `POST /api/:coin/wallet/generate` - Generate wallet (with Advanced Wallet Manager integration)

## Production Security

### Best Practices

1. **Use CA-signed certificates** instead of self-signed
2. **Set `ALLOW_SELF_SIGNED=false`** in production
3. **Configure client certificate allowlisting** with `MTLS_ALLOWED_CLIENT_FINGERPRINTS`
4. **Use separate certificates** for each service
5. **Regularly rotate certificates**
6. **Secure private key storage**

### Production Example

```bash
# Advanced Wallet Manager
export APP_MODE=advanced-wallet-manager
export KMS_URL=https://production-kms.example.com
export SERVER_TLS_KEY_PATH=/secure/awm-server.key
export SERVER_TLS_CERT_PATH=/secure/awm-server.crt
export KMS_CLIENT_TLS_KEY_PATH=/secure/awm-kms-client.key
export KMS_CLIENT_TLS_CERT_PATH=/secure/awm-kms-client.crt
export KMS_SERVER_CA_CERT_PATH=/secure/kms-ca.crt
export ALLOW_SELF_SIGNED=false
export MTLS_ALLOWED_CLIENT_FINGERPRINTS=ABC123...,DEF456...

# Master Express
export APP_MODE=master-express
export BITGO_ENV=prod
export SERVER_TLS_KEY_PATH=/secure/master-server.key
export SERVER_TLS_CERT_PATH=/secure/master-server.crt
export AWM_CLIENT_TLS_KEY_PATH=/secure/master-awm-client.key
export AWM_CLIENT_TLS_CERT_PATH=/secure/master-awm-client.crt
export ADVANCED_WALLET_MANAGER_URL=https://awm.internal.example.com:3080
export AWM_SERVER_CA_CERT_PATH=/secure/awm-ca.crt
export ALLOW_SELF_SIGNED=false
```

## Troubleshooting

### Common Issues

| Issue                        | Solution                                            |
| ---------------------------- | --------------------------------------------------- |
| Certificate loading errors   | Check file paths, permissions, and format           |
| mTLS authentication failures | Verify certificates, fingerprints, and TLS settings |
| Connection refused           | Check ports, firewall, and URL format               |
| Environment variable issues  | Verify required variables are set                   |

### Debug Commands

```bash
# Check certificate format
openssl x509 -in certificate.crt -text -noout

# Verify environment variables
env | grep -E "(APP_MODE|KMS_URL|ADVANCED_WALLET_MANAGER|TLS_)"

# Test connectivity
curl -k -X POST https://localhost:3080/ping
curl -k -X POST https://localhost:3081/ping
```

## License

MIT
