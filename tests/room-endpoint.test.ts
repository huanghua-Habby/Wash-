/** LAN clients select only the authority serving their current webpage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { roomEndpoint } from '../client/js/online/roomEndpoint.js';

test('published static page and LAN page share the explicitly selected PC authority',()=>{
  assert.equal(roomEndpoint(new URL('https://example.com/api/game-proxy/games/example/index.html'),'ws://192.168.1.10:8080/ws'),'ws://192.168.1.10:8080/ws');
  assert.throws(()=>roomEndpoint(new URL('https://example.com/'),'https://example/ws'));
  assert.throws(()=>roomEndpoint(new URL('https://example.com/'),'ws://user:password@example/ws'));
});

test('localhost and coworkers automatically share the hosting LAN authority',()=>{
  assert.equal(roomEndpoint(new URL('http://127.0.0.1:8080/')),'ws://127.0.0.1:8080/ws');
  assert.equal(roomEndpoint(new URL('http://192.168.1.10:8080/')),'ws://192.168.1.10:8080/ws');
  assert.equal(roomEndpoint(new URL('http://192.168.1.10:8090/')),'ws://192.168.1.10:8090/ws');
});
test('prefixed and HTTPS LAN hosting preserve their origin and gateway path',()=>{
  assert.equal(roomEndpoint(new URL('http://localhost:8080/mp/wash-cn/')),'ws://localhost:8080/mp/wash-cn/ws');
  assert.equal(roomEndpoint(new URL('https://lan.example/mp/wash-cn/')),'wss://lan.example/mp/wash-cn/ws');
  assert.equal(roomEndpoint(new URL('http://localhost:8080/mp/')),'ws://localhost:8080/ws');
});
