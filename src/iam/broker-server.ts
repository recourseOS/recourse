/**
 * Session Broker HTTP Server
 *
 * Exposes the IAM Session Broker as an HTTP API.
 * Agents call this endpoint to request scoped credentials.
 *
 * Endpoints:
 * - POST /session - Request a new session with credentials
 * - GET /health - Health check
 */

import http from 'http';
import { SessionBroker, SessionRequest, createBrokerFromEnv } from './session-broker.js';

export interface BrokerServerConfig {
  port: number;
  host?: string;
}

/**
 * Start the session broker HTTP server
 */
export async function startBrokerServer(
  broker: SessionBroker,
  config: BrokerServerConfig
): Promise<http.Server> {
  await broker.initialize();

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', service: 'recourse-session-broker' }));
      return;
    }

    // Session request
    if (url.pathname === '/session' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const request: SessionRequest = JSON.parse(body);

        console.log(`[broker-server] Session request from ${request.actor ?? 'unknown'}`);

        const response = await broker.requestSession(request);

        const statusCode = response.granted ? 200 : response.riskAssessment === 'block' ? 403 : 200;

        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response, null, 2));

        console.log(
          `[broker-server] Session ${response.granted ? 'GRANTED' : 'DENIED'}: ${response.riskAssessment}`
        );
      } catch (error: any) {
        console.error(`[broker-server] Error: ${error.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return new Promise((resolve) => {
    server.listen(config.port, config.host ?? '0.0.0.0', () => {
      console.log(`[broker-server] Session broker listening on ${config.host ?? '0.0.0.0'}:${config.port}`);
      console.log(`[broker-server] POST /session - Request scoped credentials`);
      console.log(`[broker-server] GET /health - Health check`);
      resolve(server);
    });
  });
}

/**
 * Read request body
 */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * CLI entry point
 */
export async function runBrokerServer(): Promise<void> {
  const broker = createBrokerFromEnv();
  const port = parseInt(process.env.PORT ?? '3002');

  await startBrokerServer(broker, { port });

  // Keep running
  process.on('SIGINT', () => {
    console.log('[broker-server] Shutting down');
    process.exit(0);
  });
}
