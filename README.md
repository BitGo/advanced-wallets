# Advanced Wallet Manager

A secure, mTLS-enabled cryptocurrency signing server with two operational modes: Advanced Wallet Manager (dedicated signer) and Master Express (API gateway with integrated signing capabilities).

## Overview

This application provides secure cryptocurrency operations with mutual TLS (mTLS) authentication:

- **Advanced Wallet Manager Mode**: Lightweight signing server for secure key operations
- **Master Express Mode**: Full BitGo Express functionality with integrated signing
- **mTLS Security**: Client certificate validation for secure communications
- **Flexible Configuration**: Environment-based setup with file or variable-based certificates

## Architecture

- **Advanced Wallet Manager** (Port 3080): Focused signing operations with KMS integration
- **Master Express** (Port 3081): Full BitGo API functionality with secure communication to Advanced Wallet Manager

## Configuration

Configuration is managed through environment variables:

### Required Settings

- `APP_MODE` - Application mode (required: "advanced-wallet-manager" or "master-express")

### Network Settings

- `BIND` - Address to bind to (default: localhost)
- `TIMEOUT` - Request timeout in milliseconds (default: 305000)
- `KEEP_ALIVE_TIMEOUT` - Keep-alive timeout (optional)
- `HEADERS_TIMEOUT` - Headers timeout (optional)

#### Advanced Wallet Manager Mode Specific

- `ADVANCED_WALLET_MANAGER_PORT` - Port to listen on (default: 3080)
- `KMS_URL` - KMS service URL (required)

#### Master Express Mode Specific

- `MASTER_EXPRESS_PORT` - Port to listen on (default: 3081)
- `BITGO_ENV` - BitGo environment (default: test)
- `BITGO_DISABLE_ENV_CHECK` - Disable environment check (default: true)
- `BITGO_AUTH_VERSION` - Authentication version (default: 2)
- `BITGO_CUSTOM_ROOT_URI` - Custom BitGo API root URI (optional)
- `BITGO_CUSTOM_BITCOIN_NETWORK` - Custom Bitcoin network (optional)
- `ADVANCED_WALLET_MANAGER_URL` - Advanced Wallet Manager URL (required)
- `ADVANCED_WALLET_MANAGER_CERT` - Path to Advanced Wallet Manager certificate (required)

### TLS/mTLS Configuration

Both modes use the same TLS configuration variables:

#### TLS Mode

- `TLS_MODE` - Set to either "mtls" or "disabled" (defaults to "mtls" if not set)

#### Certificate Configuration (required when TLS_MODE=mtls)

**Option 1: Certificate Files**

- `TLS_KEY_PATH` - Path to private key file (used for both inbound mTLS server and outbound mTLS client to KMS)
- `TLS_CERT_PATH` - Path to certificate file (used for both inbound mTLS server and outbound mTLS client to KMS)

**Option 2: Environment Variables**

- `TLS_KEY` - Private key content (PEM format, used for both inbound and outbound)
- `TLS_CERT` - Certificate content (PEM format, used for both inbound and outbound)

#### mTLS Settings (when TLS_MODE=mtls)

- `MTLS_REQUEST_CERT` - Request client certificates (default: true)
- `ALLOW_SELF_SIGNED` - Allow self-signed certificates (default: false)
- `MTLS_ALLOWED_CLIENT_FINGERPRINTS` - Comma-separated list of allowed client certificate fingerprints (optional)

#### Outbound mTLS to KMS

- When `TLS_MODE=mtls`, outbound mTLS to KMS is enabled by default.
- The same `TLS_CERT` and `TLS_KEY` are used as the client certificate and key for outbound mTLS requests to KMS.
- `KMS_TLS_CERT_PATH` - Path to the CA certificate to verify the KMS server (required when outbound mTLS is enabled).
- If `TLS_MODE=disabled`, outbound mTLS to KMS is also disabled by default.

> **Note:** If you want to use a different client certificate for KMS, you will need to extend the configuration. By default, the same cert/key is used for both inbound and outbound mTLS.

### Logging and Debug

- `HTTP_LOGFILE` - Path to HTTP request log file (optional, used by Morgan for HTTP access logs)

## Quick Start

### 1. Generate Test Certificates

First, create self-signed certificates for testing:

```bash
# Generate private key
openssl genrsa -out server.key 2048

# Generate certificate
openssl req -new -x509 -key server.key -out server.crt -days 365 -subj "/CN=localhost"
```

### 2. Start Advanced Wallet Manager

```bash
export APP_MODE=advanced-wallet-manager
export KMS_URL=https://your-kms-service
export TLS_KEY_PATH=./server.key
export TLS_CERT_PATH=./server.crt
export MTLS_REQUEST_CERT=true
export ALLOW_SELF_SIGNED=true
npm start
```

### 4. Start Master Express

In a separate terminal:

```bash
export APP_MODE=master-express
export BITGO_ENV=test
export TLS_KEY_PATH=./server.key
export TLS_CERT_PATH=./server.crt
export ADVANCED_WALLET_MANAGER_URL=https://localhost:3080
export ADVANCED_WALLET_MANAGER_CERT=./server.crt
export MTLS_REQUEST_CERT=false
export ALLOW_SELF_SIGNED=true
npm start
```

### 5. Test the Connection

Test that Master Express can communicate with Advanced Wallet Manager:

```bash
curl -k -X POST https://localhost:3081/ping/advancedWalletManager
```

## Production Configuration

### Security Best Practices

1. **Use CA-signed certificates** instead of self-signed
2. **Set `ALLOW_SELF_SIGNED=false`** in production
3. **Configure client certificate allowlisting** with `MTLS_ALLOWED_CLIENT_FINGERPRINTS`
4. **Use separate certificates** for each service
5. **Regularly rotate certificates**
6. **Secure private key storage**

### Production Setup Example

#### Advanced Wallet Manager (Production)

```bash
export APP_MODE=advanced-wallet-manager
export KMS_URL=https://production-kms.example.com
export TLS_KEY_PATH=/secure/path/advanced-wallet-manager.key
export TLS_CERT_PATH=/secure/path/advanced-wallet-manager.crt
export MTLS_REQUEST_CERT=true
export ALLOW_SELF_SIGNED=false
export MTLS_ALLOWED_CLIENT_FINGERPRINTS=ABC123...,DEF456...
npm start
```

#### Master Express (Production)

```bash
export APP_MODE=master-express
export BITGO_ENV=prod
export TLS_KEY_PATH=/secure/path/master.key
export TLS_CERT_PATH=/secure/path/master.crt
export ADVANCED_WALLET_MANAGER_URL=https://advanced-wallet-manager.internal.example.com:3080
export ADVANCED_WALLET_MANAGER_CERT=/secure/path/advanced-wallet-manager.crt
export MTLS_REQUEST_CERT=true
export ALLOW_SELF_SIGNED=false
npm start
```

## Container Deployment with Podman

First, build the container image:

```bash
# For Master Express (default port 3081)
npm run container:build

# For Advanced Wallet Manager (port 3080)
npm run container:build --build-arg PORT=3080
```

For local development, you'll need to run both the Advanced Wallet Manager and Master Express containers:

```bash
# Start Advanced Wallet Manager container
podman run -d \
  -p 3080:3080 \
  -v $(pwd)/certs:/app/certs:Z \
  -e APP_MODE=advanced-wallet-manager \
  -e BIND=0.0.0.0 \
  -e TLS_MODE=mtls \
  -e TLS_KEY_PATH=/app/certs/advanced-wallet-manager-key.pem \
  -e TLS_CERT_PATH=/app/certs/advanced-wallet-manager-cert.pem \
  -e KMS_URL=host.containers.internal:3000 \
  -e NODE_ENV=development \
  -e ALLOW_SELF_SIGNED=true \
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
  -e TLS_KEY_PATH=/app/certs/test-ssl-key.pem \
  -e TLS_CERT_PATH=/app/certs/test-ssl-cert.pem \
  -e ADVANCED_WALLET_MANAGER_URL=https://host.containers.internal:3080 \
  -e ADVANCED_WALLET_MANAGER_CERT=/app/certs/advanced-wallet-manager-cert.pem \
  -e ALLOW_SELF_SIGNED=true \
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

Notes:

- `host.containers.internal` is a special DNS name that resolves to the host machine from inside containers
- The `:Z` option in volume mounts is specific to SELinux-enabled systems and ensures proper volume labeling
- The logs directory will be created with appropriate permissions if it doesn't exist

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

## Troubleshooting

### Common Issues

#### 1. Certificate Loading Errors

```bash
# Check certificate file paths and permissions
ls -la /path/to/certificates/
# Verify certificate format
openssl x509 -in certificate.crt -text -noout
```

#### 2. mTLS Authentication Failures

- Verify client certificates are provided
- Check `ALLOW_SELF_SIGNED` setting matches certificate type
- Confirm client certificate fingerprints are in allowlist
- Ensure both services use compatible TLS settings

#### 3. Connection Refused

- Verify both services are running on correct ports
- Check firewall settings
- Confirm URLs use `https://` prefix
- Test basic connectivity with curl

#### 4. Environment Variable Issues

```bash
# Check that required variables are set
env | grep -E "(APP_MODE|KMS_URL|ADVANCED_WALLET_MANAGER|TLS_)"
``

## License

MIT
```
