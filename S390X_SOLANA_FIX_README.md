# s390x Solana Endianness Fix

## Problem

On s390x (big-endian) architecture, the Solana SDK incorrectly parses transaction amounts in `explainTransaction()`.

**Example:**

- Expected amount: 500000 lamports (0.0005 SOL)
- Parsed amount: 2351168177045504000 (garbage value)

## Root Cause

Solana stores transaction data (including amounts) in little-endian format in Buffers. On big-endian architectures like s390x, Node.js Buffer methods (`readBigUInt64LE`, `readUInt32LE`, etc.) do not correctly swap bytes when reading little-endian data, causing incorrect values to be read from the transaction buffers.

The issue occurs in:

- `@bitgo-beta/sdk-coin-sol/src/sol.ts:255` - `explainTransaction()` method
- Specifically when reading `instruction.params.amount` from the transaction buffer

## Solution

The `s390x-solana-endianness-fix.js` file monkey-patches Node.js Buffer prototype methods to correctly handle little-endian reads on big-endian systems by manually swapping bytes.

## Integration

### Method 1: Load at Application Startup (Recommended)

Edit `bin/advanced-wallet-manager` to load the fix before any other modules:

```javascript
#!/usr/bin/env node

// Load s390x fix FIRST, before any other imports
require('../s390x-solana-endianness-fix');

process.on('unhandledRejection', (reason, promise) => {
  console.error('----- Unhandled Rejection at -----');
  console.error(promise);
  console.error('----- Reason -----');
  console.error(reason);
});

const { init } = require('../dist/src/app');

if (require.main === module) {
  init().catch((err) => {
    console.log(`Fatal error: ${err.message}`);
    console.log(err.stack);
  });
}
```

### Method 2: Load via NODE_OPTIONS

Set the environment variable to preload the fix:

```bash
NODE_OPTIONS="--require ./s390x-solana-endianness-fix.js" npm start
```

### Method 3: Load in Docker

Add to your `Dockerfile`:

```dockerfile
# Copy the fix file
COPY s390x-solana-endianness-fix.js /app/

# Set NODE_OPTIONS to preload it
ENV NODE_OPTIONS="--require /app/s390x-solana-endianness-fix.js"
```

## Verification

When the fix is loaded successfully, you should see this console output:

```
🔧 Applying s390x Solana endianness fix...
✅ s390x Solana endianness fix applied successfully
   Patched methods: readBigUInt64LE, readBigInt64LE, readUInt32LE, readInt32LE, readUInt16LE, readInt16LE
```

On non-s390x architectures, you'll see:

```
ℹ️  s390x Solana endianness fix: Not needed on x64
```

## Testing

After applying the fix, test with a Solana transaction to verify amounts are parsed correctly:

```bash
# The amount should now be parsed correctly as 500000 instead of 2351168177045504000
```

## Technical Details

The fix patches these Buffer methods:

- `readBigUInt64LE` - Used for Solana amounts (u64/lamports)
- `readBigInt64LE` - Used for signed 64-bit values
- `readUInt32LE` - Used for 32-bit values in transaction data
- `readInt32LE` - Used for signed 32-bit values
- `readUInt16LE` - Used for 16-bit values
- `readInt16LE` - Used for signed 16-bit values

Each patched method manually reads bytes in little-endian order and constructs the correct value, effectively reversing the byte order that the big-endian system would naturally use.
