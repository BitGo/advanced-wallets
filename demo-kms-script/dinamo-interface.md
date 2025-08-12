# Dinamo HSM KMS Implementation Documentation

This document provides comprehensive documentation for the KMS API's integration with Dinamo HSM, covering the complete request-response flow from API handlers to HSM operations.

## Demo Scripts

- **`real-dinamo-flow.ts`** - Complete handler-to-provider-to-HSM-to-database flow demonstration
- **`dinamo-provider-implementation.ts`** - Core provider implementation patterns and methods
- **`DINAMO_HSM_IMPLEMENTATION.md`** - Original deep-dive documentation (legacy)

## Quick Overview

The KMS API provides secure key management through four main endpoints that integrate with Dinamo HSM:

- `POST /key` - Store private keys using envelope encryption
- `GET /key/{pub}` - Retrieve private keys using envelope decryption  
- `POST /generateDataKey` - Generate AES keys in HSM for encryption
- `POST /decryptDataKey` - Decrypt data keys using root keys

## Architecture Flow

```
API Request → Handler → KMS Provider → Dinamo HSM → Database → Response
```

### Handler-to-Provider Mapping

| API Endpoint | Handler File | Provider Method | HSM Operations |
|--------------|--------------|-----------------|----------------|
| `POST /key` | `storePrivateKey.ts` | `postKey()` | Create AES key, export, encrypt |
| `GET /key/{pub}` | `getPrivateKey.ts` | `getKey()` | Decrypt data key locally |
| `POST /generateDataKey` | `generateDataKey.ts` | `generateDataKey()` | Create/export AES key |
| `POST /decryptDataKey` | `decryptDataKey.ts` | `decryptDataKey()` | Local SJCL decryption |

## Envelope Encryption Pattern

### Layer 1: Root Keys (HSM)
- **Algorithm**: RSA-2048 asymmetric keys
- **Storage**: Dinamo HSM hardware (permanent)
- **Purpose**: Encrypt/decrypt data keys
- **Security**: Never exported from HSM

### Layer 2: Data Keys (Generated in HSM, Used Locally)
- **Algorithm**: AES-256 symmetric keys
- **Generation**: Dinamo HSM (temporary keys)
- **Export**: Raw key material exported as Buffer
- **Encryption**: Encrypted with root key using SJCL
- **Storage**: Database (encrypted), Memory (plaintext, temporary)

### Layer 3: Private Keys (Application Data)
- **Encryption**: AES-256-CCM using SJCL
- **Key**: Data key plaintext (from Layer 2)
- **Storage**: Database (encrypted only)

## Implementation Details

### Connection Management Pattern

```typescript
private async withClient<T>(fn: (client) => Promise<T>): Promise<T> {
  const conn = await hsm.connect({
    host: process.env.DINAMO_HOST || "",
    authUsernamePassword: {
      username: process.env.DINAMO_USERNAME || "",
      password: process.env.DINAMO_PASSWORD || "",
    },
  });

  try {
    return await fn(conn);
  } finally {
    try {
      await conn.disconnect();
    } catch (e) {
      logger.warn("Failed to disconnect from Dinamo HSM", e);
    }
  }
}
```

**Key Features:**
- Environment-based configuration
- Automatic connection cleanup using try/finally
- Error handling for disconnect failures
- Generic typing for return values
- Centralized connection logic for all HSM operations

### Root Key Creation

```typescript
async createRootKey(): Promise<{ rootKey: string }> {
  const keyName = getRandomHash(32);
  
  return await this.withClient(async (client) => {
    const created = await client.key.create(
      keyName,                                    // Unique key identifier
      hsm.enums.RSA_ASYMMETRIC_KEYS.ALG_RSA_2048, // 2048-bit RSA
      true,                                       // Exportable for public key ops
      false                                       // Permanent storage
    );
    
    if (!created) {
      throw { message: 'Failed to create symmetric key in HSM', code: 500 };
    }
    
    return { rootKey: keyName };
  });
}
```

**HSM Operations:**
- **Key Naming**: 32-character random hash for uniqueness
- **Algorithm**: RSA-2048 for asymmetric operations
- **Exportable**: Set to true to allow public key export
- **Permanent**: Root keys stored permanently in HSM
- **Error Handling**: Structured errors with HTTP codes

### Data Key Generation Process

```typescript
async generateDataKey(rootKey: string, keySpec: DataKeyTypeType): Promise<GenerateDataKeyKmsRes> {
  return await this.withClient(async (client) => {
    // 1. Create temporary AES key in HSM
    const dataKeyName = getRandomHash(32);
    const created = await client.key.create(
      dataKeyName,
      hsm.enums.SYMMETRICAL_KEYS.ALG_AES_256,  // 256-bit AES
      true,                                     // Exportable
      true                                      // Temporary (auto-deleted)
    );

    // 2. Export plaintext key material
    const exportedKey = await client.key.exportSymmetric(dataKeyName);
    const plaintextKey = exportedKey.toString('base64');

    // 3. Encrypt with root key (envelope encryption)
    return {
      encryptedKey: encrypt(rootKey, plaintextKey),  // SJCL encryption
      plaintextKey: plaintextKey,                    // For immediate use
    };
  });
}
```

**Process Flow:**
1. **Temporary Key Creation**: AES-256 symmetric key in HSM
2. **Key Export**: Raw key material extracted as Buffer
3. **Format Conversion**: Buffer → base64 string
4. **Envelope Encryption**: Encrypt plaintext with root key
5. **Automatic Cleanup**: HSM deletes temporary key

### Private Key Storage (POST /key)

```typescript
async postKey(rootKey: string, prv: string): Promise<PostKeyKmsRes> {
  // 1. Generate fresh data key for this private key
  const dataKey = await this.generateDataKey(rootKey, 'AES-256');
  
  // 2. Encrypt private key with data key
  const encryptedPrv = encrypt(dataKey.plaintextKey, prv);

  return {
    encryptedPrv,                              // Encrypted private key
    rootKeyId: rootKey,                        // Root key reference
    metadata: {
      encryptedDataKey: dataKey.encryptedKey,  // Encrypted data key
    },
  };
}
```

**Encryption Layers:**
- **Layer 1**: Private Key → AES-256-CCM → Encrypted Private Key
  - Uses plaintextKey from HSM-generated data key
  - SJCL library for AES-256-CCM encryption
- **Layer 2**: Data Key → Local AES → Encrypted Data Key  
  - Uses root key as password
  - Custom encrypt() function from utils/encrypt.ts

### Private Key Retrieval (GET /key/{pub})

```typescript
async getKey(rootKey: string, keyId: string, options: GetKeyOptions): Promise<GetKeyKmsRes> {
  // 1. Decrypt data key using root key
  const decryptedKey = await this.decryptDataKey(rootKey, options.encryptedDataKey);
  
  // 2. Convert data key format
  const aesKeyBuffer = Buffer.from(decryptedKey.plaintextKey, 'base64');
  const password = aesKeyBuffer.toString('base64');
  
  // 3. Decrypt private key with recovered data key
  const decryptedPrv = decrypt(password, keyId);
  
  return { prv: decryptedPrv };
}
```

**Decryption Process:**
1. **Data Key Recovery**: Decrypt encrypted data key with root key
2. **Format Conversion**: base64 → Buffer → base64 (consistent format)
3. **Private Key Decryption**: Use recovered data key to decrypt private key

### Data Key Decryption

```typescript
async decryptDataKey(rootKey: string, encryptedKey: string): Promise<DecryptDataKeyKmsRes> {
  return {
    plaintextKey: decrypt(rootKey, encryptedKey),
  };
}
```

**Implementation Notes:**
- **Local Operation**: Uses SJCL decryption, not HSM
- **Root Key as Password**: Simple symmetric decryption
- **Performance**: Fast local operation vs. slower HSM calls

## Database Schema

### private_keys Table

```sql
CREATE TABLE private_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pub TEXT NOT NULL,                    -- Public key (identifier)
  source TEXT NOT NULL,                 -- 'user' or 'backup'
  encryptedPrv TEXT NOT NULL,           -- Private key encrypted with data key
  encryptedDataKey TEXT NOT NULL,       -- Data key encrypted with root key
  provider TEXT NOT NULL,               -- 'dinamo'
  rootKey TEXT NOT NULL,                -- Root key name in HSM
  coin TEXT NOT NULL,                   -- Cryptocurrency type
  type TEXT NOT NULL,                   -- Key type (e.g., 'tss')
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Storage Pattern:**
- **encryptedPrv**: SJCL AES-256-CCM encrypted private key
- **encryptedDataKey**: Root-key-encrypted data key
- **rootKey**: Reference to HSM root key name
- **No plaintext**: All sensitive data encrypted

## SJCL Encryption Details

### Configuration
- **Algorithm**: AES-256-CCM
- **Iterations**: 10,000 (PBKDF2)
- **Key Size**: 256 bits
- **Tag Size**: 128 bits
- **Mode**: CCM (Counter with CBC-MAC)

### Example SJCL Output
```json
{
  "iv": "a1b2c3d4e5f6...",
  "v": 1,
  "iter": 10000,
  "ks": 256,
  "ts": 128,
  "mode": "ccm",
  "adata": "",
  "cipher": "aes",
  "salt": "f6e5d4c3b2a1...",
  "ct": "base64-encrypted-data"
}
```