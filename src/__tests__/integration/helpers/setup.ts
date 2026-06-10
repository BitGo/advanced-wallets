import * as http from 'http';
import { app as awmApp } from '../../../advancedWalletManagerApp';
import { app as mbeApp } from '../../../masterBitGoExpressApp';
import { AppMode, TlsMode, SigningMode } from '../../../shared/types';
import { DEFAULT_ASYNC_MODE_CONFIG } from '../../api/master/testUtils';
import { listen, close, LOCALHOST } from './servers';
import { startMockKeyProviderServer, MockKeyProviderServer } from './mockKeyProviderServer';
import { startMockBitgoServer, MockBitgoServer } from './mockBitgoServer';

export interface IntegServices {
  mbePort: number;
  keyProvider: MockKeyProviderServer;
  bitgo: MockBitgoServer;
  teardown(): Promise<void>;
}

export interface StartServicesOptions {
  signingMode?: SigningMode;
  recoveryMode?: boolean;
}

export async function startServices(opts: StartServicesOptions = {}): Promise<IntegServices> {
  const signingMode = opts.signingMode ?? SigningMode.LOCAL;
  const recoveryMode = opts.recoveryMode ?? false;

  const keyProvider = await startMockKeyProviderServer();
  const bitgo = await startMockBitgoServer();

  const awmServer = http.createServer(
    awmApp({
      signingMode,
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      tlsMode: TlsMode.DISABLED,
      port: 0,
      bind: LOCALHOST,
      timeout: 30000,
      httpLoggerFile: '',
      keyProviderUrl: `http://${LOCALHOST}:${keyProvider.port}`,
      recoveryMode,
    }),
  );
  const awmPort = await listen(awmServer);

  const mbeServer = http.createServer(
    mbeApp({
      appMode: AppMode.MASTER_EXPRESS,
      tlsMode: TlsMode.DISABLED,
      port: 0,
      bind: LOCALHOST,
      timeout: 30000,
      httpLoggerFile: '',
      env: 'test',
      disableEnvCheck: true,
      advancedWalletManagerUrl: `http://${LOCALHOST}:${awmPort}`,
      awmServerCertAllowSelfSigned: true,
      customRootUri: `http://${LOCALHOST}:${bitgo.port}`,
      asyncModeConfig: DEFAULT_ASYNC_MODE_CONFIG,
      recoveryMode,
    }),
  );
  const mbePort = await listen(mbeServer);

  return {
    mbePort,
    keyProvider,
    bitgo,
    async teardown() {
      await close(mbeServer);
      await close(awmServer);
      await keyProvider.close();
      await bitgo.close();
    },
  };
}
