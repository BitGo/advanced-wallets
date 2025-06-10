import * as z from 'zod';

export interface GetKeyParams {
  pub: string;
  source: string;
}

export interface GetKeyResponse {
  pub: string;
  prv: string;
  source: 'user' | 'backup';
  type: 'independent' | 'tss';
}

export const GetKeyKmsSchema = z.object({
  pub: z.string(),
  prv: z.string(),
  source: z.enum(['user', 'backup']),
  type: z.enum(['independent', 'tss']),
});
