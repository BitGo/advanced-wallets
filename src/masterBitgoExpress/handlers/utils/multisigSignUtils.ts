import { Keychain, PrebuildTransactionResult, SignedTransaction } from '@bitgo-beta/sdk-core';
import { z } from 'zod';
import { AsyncJobResponse } from '../../clients/bridgeClient.types';
import { BadRequestError } from '../../../shared/errors';
import { KeySource, MasterExpressConfig, UserOrBackupKey } from '../../../shared/types';
import { BitGoRequest } from '../../../types/request';
import { submitJobViaBridgeClient } from './asyncUtils';

export type MultisigSignSource = 'user' | 'backup';

export type MultisigSignBody = {
  source: MultisigSignSource;
  pub: string;
  txPrebuild: PrebuildTransactionResult;
  walletPubs?: string[];
};

/** Minimal shape /sign from bridge client; bridge returns it as unknown */
export const SignedMultisigTransactionSchema = z
  .object({
    txHex: z.string().optional(),
    halfSigned: z.record(z.unknown()).optional(),
  })
  .passthrough()
  .refine(
    (body) =>
      typeof body.txHex === 'string' ||
      (typeof body.halfSigned === 'object' && body.halfSigned !== null),
    { message: 'expected txHex or halfSigned' },
  );

export type SignedMultisigTransaction = z.infer<typeof SignedMultisigTransactionSchema>;

export function parseSignedMultisigTransaction(body: unknown): SignedTransaction {
  return SignedMultisigTransactionSchema.parse(body) as SignedTransaction;
}

export const WP_SUBMIT_KINDS = ['sendMany'] as const;
export type WpSubmitKind = (typeof WP_SUBMIT_KINDS)[number];

export function isWpSubmitKind(value: unknown): value is WpSubmitKind {
  return typeof value === 'string' && (WP_SUBMIT_KINDS as readonly string[]).includes(value);
}

export type MultisigSignJobContext = {
  walletId: string;
  wpSubmitKind: WpSubmitKind;
  wpSubmitParams: Record<string, unknown>;
};

export function parseMultisigSignJobContext(
  body: Record<string, unknown> | undefined,
): MultisigSignJobContext {
  if (!body || typeof body.walletId !== 'string') {
    throw new Error('job request.body missing walletId');
  }
  if (!isWpSubmitKind(body.wpSubmitKind)) {
    throw new Error(
      `job request.body missing or unsupported wpSubmitKind: ${String(body.wpSubmitKind)}`,
    );
  }
  if (!body.wpSubmitParams || typeof body.wpSubmitParams !== 'object') {
    throw new Error('job request.body missing wpSubmitParams');
  }
  return {
    walletId: body.walletId,
    wpSubmitKind: body.wpSubmitKind,
    wpSubmitParams: body.wpSubmitParams as Record<string, unknown>,
  };
}

const SOURCE_TO_KEY_SOURCE = {
  user: KeySource.USER,
  backup: KeySource.BACKUP,
} as const satisfies Record<MultisigSignSource, UserOrBackupKey>;

export function buildMultisigSignBody(params: {
  source: MultisigSignSource;
  signingKeychain: Keychain;
  txPrebuilt: PrebuildTransactionResult;
  walletPubs?: string[];
}): MultisigSignBody {
  if (!params.signingKeychain.pub) {
    throw new BadRequestError(`Signing keychain pub not found for ${params.source}`);
  }

  return {
    source: params.source,
    pub: params.signingKeychain.pub,
    txPrebuild: params.txPrebuilt,
    ...(params.walletPubs && { walletPubs: params.walletPubs }),
  };
}

export async function submitMultisigSignJob(
  req: BitGoRequest<MasterExpressConfig>,
  coin: string,
  signBody: MultisigSignBody,
  jobContext: MultisigSignJobContext,
): Promise<AsyncJobResponse | null> {
  return submitJobViaBridgeClient(req, {
    path: `/api/${coin}/multisig/sign`,
    body: { ...signBody, ...jobContext },
    sources: [SOURCE_TO_KEY_SOURCE[signBody.source]],
    operationType: 'multisig_sign',
  });
}
