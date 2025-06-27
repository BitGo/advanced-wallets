declare module 'keccak' {
  import { Hash } from 'crypto';

  function createKeccakHash(algorithm: string): Hash;

  export = createKeccakHash;
}
