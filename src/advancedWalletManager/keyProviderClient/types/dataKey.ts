import z from 'zod';

export interface GenerateDataKeyParams {
  keyType: 'AES-256' | 'RSA-2048' | 'ECDSA-P256';
}

export interface GenerateDataKeyResponse {
  plaintextKey: string;
  encryptedKey: string;
}

export const GenerateDataKeyResponseSchema = z.object({
  plaintextKey: z.string(),
  encryptedKey: z.string(),
});

export interface DecryptDataKeyParams {
  encryptedKey: string;
}

export interface DecryptDataKeyResponse {
  plaintextKey: string;
}

export const DecryptDataKeyResponseSchema = z.object({
  plaintextKey: z.string(),
});
