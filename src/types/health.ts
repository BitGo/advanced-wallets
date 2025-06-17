import * as t from 'io-ts';

// Base type for ping response
export const PingResponseType = t.type({
  status: t.string,
  timestamp: t.string,
});

export type PingResponseType = t.TypeOf<typeof PingResponseType>;

// Base type for version response
export const VersionResponseType = t.type({
  version: t.string,
  name: t.string,
});

export type VersionResponseType = t.TypeOf<typeof VersionResponseType>;
