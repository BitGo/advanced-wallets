import * as http from 'http';
import { app as awmApp } from '../../../advancedWalletManagerApp';
import { app as mbeApp } from '../../../masterBitGoExpressApp';
import { AppMode, TlsMode, SigningMode } from '../../../shared/types';
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
}

export async function startServices(opts: StartServicesOptions = {}): Promise<IntegServices> {
  const signingMode = opts.signingMode ?? SigningMode.LOCAL;

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
