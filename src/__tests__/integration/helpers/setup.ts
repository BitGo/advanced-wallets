import * as http from 'http';
import { app as awmApp } from '../../../advancedWalletManagerApp';
import { app as mbeApp } from '../../../masterBitGoExpressApp';
import { AppMode, MasterExpressConfig, TlsMode, SigningMode } from '../../../shared/types';
import { DEFAULT_ASYNC_MODE_CONFIG } from '../../api/master/testUtils';
import { listen, close, LOCALHOST } from './servers';
import { startMockKeyProviderServer, MockKeyProviderServer } from './mockKeyProviderServer';
import { startMockBitgoServer, MockBitgoServer } from './mockBitgoServer';
import { startMockBridgeServer, MockBridgeServer } from './mockBridgeServer';
import { startAsyncJobWorker } from '../../../masterBitgoExpress/workers/asyncJobWorker';

export interface IntegServices {
  mbePort: number;
  keyProvider: MockKeyProviderServer;
  bitgo: MockBitgoServer;
  bridge?: MockBridgeServer;
  teardown(): Promise<void>;
}

export interface StartServicesOptions {
  signingMode?: SigningMode;
  recoveryMode?: boolean;
  asyncMode?: boolean;
}

export async function startServices(opts: StartServicesOptions = {}): Promise<IntegServices> {
  const signingMode = opts.signingMode ?? SigningMode.LOCAL;
  const recoveryMode = opts.recoveryMode ?? false;

  const keyProvider = await startMockKeyProviderServer();
  const bitgo = await startMockBitgoServer();
  const bridge = opts.asyncMode ? await startMockBridgeServer() : undefined;

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

  const mbeCfg: MasterExpressConfig = {
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
    recoveryMode,
    bitgoAccessToken: 'test-access-token',
    asyncModeConfig: bridge
      ? {
          enabled: true,
          awmAsyncUrl: `http://${LOCALHOST}:${bridge.port}`,
          pollIntervalInMs: 100,
          jobTtlInSeconds: 3600,
          jobTtlMpcInSeconds: 7200,
        }
      : DEFAULT_ASYNC_MODE_CONFIG,
  };

  const mbeServer = http.createServer(mbeApp(mbeCfg));
  const mbePort = await listen(mbeServer);

  const stopWorker = bridge ? startAsyncJobWorker(mbeCfg) : undefined;

  return {
    mbePort,
    keyProvider,
    bitgo,
    bridge,
    async teardown() {
      stopWorker?.();
      await close(mbeServer);
      await close(awmServer);
      await keyProvider.close();
      await bitgo.close();
      if (bridge) await bridge.close();
    },
  };
}
