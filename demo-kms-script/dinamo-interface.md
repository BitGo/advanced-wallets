# Dinamo HSM KMS Implementation Documentation

This document provides a reference implementation for integrating the 4 KMS API's with Dinamo HSM, covering the complete request-response flow from API handlers to HSM operations.

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

## Envelope Encryption Pattern (Recommended) 

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

**Why Connection Management is Critical:**
- **Prevents Resource Leaks**: Ensures HSM connections are properly closed to avoid dangling connections
- **HSM Connection Limits**: Hardware security modules have limited concurrent connection pools
- **Network Stability**: Prevents socket exhaustion and connection timeouts
- **Security Best Practice**: Minimizes attack surface by closing connections immediately after use

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
  return await this.withClient(async (client) => {  // Connection auto-managed to prevent dangling connections
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
    
    // **CRITICAL SECURITY NOTE**: The plaintextKey contains raw cryptographic material
    // and MUST be wiped from memory immediately after encryption operations.
    // In production, use secure memory allocation and explicit zeroing.

    // 3. Encrypt with root key (envelope encryption)
    return {
      encryptedKey: encrypt(rootKey, plaintextKey),  // SJCL encryption
      plaintextKey: plaintextKey,                    // For immediate use - WIPE AFTER USE
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
6. **⚠️ MEMORY SECURITY**: Plaintext key must be wiped from memory after use

### Memory Security Best Practices

```typescript
// Example of secure memory handling (recommended for production)
async secureDataKeyGeneration(rootKey: string): Promise<GenerateDataKeyKmsRes> {
  let plaintextKey: string | null = null;
  
  try {
    const result = await this.generateDataKey(rootKey, 'AES-256');
    plaintextKey = result.plaintextKey;
    
    // Use the plaintext key immediately
    const encryptedData = encrypt(plaintextKey, sensitiveData);
    
    return {
      encryptedKey: result.encryptedKey,
      encryptedData: encryptedData
    };
  } finally {
    // **CRITICAL**: Explicitly wipe plaintext key from memory
    if (plaintextKey) {
      // Overwrite with random data multiple times
      for (let i = 0; i < 3; i++) {
        plaintextKey = crypto.randomBytes(plaintextKey.length).toString('base64');
      }
      plaintextKey = null;
    }
    
    // Force garbage collection (if available)
    if (global.gc) {
      global.gc();
    }
  }
}
```

**Security Considerations:**
- **Immediate Use**: Plaintext keys should be used immediately after generation
- **Memory Overwriting**: Overwrite memory locations with random data before deallocation
- **Garbage Collection**: Force GC to clear memory pages containing sensitive data
- **Process Isolation**: Consider using separate processes for key operations
- **Hardware Security**: Use HSM-backed secure memory when available

### Private Key Storage (POST /key)

```typescript
async postKey(rootKey: string, prv: string): Promise<PostKeyKmsRes> {
  // 1. Generate fresh data key for this private key
  const dataKey = await this.generateDataKey(rootKey, 'AES-256');
  
  let encryptedPrv: string;
  try {
    // 2. Encrypt private key with data key (use immediately)
    encryptedPrv = encrypt(dataKey.plaintextKey, prv);
  } finally {
    // **CRITICAL**: Wipe plaintext data key from memory immediately after use
    // Production code should implement secure memory wiping here
  }

  return {
    encryptedPrv,                              // Encrypted private key
    rootKeyId: rootKey,                        // Root key reference
    metadata: {
      encryptedDataKey: dataKey.encryptedKey,  // Encrypted data key
    },
  };
}
```

**Memory Security Notes:**
- **Immediate Encryption**: Use plaintext data key immediately for encryption
- **Secure Disposal**: Wipe plaintext key from memory after single use
- **No Persistence**: Never store plaintext data keys in variables or logs
- **Error Handling**: Ensure memory wiping occurs even if encryption fails

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