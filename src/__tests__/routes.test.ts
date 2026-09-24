import 'should';

import request from 'supertest';
import express from 'express';
import { AppMode, TlsMode, SigningMode } from '../shared/types';
import { app as awmApp } from '../advancedWalletManagerApp';
import { app as mbeApp } from '../masterBitGoExpressApp';
import { makeMasterExpressTestConfig } from './api/master/testUtils';
import { setupRoutes } from '../advancedWalletManager/routers/advancedWalletManager';

describe('Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    setupRoutes(app, {
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.LOCAL,
      httpLoggerFile: '',
      clientCertAllowSelfSigned: true,
      tlsMode: TlsMode.DISABLED,
      keyProviderUrl: 'http://localhost:3000/key-provider',
      timeout: 5000,
      port: 3000,
      bind: 'localhost',
    });
  });

  describe('Recovery authorization without TLS', () => {
    const token = 'test-recovery-token-at-least-32-characters';
    const awm = awmApp({
      appMode: AppMode.ADVANCED_WALLET_MANAGER,
      signingMode: SigningMode.LOCAL,
      keyProviderUrl: 'http://localhost:3000',
      bind: 'localhost',
      port: 0,
      timeout: 5000,
      httpLoggerFile: '',
      tlsMode: TlsMode.DISABLED,
      recoveryMode: true,
      recoveryAuthToken: token,
    });
    const mbe = mbeApp(
      makeMasterExpressTestConfig('http://localhost:3080', {
        overrides: { recoveryMode: true, recoveryAuthToken: token },
      }),
    );

    for (const path of [
      '/api/tbtc/multisig/recovery',
      '/api/tbtc/mpc/recovery',
      '/api/tbtc/mpcv2/recovery',
    ]) {
      it(`rejects missing and incorrect tokens on AWM ${path}`, async () => {
        (await request(awm).post(path).send({})).status.should.equal(401);
        (
          await request(awm).post(path).set('x-recovery-token', 'wrong').send({})
        ).status.should.equal(401);
        (
          await request(awm).post(path).set('x-recovery-token', token).send({})
        ).status.should.not.equal(401);
      });
    }

    for (const path of [
      '/api/v1/tbtc/advancedwallet/recovery',
      '/api/v1/tbtc/advancedwallet/recoveryconsolidations',
    ]) {
      it(`rejects missing and incorrect tokens on MBE ${path}`, async () => {
        (
          await request(mbe).post(path).set('Authorization', 'Bearer bitgo-token').send({})
        ).status.should.equal(401);
        (
          await request(mbe).post(path).set('x-recovery-token', 'wrong').send({})
        ).status.should.equal(401);
        (
          await request(mbe).post(path).set('x-recovery-token', token).send({})
        ).status.should.not.equal(401);
      });
    }
  });

  describe('Health Check Routes', () => {
    it('should return 200 and status message for /ping', async () => {
      const response = await request(app).post('/ping');
      response.status.should.equal(200);
      response.body.should.have.property('status', 'advanced wallet manager server is ok!');
      response.body.should.have.property('timestamp');
    });

    it('should return version info for /version', async () => {
      const response = await request(app).get('/version');
      response.status.should.equal(200);
      response.body.should.have.property('version');
      response.body.should.have.property('name', '@bitgo/advanced-wallets');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await request(app).get('/non-existent-route');
      response.status.should.equal(404);
      response.body.should.have.property(
        'error',
        'Route not found or not supported in advanced wallet manager mode',
      );
    });
  });
});
