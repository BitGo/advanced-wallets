import 'should';

import request from 'supertest';
import express from 'express';
import { AppMode, TlsMode } from '../shared/types';
import { setupRoutes } from '../routes/secured';

describe('Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    setupRoutes(app, {
      appMode: AppMode.SECURED,
      tlsMode: TlsMode.DISABLED,
      mtlsRequestCert: false,
      kmsUrl: 'http://localhost:3000/kms',
      timeout: 5000,
      port: 3000,
      bind: 'localhost',
    });
  });

  describe('Health Check Routes', () => {
    it('should return 200 and status message for /ping', async () => {
      const response = await request(app).post('/ping');
      response.status.should.equal(200);
      response.body.should.have.property('status', 'secured express server is ok!');
      response.body.should.have.property('timestamp');
    });

    it('should return version info for /version', async () => {
      const response = await request(app).get('/version');
      response.status.should.equal(200);
      response.body.should.have.property('version');
      response.body.should.have.property('name', '@bitgo/secured-bitgo-express');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await request(app).get('/non-existent-route');
      response.status.should.equal(404);
      response.body.should.have.property(
        'error',
        'Route not found or not supported in secured mode',
      );
    });
  });
});
