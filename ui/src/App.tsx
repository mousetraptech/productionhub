import { useState } from 'react';
import { useProductionHub } from './hooks/useProductionHub';
import TemplatePicker from './components/TemplatePicker';
import ActionPalette from './components/ActionPalette';
import CueStack from './components/CueStack';
import GoBar from './components/GoBar';

export default function App() {
  const { show, categories, templates, connected, send } = useProductionHub();
  const [showPicker, setShowPicker] = useState(true);

  // Hide picker once a template is loaded (cues appear)
  const pickerVisible = showPicker && show.cues.length === 0;

  const selectTemplate = (templateId: string) => {
    send({ type: 'load-template', templateId });
    setShowPicker(false);
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
        <TemplatePicker templates={templates} onSelect={selectTemplate} />
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <CueStack show={show} categories={categories} send={send} />
        <GoBar show={show} send={send} />
      </div>
    </div>
  );
}
