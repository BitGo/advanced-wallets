import * as z from 'zod';

export interface GetKeyParams {
  pub: string;
  source: string;
  options?: {
    useLocalEncipherment?: boolean;
  };
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
