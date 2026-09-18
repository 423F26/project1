'use strict';

const { existsSync, mkdirSync, readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { createServer } = require('./server');

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

createServer({
  tls: { key: readFileSync(key), cert: readFileSync(cert), minVersion: 'TLSv1.2' },
  allowedHosts: new Set(['localhost', '127.0.0.1']),
  rateLimit: 10,
  html: readFileSync(join(__dirname, '..', 'public', 'index.html'), 'utf8')
}).listen(8443, '127.0.0.1', () => console.log('Development server: https://localhost:8443 (self-signed certificate)'));
