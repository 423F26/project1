'use strict';

const { existsSync, mkdirSync, readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { createServer } = require('./server');
const { openStore, startCollector } = require('./rss');

const directory = join(__dirname, '..', 'certs', 'dev');
const key = join(directory, 'tls.key');
const cert = join(directory, 'tls.crt');
if (!existsSync(key) || !existsSync(cert)) {
  mkdirSync(directory, { recursive: true });
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '365', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'inherit' });
  } catch {
    console.error('Could not create the development certificate. Install OpenSSL and retry npm run dev.');
    process.exit(1);
  }
}

const dataDirectory = join(__dirname, '..', 'data');
mkdirSync(dataDirectory, { recursive: true });
const store = openStore(join(dataDirectory, 'rss.sqlite'));
const port = Number(process.env.PORT ?? 8443);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
createServer({
  tls: { key: readFileSync(key), cert: readFileSync(cert), minVersion: 'TLSv1.2' },
  allowedHosts: new Set(['localhost', '127.0.0.1']),
  rateLimit: 10,
  html: readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf8'),
  store
}).listen(port, '127.0.0.1', () => console.log(`Development server: https://localhost:${port} (self-signed certificate)`));
startCollector(store);
