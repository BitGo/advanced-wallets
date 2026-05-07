import * as z from 'zod';

const GenerateKeyBaseSchema = z.object({
  coin: z.string(),
  source: z.enum(['user', 'backup']),
  type: z.enum(['independent', 'tss']),
});

export const GenerateKeyParamsSchema = GenerateKeyBaseSchema;
export const GenerateKeyResponseSchema = GenerateKeyBaseSchema.extend({
  pub: z.string(),
});

export type GenerateKeyParams = z.infer<typeof GenerateKeyParamsSchema>;
export type GenerateKeyResponse = z.infer<typeof GenerateKeyResponseSchema>;
