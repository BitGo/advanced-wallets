import * as z from 'zod';

export interface PostKeyParams {
  prv: string;
  pub: string;
  coin: string;
  source: string;
  type: 'independent' | 'enclaved';
  seed?: string; // Optional seed for key generation
}

export interface PostKeyResponse {
  pub: string;
  coin: string;
  source: string;
  type: 'independent' | 'enclaved';
}

export const PostKeyKmsSchema = z.object({
  pub: z.string(),
  coin: z.string(),
  source: z.enum(['user', 'backup']),
  type: z.enum(['independent', 'tss']),
});
