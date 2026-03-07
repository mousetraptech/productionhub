#!/usr/bin/env node

/**
 * NDI Record Agent
 *
 * Lightweight WebSocket server that spawns and controls NDI Record.exe
 * processes. Designed to run on the Windows recording PC.
 *
 * Protocol:
 *   Hub sends:  { type: "start" | "stop" | "status" }
 *   Agent sends: { type: "state", state: "recording" | "stopped" | "archiving" }
 *                { type: "source-update", id, frames, vuDb }
 *                { type: "archive-progress", progress: 0.0-1.0 }
 *                { type: "archive-done", path }
 *                { type: "sources", sources: [...] }
 *                { type: "error", message }
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

// Load config
const configPath = process.argv[2] || path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const PORT = config.port || 7200;
const NDI_RECORD_PATH = config.ndiRecordPath;
const RECORDING_PATH = config.recordingPath;
const SOURCES = config.sources || [];

// State
let state = 'stopped'; // 'stopped' | 'recording' | 'archiving'
let recorders = new Map(); // id -> { process, frames, vuDb }
let sessionDir = '';
let hubSocket = null;

// --- WebSocket Server ---

const wss = new WebSocket.Server({ port: PORT });
console.log(`[Agent] Listening on ws://0.0.0.0:${PORT}`);
console.log(`[Agent] NDI Record: ${NDI_RECORD_PATH}`);
console.log(`[Agent] Sources: ${SOURCES.map(s => s.name).join(', ')}`);

wss.on('connection', (ws) => {
  console.log('[Agent] Hub connected');
  hubSocket = ws;

  // Send current sources and state
  send(ws, { type: 'sources', sources: SOURCES });
  send(ws, { type: 'state', state });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleCommand(msg, ws);
    } catch (err) {
      console.error(`[Agent] Parse error: ${err.message}`);
    }
  });

  ws.on('close', () => {
    console.log('[Agent] Hub disconnected');
    if (hubSocket === ws) hubSocket = null;
  });
});

function send(ws, msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(msg));
    }
  });
}

// --- Command Handler ---

function handleCommand(msg, ws) {
  switch (msg.type) {
    case 'start':
      startRecording(ws, msg.sessionName);
      break;
    case 'stop':
      stopRecording(ws);
      break;
    case 'status':
      send(ws, { type: 'state', state });
      send(ws, { type: 'sources', sources: SOURCES });
      break;
    default:
      console.warn(`[Agent] Unknown command: ${msg.type}`);
  }
}

// --- Recording ---

function startRecording(ws, sessionName) {
  if (state !== 'stopped') {
    send(ws, { type: 'error', message: `Cannot start: currently ${state}` });
    return;
  }

  // Use provided session name or fall back to auto-generated timestamp
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[T:]/g, '_').replace(/-/g, '-');
  const dirName = sessionName || stamp;
  sessionDir = path.join(RECORDING_PATH, dirName);

  try {
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch (err) {
    send(ws, { type: 'error', message: `Cannot create dir: ${err.message}` });
    return;
  }

  console.log(`[Agent] Starting recording in ${sessionDir}`);

  // Spawn one NDI Record.exe per source
  for (const source of SOURCES) {
    const outFile = path.join(sessionDir, `${source.id}.mov`);
    const args = ['-i', source.name, '-o', outFile, '-noautostart'];

    console.log(`[Agent] Spawning: "${NDI_RECORD_PATH}" ${args.join(' ')}`);

    const proc = spawn(NDI_RECORD_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const recorder = { process: proc, frames: 0, vuDb: -60 };
    recorders.set(source.id, recorder);

    // Parse XML stdout for stats
    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      // Process complete XML tags
      let match;
      while ((match = buffer.match(/<(\w+)\s+([^>]*)\/>/)) !== null) {
        parseRecorderXml(source.id, match[1], match[2], recorder);
        buffer = buffer.slice(match.index + match[0].length);
      }
    });

    proc.stderr.on('data', (chunk) => {
      console.error(`[${source.id}] ${chunk.toString().trim()}`);
    });

    proc.on('exit', (code) => {
      console.log(`[Agent] ${source.id} exited with code ${code}`);
      recorders.delete(source.id);
      checkAllStopped();
    });
  }

  // Send <start/> to all recorders for frame-accurate sync
  setTimeout(() => {
    for (const [id, rec] of recorders) {
      try {
        rec.process.stdin.write('<start/>\n');
        console.log(`[Agent] Sent <start/> to ${id}`);
      } catch (err) {
        console.error(`[Agent] Failed to start ${id}: ${err.message}`);
      }
    }
    state = 'recording';
    broadcast({ type: 'state', state: 'recording' });
  }, 500); // Brief delay to let processes initialize
}

function stopRecording(ws) {
  if (state !== 'recording') {
    send(ws, { type: 'error', message: `Cannot stop: currently ${state}` });
    return;
  }

  console.log('[Agent] Stopping recording');

  for (const [id, rec] of recorders) {
    try {
      rec.process.stdin.write('<exit/>\n');
      console.log(`[Agent] Sent <exit/> to ${id}`);
    } catch (err) {
      console.error(`[Agent] Failed to stop ${id}: ${err.message}`);
    }
  }

  // Processes will exit, triggering checkAllStopped()
}

function checkAllStopped() {
  if (recorders.size === 0 && state === 'recording') {
    console.log('[Agent] All recorders stopped');
    state = 'stopped';
    broadcast({ type: 'state', state: 'stopped' });
  }
}

function parseRecorderXml(sourceId, tag, attrs, recorder) {
  const attrMap = {};
  attrs.replace(/(\w+)="([^"]*)"/g, (_, key, val) => {
    attrMap[key] = val;
  });

  if (tag === 'recording') {
    const frames = parseInt(attrMap.no_frames, 10) || 0;
    const vuDbRaw = parseFloat(attrMap.vu_dB);
    const vuDb = isNaN(vuDbRaw) ? -60 : vuDbRaw;
    recorder.frames = frames;
    recorder.vuDb = vuDb;

    broadcast({
      type: 'source-update',
      id: sourceId,
      frames,
      vuDb,
    });
  } else if (tag === 'record_stopped') {
    const frames = parseInt(attrMap.no_frames, 10) || 0;
    console.log(`[Agent] ${sourceId} stopped after ${frames} frames`);
  }
}

// --- Graceful shutdown ---

process.on('SIGINT', () => {
  console.log('\n[Agent] Shutting down...');
  for (const [id, rec] of recorders) {
    try {
      rec.process.stdin.write('<exit/>\n');
    } catch {}
  }
  wss.close();
  process.exit(0);
});
