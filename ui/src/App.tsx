import { useState, useEffect } from 'react';
import { useProductionHub } from './hooks/useProductionHub';
import { useDeviceStates } from './hooks/useDeviceStates';
import { useChat } from './hooks/useChat';
import TemplatePicker from './components/TemplatePicker';
import ActionPalette from './components/ActionPalette';
import CueStack from './components/CueStack';
import GoBar from './components/GoBar';
import CollapsiblePanel from './components/CollapsiblePanel';
import ChatDrawer from './components/ChatDrawer';
import CommandModal, { type CommandModalTarget } from './components/CommandModal';
import type { InlineOSC } from './types';
import {
  AvantisPanel,
  OBSPanel,
  ChamSysPanel,
  PTZPanel,
  TouchDesignerPanel,
  RecorderPanel,
} from './components/devices';

export default function App() {
  const { show, categories, templates, connected, send, setChatHandler } = useProductionHub();
  const { deviceStates, connected: devicesConnected } = useDeviceStates();
  const [showPicker, setShowPicker] = useState(true);
  const chat = useChat(send);
  const [modalTarget, setModalTarget] = useState<CommandModalTarget | null>(null);

  // Wire chat message handler
  useEffect(() => {
    setChatHandler(chat.handleServerMessage);
  }, [setChatHandler, chat.handleServerMessage]);

  // Hide picker once a template is loaded (cues appear)
  const pickerVisible = showPicker && show.cues.length === 0;

  const selectTemplate = (templateId: string) => {
    send({ type: 'load-template', templateId });
    setShowPicker(false);
  };

  const handleCommandDrop = (commandType: string, cueId: string | null) => {
    setModalTarget({ commandType, cueId });
  };

  const handleModalSubmit = (target: CommandModalTarget, osc: InlineOSC, delay?: number) => {
    const actionId = `inline:${target.commandType}:${Date.now()}`;
    if (target.cueId) {
      send({ type: 'add-action-to-cue', cueId: target.cueId, actionId, osc, ...(delay ? { delay } : {}) });
    } else {
      send({ type: 'add-cue', cue: { name: osc.label, actions: [{ actionId, osc, ...(delay ? { delay } : {}) }] } });
    }
    setModalTarget(null);
  };

  return (
    <div style={{
      display: 'flex', height: '100vh', width: '100vw',
      background: '#020617',
      fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
      color: '#E2E8F0', overflow: 'hidden',
    }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.6); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1E293B; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>

      {pickerVisible && templates.length > 0 && (
        <TemplatePicker
          templates={templates}
          onSelect={selectTemplate}
          onDismiss={() => setShowPicker(false)}
        />
      )}

      {/* Reconnection indicator */}
      {!connected && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          background: '#EF4444', color: '#fff',
          padding: '6px 0', textAlign: 'center',
          fontSize: 12, fontWeight: 700, zIndex: 200,
          letterSpacing: '0.05em',
        }}>
          DISCONNECTED — Reconnecting...
        </div>
      )}

      {/* Left: Action Palette */}
      <ActionPalette
        categories={categories}
        onNewShow={() => {
          send({ type: 'reset' });
          setShowPicker(true);
        }}
      />

      {/* Center: Cue Stack + GO Bar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <CueStack show={show} categories={categories} send={send} onCommandDrop={handleCommandDrop} />
        <GoBar show={show} send={send} />
      </div>

      {/* Right: Device Panels */}
      <div style={{
        width: 320,
        background: '#0F172A',
        borderLeft: '1px solid #1E293B',
        overflowY: 'auto',
        padding: 12,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: '1px solid #1E293B',
        }}>
          <span style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#94A3B8',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Device States
          </span>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: devicesConnected ? '#10B981' : '#EF4444',
            boxShadow: devicesConnected ? '0 0 6px #10B981' : '0 0 6px #EF4444',
          }} />
        </div>

        <CollapsiblePanel title="Avantis" icon="faders">
          <AvantisPanel state={deviceStates.avantis} />
        </CollapsiblePanel>

        <CollapsiblePanel title="OBS Studio" icon="video">
          <OBSPanel state={deviceStates.obs} />
        </CollapsiblePanel>

        <CollapsiblePanel title="ChamSys" icon="lights">
          <ChamSysPanel state={deviceStates.chamsys} />
        </CollapsiblePanel>

        <CollapsiblePanel title="PTZ Camera" icon="camera">
          <PTZPanel state={deviceStates.visca} />
        </CollapsiblePanel>

        <CollapsiblePanel title="TouchDesigner" icon="td">
          <TouchDesignerPanel state={deviceStates.touchdesigner} />
        </CollapsiblePanel>

        <CollapsiblePanel title="NDI Recorder" icon="record">
          <RecorderPanel state={deviceStates['ndi-recorder']} />
        </CollapsiblePanel>
      </div>
      <ChatDrawer
        messages={chat.messages}
        mode={chat.mode}
        thinking={chat.thinking}
        onSend={chat.sendMessage}
        onConfirm={chat.confirm}
        onReject={chat.reject}
        onToggleMode={chat.toggleMode}
      />
      {modalTarget && (
        <CommandModal
          target={modalTarget}
          obsScenes={deviceStates.obs?.scenes}
          onSubmit={handleModalSubmit}
          onCancel={() => setModalTarget(null)}
        />
      )}
    </div>
  );
}
