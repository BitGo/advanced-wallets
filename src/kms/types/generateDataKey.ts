import * as z from 'zod';

export interface GenerateDataKeyParams {
  keyType: 'AES-256' | 'RSA-2048' | 'ECDSA-P256';
}

export interface GenerateDataKeyResponse {
  plaintextKey: Uint8Array;
  encryptedKey: string;
}

export const GenerateDataKeyKmsSchema = z.object({
  plaintextKey: z.string(),
  encryptedKey: z.string(),
});
