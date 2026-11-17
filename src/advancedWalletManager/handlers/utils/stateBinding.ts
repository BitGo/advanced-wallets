import { createHash } from 'crypto';
import { BadRequestError } from '../../../shared/errors';
import { TxRequest } from '@bitgo-beta/sdk-core';

/**
 * Context binding for encrypted MPC state blobs.
 *
 * AWM seals inter-round secrets under KMS data keys and the ciphertext travels
 * through the untrusted orchestrator. Without a binding, any handler that
 * unwraps a caller-supplied data key and decrypts a caller-supplied blob acts
 * as a decryption oracle for blobs from any other flow (for example, keygen
 * state replayed into the EdDSA R-share round).
 *
 * Every seal call stamps the blob's AEAD associated data with the context it
 * was created for (flow, blob type, source wallet, signable). Every unseal
 * site recomputes the expected context from the request and rejects a mismatch
 * before any plaintext is used or returned. The associated data is covered by
 * the AES-GCM tag, so it cannot be stripped or altered without breaking
 * decryption, and it cannot be forged without the data key.
 */

export const STATE_BINDING_DOMAIN = {
  EDDSA_SIGN_R_SHARE: 'AWM_EDDSA_SIGN_RSHARE_STATE',
  EDDSA_KEYGEN_INIT: 'AWM_EDDSA_KEYGEN_INIT_STATE',
  ECDSA_MPCV2_KEYGEN: 'AWM_ECDSA_MPCV2_KEYGEN_STATE',
} as const;

export const STATE_BINDING_MISMATCH_ERROR =
  'Encrypted state is not bound to this request; restart the session';

interface EncryptionSessionLike {
  encrypt(plaintext: string, adata?: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
  destroy(): void;
}

export interface StateBindingBitGo {
  createEncryptionSession(password: string): Promise<EncryptionSessionLike>;
  decrypt(params: { input: string; password: string }): Promise<string>;
}

/**
 * Builds the associated-data string for a state blob: `<domain>:v1|k=v|k=v|...`
 * with parts in sorted key order so the context is canonical.
 */
export function buildStateBindingAdata(
  domain: (typeof STATE_BINDING_DOMAIN)[keyof typeof STATE_BINDING_DOMAIN],
  parts: Record<string, string>,
): string {
  const core = [
    'v1',
    ...Object.keys(parts)
      .sort()
      .map((key) => `${key}=${parts[key]}`),
  ].join('|');
  return `${domain}:${core}`;
}

/**
 * Extracts the signing-session binding parts from a txRequest. Mirrors how the
 * SDK resolves the unsigned transaction (full: transactions[0].unsignedTx, else
 * unsignedTxs[0]) so the context matches the payload the blob was sealed for.
 * Keep in sync with the SDK's unsignedTx resolution: a drift fails closed here
 * (sealed and expected adata stop matching) rather than weakening the binding.
 */
export function getSignableBindingParts(txRequest: TxRequest): {
  signable: string;
  path: string;
} {
  const unsignedTx =
    txRequest.apiVersion === 'full'
      ? txRequest.transactions?.[0]?.unsignedTx
      : txRequest.unsignedTxs?.[0];
  if (!unsignedTx?.signableHex || !unsignedTx.derivationPath) {
    throw new BadRequestError(
      'txRequest is missing an unsigned transaction with signableHex and derivationPath',
    );
  }
  return {
    signable: createHash('sha256').update(unsignedTx.signableHex).digest('hex'),
    path: unsignedTx.derivationPath,
  };
}

/**
 * Seals a state blob under the KMS data key, binding it to the given context.
 */
export async function sealStateBlob(
  bitgo: StateBindingBitGo,
  params: { plaintextKey: string; plaintext: string; adata: string },
): Promise<string> {
  const session = await bitgo.createEncryptionSession(params.plaintextKey);
  try {
    return await session.encrypt(params.plaintext, params.adata);
  } finally {
    session.destroy();
  }
}

/**
 * Unseals a state blob: verifies that its associated data matches the expected
 * context, then decrypts. A blob from another flow, wallet, or session fails
 * the binding check before any decryption is attempted, and the error never
 * includes blob contents.
 */
export async function openStateBlob(
  bitgo: StateBindingBitGo,
  params: { plaintextKey: string; ciphertext: string; expectedAdata: string },
): Promise<string> {
  let storedAdata: unknown;
  try {
    storedAdata = JSON.parse(params.ciphertext)?.adata;
  } catch {
    throw new BadRequestError(STATE_BINDING_MISMATCH_ERROR);
  }
  // v1 (SJCL) envelopes percent-encode the adata (':' -> '%3A'); decode before comparing.
  if (typeof storedAdata !== 'string' || decodeURIComponent(storedAdata) !== params.expectedAdata) {
    throw new BadRequestError(STATE_BINDING_MISMATCH_ERROR);
  }
  return bitgo.decrypt({ input: params.ciphertext, password: params.plaintextKey });
}
