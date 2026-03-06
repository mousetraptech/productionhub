#!/usr/bin/env node

/**
 * Mock NDI Record Agent
 *
 * Simulates the real agent for UI development. Runs on port 7200 (same as real agent).
 * Sends fake source updates with oscillating VU meters and incrementing frame counts.
 *
 * Usage: node ndi-record-agent/mock-agent.js
 */

const WebSocket = require('ws');

const PORT = 7200;

const SOURCES = [
  { id: 'cam-wide', name: 'DMMS-CAM-WIDE (NDI HX)' },
  { id: 'cam-close', name: 'DMMS-CAM-CLOSE (NDI HX)' },
  { id: 'cam-ptz', name: 'DMMS-PTZ-1 (NDI HX)' },
];

let state = 'stopped';
let recording = false;
let frameCounters = {};
let vuPhase = {};
let tickInterval = null;
let archiveTimer = null;

const wss = new WebSocket.Server({ port: PORT });
console.log(`[Mock Agent] Listening on ws://0.0.0.0:${PORT}`);
console.log(`[Mock Agent] Sources: ${SOURCES.map(s => s.name).join(', ')}`);

wss.on('connection', (ws) => {
  console.log('[Mock Agent] Hub connected');

  send(ws, { type: 'sources', sources: SOURCES });
  send(ws, { type: 'state', state });

  // If already recording, send current frame counts
  if (state === 'recording') {
    for (const source of SOURCES) {
      send(ws, {
        type: 'source-update',
        id: source.id,
        name: source.name,
        frames: frameCounters[source.id] || 0,
        vuDb: -20,
      });
    }
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleCommand(msg);
    } catch (err) {
      console.error(`[Mock Agent] Parse error: ${err.message}`);
    }
  });

  ws.on('close', () => {
    console.log('[Mock Agent] Hub disconnected');
  });
});

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg) {
  for (const client of wss.clients) {
    send(client, msg);
  }
}

function handleCommand(msg) {
  switch (msg.type) {
    case 'start':
      if (state !== 'stopped') return;
      console.log(`[Mock Agent] Starting recording (session: ${msg.sessionName || 'unnamed'})`);
      state = 'recording';
      recording = true;

      // Reset counters
      for (const s of SOURCES) {
        frameCounters[s.id] = 0;
        vuPhase[s.id] = Math.random() * Math.PI * 2;
      }

      broadcast({ type: 'state', state: 'recording' });
      startTicking();
      break;

    case 'stop':
      if (state !== 'recording') return;
      console.log('[Mock Agent] Stopping recording');
      recording = false;
      stopTicking();
      startArchive();
      break;

    case 'status':
      broadcast({ type: 'state', state });
      broadcast({ type: 'sources', sources: SOURCES });
      break;
  }
}

function startTicking() {
  if (tickInterval) return;
  // Tick at ~15 Hz to simulate NDI Record.exe feedback
  tickInterval = setInterval(() => {
    for (const source of SOURCES) {
      frameCounters[source.id] += 4; // ~60fps, reporting every ~4 frames
      vuPhase[source.id] += 0.15 + Math.random() * 0.1;

      // Oscillate VU between -40 and -3 dB with some noise
      const base = Math.sin(vuPhase[source.id]) * 18 - 20;
      const vuDb = Math.max(-60, Math.min(0, base + (Math.random() - 0.5) * 6));

      broadcast({
        type: 'source-update',
        id: source.id,
        name: source.name,
        frames: frameCounters[source.id],
        vuDb: Math.round(vuDb * 10) / 10,
      });
    }
  }, 66);
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function startArchive() {
  state = 'archiving';
  broadcast({ type: 'state', state: 'archiving' });
  console.log('[Mock Agent] Archiving...');

  let progress = 0;
  archiveTimer = setInterval(() => {
    progress += 0.05 + Math.random() * 0.05;
    if (progress >= 1) {
      progress = 1;
      clearInterval(archiveTimer);
      archiveTimer = null;
      broadcast({ type: 'archive-progress', progress: 1 });
      broadcast({ type: 'archive-done', path: '/mock/archive/done' });
      state = 'stopped';
      broadcast({ type: 'state', state: 'stopped' });
      console.log('[Mock Agent] Archive complete');
      return;
    }
    broadcast({ type: 'archive-progress', progress });
  }, 300);
}

process.on('SIGINT', () => {
  console.log('\n[Mock Agent] Shutting down');
  stopTicking();
  if (archiveTimer) clearInterval(archiveTimer);
  wss.close();
  process.exit(0);
});
