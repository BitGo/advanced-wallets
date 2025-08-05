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
- `IPC` - IPC socket file path (optional)
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

### TLS/mTLS Configuration

Both modes use the same TLS configuration variables:

#### TLS Mode

- `TLS_MODE` - Set to either "mtls" or "disabled" (defaults to "mtls" if not set)

#### mTLS Server Configuration (for incoming connections)

- `SERVER_TLS_KEY_PATH` - Path to the private key for the mTLS server
- `SERVER_TLS_CERT_PATH` - Path to the certificate for the mTLS server
- `SERVER_TLS_KEY` - The private key as a string (alternative to `_PATH`)
- `SERVER_TLS_CERT` - The certificate as a string (alternative to `_PATH`)

#### mTLS Client Authentication Settings (for incoming connections)

- `ALLOW_SELF_SIGNED` - Allow self-signed certificates (default: false)
- `MTLS_ALLOWED_CLIENT_FINGERPRINTS` - Comma-separated list of allowed client certificate fingerprints (optional)

#### Outbound mTLS to AWM (Master Express Mode only)

- `AWM_CLIENT_TLS_KEY_PATH` - Path to the client key that Master Express presents to the AWM
- `AWM_CLIENT_TLS_CERT_PATH` - Path to the client cert that Master Express presents to the AWM
- `AWM_CLIENT_TLS_KEY` - The client key as a string (alternative to `_PATH`)
- `AWM_CLIENT_TLS_CERT` - The client cert as a string (alternative to `_PATH`)
- `AWM_SERVER_CA_CERT_PATH` - Path to the CA certificate to verify the AWM server (required when TLS_MODE=mtls)
- `AWM_SERVER_CA_CERT` - The CA certificate as a string (alternative to `_PATH`)
- `AWM_SERVER_CERT_ALLOW_SELF_SIGNED` - Allow self-signed certificates from the AWM (default: false)
- **Fallback:** If client certs are not provided, `SERVER_TLS_KEY_PATH` and `SERVER_TLS_CERT_PATH` are used

#### Outbound mTLS to KMS (AWM Mode only)

- `KMS_CLIENT_TLS_KEY_PATH` - Path to the client key that AWM presents to the KMS
- `KMS_CLIENT_TLS_CERT_PATH` - Path to the client cert that AWM presents to the KMS
- `KMS_CLIENT_TLS_KEY` - The client key as a string (alternative to `_PATH`)
- `KMS_CLIENT_TLS_CERT` - The client cert as a string (alternative to `_PATH`)
- `KMS_SERVER_CA_CERT_PATH` - Path to the CA certificate to verify the KMS server (required when TLS_MODE=mtls)
- `KMS_SERVER_CA_CERT` - The CA certificate as a string (alternative to `_PATH`)
- `KMS_SERVER_CERT_ALLOW_SELF_SIGNED` - Allow self-signed certificates from the KMS (default: false)
- **Fallback:** If client certs are not provided, `SERVER_TLS_KEY_PATH` and `SERVER_TLS_CERT_PATH` are used

### Logging and Debug

- `HTTP_LOGFILE` - Path to HTTP request log file (optional, used by Morgan for HTTP access logs)
- `NODE_ENV` - Node environment (development, production, test)
- `LOG_LEVEL` - Log level (silent, error, warn, info, http, debug)
- `RECOVERY_MODE` - Enable recovery mode (default: false)

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
export KMS_SERVER_CA_CERT_PATH=./server.crt
export KMS_SERVER_CERT_ALLOW_SELF_SIGNED=true
export SERVER_TLS_KEY_PATH=./server.key
export SERVER_TLS_CERT_PATH=./server.crt
export CLIENT_CERT_ALLOW_SELF_SIGNED=true
npm start
```

### 3. Start Master Express

In a separate terminal:

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

### 4. Test the Connection

Test that Master Express can communicate with Advanced Wallet Manager:

```bash
curl -k -X POST https://localhost:3081/ping/advancedWalletManager
```

## Production Configuration

### Security Best Practices

1. **Use CA-signed certificates** instead of self-signed
2. **Set `CLIENT_CERT_ALLOW_SELF_SIGNED=false`** in production
3. **Configure client certificate allowlisting** with `MTLS_ALLOWED_CLIENT_FINGERPRINTS`
4. **Use separate certificates** for each service
5. **Regularly rotate certificates**
6. **Secure private key storage**

### Production Setup Example

#### Advanced Wallet Manager (Production)

```bash
export APP_MODE=advanced-wallet-manager
export KMS_URL=https://production-kms.example.com
export SERVER_TLS_KEY_PATH=/secure/path/awm-server.key
export SERVER_TLS_CERT_PATH=/secure/path/awm-server.crt
export KMS_CLIENT_TLS_KEY_PATH=/secure/path/awm-kms-client.key
export KMS_CLIENT_TLS_CERT_PATH=/secure/path/awm-kms-client.crt
export KMS_SERVER_CA_CERT_PATH=/secure/path/kms-ca.crt
export CLIENT_CERT_ALLOW_SELF_SIGNED=false
export MTLS_ALLOWED_CLIENT_FINGERPRINTS=ABC123...,DEF456...
npm start
```

#### Master Express (Production)

```bash
export APP_MODE=master-express
export BITGO_ENV=prod
export SERVER_TLS_KEY_PATH=/secure/path/master-server.key
export SERVER_TLS_CERT_PATH=/secure/path/master-server.crt
export AWM_CLIENT_TLS_KEY_PATH=/secure/path/master-awm-client.key
export AWM_CLIENT_TLS_CERT_PATH=/secure/path/master-awm-client.crt
export ADVANCED_WALLET_MANAGER_URL=https://advanced-wallet-manager.internal.example.com:3080
export AWM_SERVER_CA_CERT_PATH=/secure/path/awm-ca.crt
export CLIENT_CERT_ALLOW_SELF_SIGNED=false
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
- Check `CLIENT_CERT_ALLOW_SELF_SIGNED` setting matches certificate type
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
```

## License

MIT
