/**
 * Solana s390x Big-Endian Fix
 *
 * Problem:
 * On s390x (big-endian) architecture, the Solana SDK incorrectly parses transaction amounts.
 * When parsing Solana transactions in explainTransaction(), the amount field reads garbage values
 * instead of the correct lamport amounts (e.g., reads 2351168177045504000 instead of 500000).
 *
 * Root Cause:
 * Solana stores transaction data (including amounts) in little-endian format in Buffers.
 * On big-endian architectures like s390x, Node.js Buffer methods (readBigUInt64LE, readUInt32LE, etc.)
 * do not correctly swap bytes when reading little-endian data.
 *
 * Solution:
 * This patch monkey-patches Buffer.prototype methods to correctly handle little-endian reads
 * on big-endian systems by manually swapping bytes in the correct order.
 *
 * Usage:
 * Load this file BEFORE initializing the Solana SDK:
 *   require('./s390x-solana-endianness-fix');
 */

// Only apply patch on s390x architecture
if (process.arch === 's390x') {
  console.log('🔧 Applying s390x Solana endianness fix...');

  // Store original methods
  const originalReadBigUInt64LE = Buffer.prototype.readBigUInt64LE;
  const originalReadBigInt64LE = Buffer.prototype.readBigInt64LE;
  const originalReadUInt32LE = Buffer.prototype.readUInt32LE;
  const originalReadInt32LE = Buffer.prototype.readInt32LE;
  const originalReadUInt16LE = Buffer.prototype.readUInt16LE;
  const originalReadInt16LE = Buffer.prototype.readInt16LE;

  /**
   * Manually read little-endian BigUInt64 by swapping bytes
   * Solana amounts are stored as u64 (8-byte unsigned integers)
   */
  function readBigUInt64LEFixed(offset = 0) {
    // Read 8 bytes and construct BigInt in little-endian order
    let result = 0n;
    for (let i = 7; i >= 0; i--) {
      result = (result << 8n) | BigInt(this[offset + i]);
    }
    return result;
  }

  /**
   * Manually read little-endian BigInt64 by swapping bytes
   */
  function readBigInt64LEFixed(offset = 0) {
    let result = 0n;
    for (let i = 7; i >= 0; i--) {
      result = (result << 8n) | BigInt(this[offset + i]);
    }
    // Handle two's complement for signed values
    if (result >= 0x8000000000000000n) {
      result = result - 0x10000000000000000n;
    }
    return result;
  }

  /**
   * Manually read little-endian UInt32 by swapping bytes
   */
  function readUInt32LEFixed(offset = 0) {
    return (
      this[offset] |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16) |
      (this[offset + 3] * 0x1000000) // Use multiplication to avoid signed int issues
    );
  }

  /**
   * Manually read little-endian Int32 by swapping bytes
   */
  function readInt32LEFixed(offset = 0) {
    const value =
      this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24);
    return value;
  }

  /**
   * Manually read little-endian UInt16 by swapping bytes
   */
  function readUInt16LEFixed(offset = 0) {
    return this[offset] | (this[offset + 1] << 8);
  }

  /**
   * Manually read little-endian Int16 by swapping bytes
   */
  function readInt16LEFixed(offset = 0) {
    const value = this[offset] | (this[offset + 1] << 8);
    return value & 0x8000 ? value | 0xffff0000 : value;
  }

  // Apply patches
  Buffer.prototype.readBigUInt64LE = function (offset = 0) {
    try {
      return readBigUInt64LEFixed.call(this, offset);
    } catch (err) {
      console.error('s390x readBigUInt64LE error:', err);
      return originalReadBigUInt64LE.call(this, offset);
    }
  };

  Buffer.prototype.readBigInt64LE = function (offset = 0) {
    try {
      return readBigInt64LEFixed.call(this, offset);
    } catch (err) {
      console.error('s390x readBigInt64LE error:', err);
      return originalReadBigInt64LE.call(this, offset);
    }
  };

  Buffer.prototype.readUInt32LE = function (offset = 0) {
    try {
      return readUInt32LEFixed.call(this, offset);
    } catch (err) {
      console.error('s390x readUInt32LE error:', err);
      return originalReadUInt32LE.call(this, offset);
    }
  };

  Buffer.prototype.readInt32LE = function (offset = 0) {
    try {
      return readInt32LEFixed.call(this, offset);
    } catch (err) {
      console.error('s390x readInt32LE error:', err);
      return originalReadInt32LE.call(this, offset);
    }
  };

  Buffer.prototype.readUInt16LE = function (offset = 0) {
    try {
      return readUInt16LEFixed.call(this, offset);
    } catch (err) {
      console.error('s390x readUInt16LE error:', err);
      return originalReadUInt16LE.call(this, offset);
    }
  };

  Buffer.prototype.readInt16LE = function (offset = 0) {
    try {
      return readInt16LEFixed.call(this, offset);
    } catch (err) {
      console.error('s390x readInt16LE error:', err);
      return originalReadInt16LE.call(this, offset);
    }
  };

  console.log('✅ s390x Solana endianness fix applied successfully');
  console.log(
    '   Patched methods: readBigUInt64LE, readBigInt64LE, readUInt32LE, readInt32LE, readUInt16LE, readInt16LE',
  );
} else {
  console.log('ℹ️  s390x Solana endianness fix: Not needed on', process.arch);
}

module.exports = {};
