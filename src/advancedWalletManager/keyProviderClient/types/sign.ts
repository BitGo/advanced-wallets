import * as z from 'zod';

const SignBaseSchema = z.object({
  pub: z.string(),
  source: z.enum(['user', 'backup']),
  algorithm: z.string(),
});

export const SignParamsSchema = SignBaseSchema.extend({
  signablePayload: z.string(),
});

export const SignResponseSchema = z.object({
  signature: z.string().min(1),
});

export type SignParams = z.infer<typeof SignParamsSchema>;
export type SignResponse = z.infer<typeof SignResponseSchema>;
