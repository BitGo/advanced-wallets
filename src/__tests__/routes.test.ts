import express from 'express';
import request from 'supertest';
import { setupRoutes } from '../routes/enclaved';

describe('Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    setupRoutes(app);
  });

  describe('Health Check Routes', () => {
    it('should return 200 and status message for /ping', async () => {
      const response = await request(app).post('/ping');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'enclaved express server is ok!');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return version info for /version', async () => {
      const response = await request(app).get('/version');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('name', '@bitgo/enclaved-bitgo-express');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await request(app).get('/non-existent-route');
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty(
        'error',
        'Route not found or not supported in enclaved mode',
      );
    });
  });
});
