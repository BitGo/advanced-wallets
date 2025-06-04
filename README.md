# Enclaved BitGo Express

A secure, mTLS-enabled cryptocurrency signing server with two operational modes: Enclaved Express (dedicated signer) and Master Express (API gateway with integrated signing capabilities).

## Overview

This application provides secure cryptocurrency operations with mutual TLS (mTLS) authentication:

- **Enclaved Mode**: Lightweight signing server for secure key operations
- **Master Express Mode**: Full BitGo Express functionality with integrated signing
- **mTLS Security**: Client certificate validation for secure communications
- **Flexible Configuration**: Environment-based setup with file or variable-based certificates

## Architecture

- **Enclaved Express** (Port 3080): Focused signing operations with KMS integration
- **Master Express** (Port 3081): Full BitGo API functionality with secure communication to Enclaved Express

## Configuration

Configuration is managed through environment variables:

### Required Settings

- `APP_MODE` - Application mode (required: "enclaved" or "master-express")

### Network Settings

- `BIND` - Address to bind to (default: localhost)
- `TIMEOUT` - Request timeout in milliseconds (default: 305000)
- `KEEP_ALIVE_TIMEOUT` - Keep-alive timeout (optional)
- `HEADERS_TIMEOUT` - Headers timeout (optional)

#### Enclaved Mode Specific

- `ENCLAVED_EXPRESS_PORT` - Port to listen on (default: 3080)
- `KMS_URL` - KMS service URL (required)

#### Master Express Mode Specific

- `MASTER_EXPRESS_PORT` - Port to listen on (default: 3081)
- `BITGO_ENV` - BitGo environment (default: test)
- `BITGO_DISABLE_ENV_CHECK` - Disable environment check (default: true)
- `BITGO_AUTH_VERSION` - Authentication version (default: 2)
- `BITGO_CUSTOM_ROOT_URI` - Custom BitGo API root URI (optional)
- `BITGO_CUSTOM_BITCOIN_NETWORK` - Custom Bitcoin network (optional)
- `ENCLAVED_EXPRESS_URL` - Enclaved Express server URL (required)
- `ENCLAVED_EXPRESS_CERT` - Path to Enclaved Express server certificate (required)

### TLS/mTLS Configuration

Both modes use the same TLS configuration variables:

#### Certificate Configuration (choose one approach)

**Option 1: Certificate Files**

- `TLS_KEY_PATH` - Path to private key file
- `TLS_CERT_PATH` - Path to certificate file

**Option 2: Environment Variables**

- `TLS_KEY` - Private key content (PEM format)
- `TLS_CERT` - Certificate content (PEM format)

#### mTLS Settings

- `MTLS_REQUEST_CERT` - Request client certificates (default: true)
- `ALLOW_SELF_SIGNED` - Allow self-signed certificates (default: false)
- `MTLS_ALLOWED_CLIENT_FINGERPRINTS` - Comma-separated list of allowed client certificate fingerprints (optional)
- `MASTER_BITGO_EXPRESS_DISABLE_TLS` - Disable TLS completely (default: false)

### Logging and Debug

- `LOGFILE` - Path to log file (optional)
- `DEBUG_NAMESPACE` - Debug namespaces to enable (e.g., 'enclaved:\*')

## Quick Start

### 1. Generate Test Certificates

First, create self-signed certificates for testing:

```bash
# Generate private key
openssl genrsa -out server.key 2048

# Generate certificate
openssl req -new -x509 -key server.key -out server.crt -days 365 -subj "/CN=localhost"
```

### 2. Start Enclaved Express

```bash
APP_MODE=enclaved \
KMS_URL=https://your-kms-service \
TLS_KEY_PATH=./server.key \
TLS_CERT_PATH=./server.crt \
MTLS_REQUEST_CERT=true \
ALLOW_SELF_SIGNED=true \
yarn start
```

### 3. Start Master Express

In a separate terminal:

```bash
APP_MODE=master-express \
BITGO_ENV=test \
TLS_KEY_PATH=./server.key \
TLS_CERT_PATH=./server.crt \
ENCLAVED_EXPRESS_URL=https://localhost:3080 \
ENCLAVED_EXPRESS_CERT=./server.crt \
MTLS_REQUEST_CERT=false \
ALLOW_SELF_SIGNED=true \
yarn start
```

### 4. Test the Connection

Test that Master Express can communicate with Enclaved Express:

```bash
curl -k -X POST https://localhost:3081/ping/enclavedExpress
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

#### Enclaved Express (Production)

```bash
APP_MODE=enclaved \
KMS_URL=https://production-kms.example.com \
TLS_KEY_PATH=/secure/path/enclaved.key \
TLS_CERT_PATH=/secure/path/enclaved.crt \
MTLS_REQUEST_CERT=true \
ALLOW_SELF_SIGNED=false \
MTLS_ALLOWED_CLIENT_FINGERPRINTS=ABC123...,DEF456... \
yarn start
```

#### Master Express (Production)

```bash
APP_MODE=master-express \
BITGO_ENV=prod \
TLS_KEY_PATH=/secure/path/master.key \
TLS_CERT_PATH=/secure/path/master.crt \
ENCLAVED_EXPRESS_URL=https://enclaved.internal.example.com:3080 \
ENCLAVED_EXPRESS_CERT=/secure/path/enclaved.crt \
MTLS_REQUEST_CERT=true \
ALLOW_SELF_SIGNED=false \
yarn start
```

## API Endpoints

### Enclaved Express (Port 3080)

- `POST /ping` - Health check
- `GET /version` - Version information
- `POST /:coin/key/independentKey` - Generate independent keychain

### Master Express (Port 3081)

- `POST /ping` - Health check
- `GET /version` - Version information
- `POST /ping/enclavedExpress` - Test connection to Enclaved Express
- `POST /api/:coin/wallet/generate` - Generate wallet (with Enclaved Express integration)

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
env | grep -E "(APP_MODE|KMS_URL|ENCLAVED_EXPRESS|TLS_)"
```

### Debug Mode

Enable debug logging for detailed troubleshooting:

```bash
DEBUG_NAMESPACE=enclaved:*,master:* yarn start
```

## License

MIT
