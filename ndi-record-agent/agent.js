#!/usr/bin/env node

/**
 * NDI Record Agent (ffmpeg backend)
 *
 * Lightweight WebSocket server that spawns ffmpeg processes to capture
 * NDI streams, transcoding to H.264 for manageable file sizes.
 *
 * Replaces NDI Record.exe (which writes SpeedHQ at ~170 Mbps per 4K stream)
 * with configurable codec/resolution/quality. At 1080p H.264 crf=18,
 * expect ~20 Mbps per stream — 8x smaller than SpeedHQ 4K.
 *
 * Requirements:
 *   - ffmpeg built with NDI support (libndi_newtek input format)
 *   - NDI Runtime installed on the recording PC
 *   - NDI sources visible on the network
 *
 * Discover NDI source names:
 *   ffmpeg -f libndi_newtek -find_sources 1 -i dummy
 *
 * Protocol (unchanged from NDI Record.exe version):
 *   Hub sends:  { type: "start" | "stop" | "status" }
 *   Agent sends: { type: "state", state: "recording" | "stopped" }
 *                { type: "source-update", id, frames, vuDb }
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
const FFMPEG_PATH = config.ffmpegPath || 'ffmpeg';
const RECORDING_PATH = config.recordingPath;
const SOURCES = config.sources || [];
const VIDEO = config.video || {};
const AUDIO = config.audio || {};

// State
let state = 'stopped'; // 'stopped' | 'recording'
let recorders = new Map(); // id -> { process, frames, vuDb, buffer }
let sessionDir = '';
let hubSocket = null;

// --- WebSocket Server ---

const wss = new WebSocket.Server({ port: PORT });
console.log(`[Agent] Listening on ws://0.0.0.0:${PORT}`);
console.log(`[Agent] ffmpeg: ${FFMPEG_PATH}`);
console.log(`[Agent] Sources: ${SOURCES.map(s => s.name).join(', ')}`);
console.log(`[Agent] Video: ${VIDEO.codec || 'libx264'} preset=${VIDEO.preset || 'fast'} crf=${VIDEO.crf ?? 18} scale=${VIDEO.scale || 'native'}`);
console.log(`[Agent] Audio: ${AUDIO.codec || 'pcm_s24le'}`);

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

function buildFfmpegArgs(sourceName, outFile) {
  const args = [
    // NDI input
    '-f', 'libndi_newtek',
    '-i', sourceName,

    // Video
    '-c:v', VIDEO.codec || 'libx264',
  ];

  if (VIDEO.preset) args.push('-preset', VIDEO.preset);
  if (VIDEO.crf !== undefined) args.push('-crf', String(VIDEO.crf));
  if (VIDEO.scale) args.push('-vf', `scale=${VIDEO.scale}`);

  // Audio
  args.push('-c:a', AUDIO.codec || 'pcm_s24le');

  // Progress on stdout (key=value format, easy to parse)
  args.push('-progress', 'pipe:1');

  // Overwrite, output file
  args.push('-y', outFile);

  return args;
}

function startRecording(ws, sessionName) {
  if (state !== 'stopped') {
    send(ws, { type: 'error', message: `Cannot start: currently ${state}` });
    return;
  }

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

  // Spawn all ffmpeg processes — they start capturing immediately
  for (const source of SOURCES) {
    const outFile = path.join(sessionDir, `${source.id}.mov`);
    const args = buildFfmpegArgs(source.name, outFile);

    console.log(`[Agent] Spawning: ${FFMPEG_PATH} ${args.join(' ')}`);

    const proc = spawn(FFMPEG_PATH, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const recorder = { process: proc, frames: 0, vuDb: -60, buffer: '' };
    recorders.set(source.id, recorder);

    // Parse ffmpeg progress output from stdout
    // Format: key=value lines, blocks end with progress=continue|end
    proc.stdout.on('data', (chunk) => {
      recorder.buffer += chunk.toString();
      const lines = recorder.buffer.split('\n');
      recorder.buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();

        if (key === 'frame') {
          recorder.frames = parseInt(val, 10) || 0;
        } else if (key === 'progress') {
          // End of progress block — broadcast accumulated stats
          broadcast({
            type: 'source-update',
            id: source.id,
            frames: recorder.frames,
            vuDb: recorder.vuDb, // -60 placeholder — ffmpeg doesn't provide VU
          });
        }
      }
    });

    // ffmpeg writes diagnostics to stderr — log errors only
    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/error|could not|failed|invalid/i.test(trimmed)) {
          console.error(`[${source.id}] ${trimmed}`);
          broadcast({ type: 'error', message: `${source.id}: ${trimmed}` });
        }
      }
    });

    proc.on('exit', (code) => {
      console.log(`[Agent] ${source.id} exited (code ${code})`);
      // Broadcast final frame count
      broadcast({
        type: 'source-update',
        id: source.id,
        frames: recorder.frames,
        vuDb: -60,
      });
      recorders.delete(source.id);
      checkAllStopped();
    });
  }

  state = 'recording';
  broadcast({ type: 'state', state: 'recording' });
  console.log(`[Agent] Recording started — ${SOURCES.length} sources`);
}

function stopRecording(ws) {
  if (state !== 'recording') {
    send(ws, { type: 'error', message: `Cannot stop: currently ${state}` });
    return;
  }

  console.log('[Agent] Stopping recording');

  for (const [id, rec] of recorders) {
    try {
      // ffmpeg graceful stop: write 'q' to stdin
      rec.process.stdin.write('q');
      console.log(`[Agent] Sent quit to ${id}`);
    } catch (err) {
      console.error(`[Agent] Failed to stop ${id}: ${err.message}`);
      // Force kill if stdin write fails
      try { rec.process.kill('SIGTERM'); } catch {}
    }
  }

  // Processes will exit naturally, triggering checkAllStopped()
  // Safety: force kill after 10s if ffmpeg hangs on finalization
  setTimeout(() => {
    if (recorders.size > 0) {
      console.warn(`[Agent] ${recorders.size} recorders still running after 10s — force killing`);
      for (const [id, rec] of recorders) {
        try { rec.process.kill('SIGKILL'); } catch {}
      }
    }
  }, 10000);
}

function checkAllStopped() {
  if (recorders.size === 0 && state === 'recording') {
    console.log('[Agent] All recorders stopped');
    state = 'stopped';
    broadcast({ type: 'state', state: 'stopped' });
  }
}

// --- Graceful shutdown ---

process.on('SIGINT', () => {
  console.log('\n[Agent] Shutting down...');
  for (const [id, rec] of recorders) {
    try {
      rec.process.stdin.write('q');
    } catch {
      try { rec.process.kill('SIGTERM'); } catch {}
    }
  }
  // Give ffmpeg a moment to finalize files
  setTimeout(() => {
    wss.close();
    process.exit(0);
  }, 3000);
});
