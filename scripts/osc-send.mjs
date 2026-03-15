#!/usr/bin/env node
// Usage: node scripts/osc-send.mjs /ir/learn/tv_power
//        node scripts/osc-send.mjs /ir/send/tv_power
//        node scripts/osc-send.mjs /ir/list
import { createRequire } from 'module';
import { createSocket } from 'dgram';
const require = createRequire(import.meta.url);
const osc = require('osc');

const address = process.argv[2];
if (!address) { console.error('Usage: node osc-send.mjs /address [args...]'); process.exit(1); }

const args = process.argv.slice(3).map(a => {
  const n = Number(a);
  return isNaN(n) ? { type: 's', value: a } : Number.isInteger(n) ? { type: 'i', value: n } : { type: 'f', value: n };
});

const sock = createSocket('udp4');
const msg = osc.writeMessage({ address, args });
sock.send(msg, 0, msg.length, 9000, '127.0.0.1', () => {
  console.log(`Sent ${address}`);
  sock.close();
});
