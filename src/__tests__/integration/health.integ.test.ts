import 'should';
import * as http from 'http';
import { app as awmApp } from '../../advancedWalletManagerApp';
import { app as mbeApp } from '../../masterBitGoExpressApp';
import { AppMode, TlsMode, SigningMode } from '../../shared/types';
import { listen, close, LOCALHOST } from './helpers/servers';

describe('Integration Test — health checks', () => {
  let awmServer: http.Server;
  let mbeServer: http.Server;
  let awmPort: number;
  let mbePort: number;

  before(async () => {
    awmServer = http.createServer(
      awmApp({
        appMode: AppMode.ADVANCED_WALLET_MANAGER,
        tlsMode: TlsMode.DISABLED,
        signingMode: SigningMode.LOCAL,
        port: 0,
        bind: LOCALHOST,
        timeout: 30000,
        httpLoggerFile: '',
        keyProviderUrl: `http://${LOCALHOST}:3082`,
      }),
    );
    awmPort = await listen(awmServer);

    mbeServer = http.createServer(
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
      }),
    );
    mbePort = await listen(mbeServer);
  });

  after(async () => {
    await close(awmServer);
    await close(mbeServer);
  });

  it('AWM /ping returns 200', async () => {
    const res = await fetch(`http://${LOCALHOST}:${awmPort}/ping`, { method: 'POST' });
    res.status.should.equal(200);
  });

  it('MBE /advancedwallet/ping returns 200', async () => {
    const res = await fetch(`http://${LOCALHOST}:${mbePort}/advancedwallet/ping`, {
      method: 'POST',
    });
    res.status.should.equal(200);
  });
});
