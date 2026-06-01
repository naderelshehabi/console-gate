import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { startDiscovery } from './discovery';
import { DEFAULT_CONFIG } from '../config';

/**
 * Integration test for the UDP-broadcast discovery responder — the contract the
 * Android app (android/shared Endpoint.fromDiscoveryReply) and the console agents
 * rely on to find the Hub without a manual IP.
 */
test('discovery responder replies to CG_DISCOVER with hubId + port', async () => {
  const config = { ...DEFAULT_CONFIG, port: 8088, discoveryPort: 0 };
  const handle = startDiscovery(config, 'hub-abc');
  try {
    const boundPort = await handle.ready;
    assert.ok(boundPort > 0);

    const reply = await new Promise<string>((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        client.close();
        reject(new Error('no discovery reply'));
      }, 2000);
      client.on('message', (msg) => {
        clearTimeout(timer);
        client.close();
        resolve(msg.toString('utf8'));
      });
      client.on('error', reject);
      client.send(Buffer.from('CG_DISCOVER?v1'), boundPort, '127.0.0.1');
    });

    const json = JSON.parse(reply);
    assert.equal(json.hubId, 'hub-abc');
    assert.equal(json.port, 8088);
    assert.equal(json.api, '/api/v1');
  } finally {
    handle.stop();
  }
});

test('discovery responder ignores non-probe datagrams', async () => {
  const config = { ...DEFAULT_CONFIG, port: 8088, discoveryPort: 0 };
  const handle = startDiscovery(config, 'hub-abc');
  try {
    const boundPort = await handle.ready;
    const got = await new Promise<string | null>((resolve) => {
      const client = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        client.close();
        resolve(null); // expected: no reply
      }, 500);
      client.on('message', (msg) => {
        clearTimeout(timer);
        client.close();
        resolve(msg.toString('utf8'));
      });
      client.send(Buffer.from('hello?'), boundPort, '127.0.0.1');
    });
    assert.equal(got, null);
  } finally {
    handle.stop();
  }
});
