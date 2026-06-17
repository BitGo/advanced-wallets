/**
 * @param value Value to check for existence
 * @param message Error message to throw if value is null or undefined
 * @returns
 */
export function orThrow<T>(value: T | null | undefined, message: string): T {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}
