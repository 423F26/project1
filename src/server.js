'use strict';

const { readFileSync } = require('node:fs');
const https = require('node:https');

const headers = {
  'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer'
};

function hosts(value) {
  const result = new Set((value ?? '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (!result.size || [...result].some((host) => !/^[a-z0-9.-]+$/.test(host))) throw new Error('ALLOWED_HOSTS must be DNS hostnames');
  return result;
}

function reply(response, status, body = '', extraHeaders = {}) {
  response.writeHead(status, { ...headers, ...extraHeaders, 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function createServer(options) {
  const attempts = new Map();
  const server = https.createServer({ ...options.tls, maxHeaderSize: 8 * 1024, insecureHTTPParser: false }, (request, response) => {
    const now = Date.now();
    const client = request.socket.remoteAddress ?? 'unknown';
    const state = attempts.get(client);
    const recent = !state || now - state.startedAt >= 60_000
      ? { startedAt: now, count: 1 }
      : { startedAt: state.startedAt, count: state.count + 1 };
    attempts.set(client, recent);
    if (attempts.size > 1_000) {
      for (const [ip, item] of attempts) if (now - item.startedAt > 60_000) attempts.delete(ip);
      if (attempts.size > 1_000) attempts.delete(attempts.keys().next().value);
    }

    const host = request.headers.host?.toLowerCase().replace(/:\d+$/, '');
    if (recent.count > options.rateLimit) return reply(response, 429, 'Too many requests.\n');
    if (!options.allowedHosts.has(host)) return reply(response, 421, 'Misdirected request.\n');
    if (request.method !== 'GET') return reply(response, 405, 'Method not allowed.\n');
    if (request.url !== '/') return reply(response, 404, 'Not found.\n');
    if (request.headers['transfer-encoding'] || (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
      return reply(response, 413, 'Request body not accepted.\n');
    }
    request.on('data', () => request.destroy());
    reply(response, 200, options.html, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
  });

  Object.assign(server, { headersTimeout: 5_000, requestTimeout: 5_000, keepAliveTimeout: 2_000, maxRequestsPerSocket: 50, maxHeadersCount: 32 });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8443);
  const allowedHosts = hosts(process.env.ALLOWED_HOSTS);
  const rateLimit = Number(process.env.RATE_LIMIT ?? 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(rateLimit) || rateLimit < 1) throw new Error('PORT and RATE_LIMIT must be positive integers');
  const key = process.env.TLS_KEY_PATH, cert = process.env.TLS_CERT_PATH;
  if (!key || !cert) throw new Error('TLS_KEY_PATH and TLS_CERT_PATH are required');
  const server = createServer({ tls: { key: readFileSync(key), cert: readFileSync(cert), minVersion: 'TLSv1.2' }, allowedHosts, rateLimit, html: readFileSync(`${__dirname}/../public/index.html`, 'utf8') });
  server.listen(port, '0.0.0.0', () => console.log(`Listening on https://0.0.0.0:${port}`));
}

module.exports = { createServer, hosts };
