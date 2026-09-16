'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { createServer, hosts } = require('../src/server');

test('validates and normalizes allowed hosts', () => {
  assert.deepEqual(hosts('Plaintext.Example.com'), new Set(['plaintext.example.com']));
  assert.throws(() => hosts('https://bad.example.com'));
});

function request(server, { method = 'GET', url = '/', host = 'plaintext.example.com', headers = {} } = {}) {
  const input = new EventEmitter();
  input.method = method;
  input.url = url;
  input.headers = { host, ...headers };
  input.socket = { remoteAddress: '127.0.0.1' };
  const output = {
    writeHead(status, responseHeaders) { this.status = status; this.headers = responseHeaders; },
    end(body) { this.body = body; }
  };
  server.emit('request', input, output);
  return output;
}

test('only serves the configured HTML root endpoint', () => {
  const html = readFileSync(require.resolve('../public/index.html'), 'utf8');
  const server = createServer({ tls: {}, allowedHosts: new Set(['plaintext.example.com']), rateLimit: 10, html });
  const success = request(server);
  assert.equal(success.status, 200);
  assert.equal(success.body, html);
  assert.equal(success.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(success.headers['content-security-policy'], /script-src 'none'/);
  assert.equal(success.headers['referrer-policy'], 'no-referrer');
  for (const value of ['Untitled', 'Paste a statement link or search a company or article', 'RSS source manager', 'WirtschaftsWoche Finanzen', 'Add RSS feed URL', 'Coming soon']) assert.match(success.body, new RegExp(value));
  assert.equal((success.body.match(/type="checkbox"/g) ?? []).length, 3);
  assert.equal((success.body.match(/type="button"/g) ?? []).length, 2);
  assert.equal((success.body.match(/<input[^>]*type="url"/g) ?? []).length, 1);
  assert.equal((success.body.match(/<article/g) ?? []).length, 5);
  assert.equal((success.body.match(/class="meter"/g) ?? []).length, 5);
  assert.equal((success.body.match(/target="_blank"/g) ?? []).length, 5);
  assert.doesNotMatch(success.body, /<form|<script/i);
  const notFound = request(server, { url: '/anything' });
  const methodNotAllowed = request(server, { method: 'HEAD' });
  const post = request(server, { method: 'POST' });
  const wrongHost = request(server, { host: 'attacker.example' });
  const body = request(server, { headers: { 'content-length': '1' } });
  for (const response of [notFound, methodNotAllowed, post, wrongHost, body]) assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
  assert.equal(notFound.status, 404);
  assert.equal(methodNotAllowed.status, 405);
  assert.equal(post.status, 405);
  assert.equal(wrongHost.status, 421);
  assert.equal(body.status, 413);
});
