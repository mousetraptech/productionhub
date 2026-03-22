import { useState, useCallback } from 'react';
import { useWebhooks, Webhook } from '../hooks/useWebhooks';
import ActionPalette from '../components/ActionPalette';
import CommandModal, { type CommandModalTarget } from '../components/CommandModal';
import ContextMenu, { MenuItem } from '../components/ContextMenu';
import type { InlineOSC, DeckAction } from '../types';

const FONT_MONO = "'IBM Plex Mono', monospace";
const FONT_SANS = "'IBM Plex Sans', sans-serif";
const API_HOST = `${window.location.hostname}:8081`;

export function WebhooksPage() {
  const { webhooks, setWebhooks, categories, loading, save, remove, fire } = useWebhooks();
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [firing, setFiring] = useState<string | null>(null);
  const [modalTarget, setModalTarget] = useState<CommandModalTarget | null>(null);
  const [dropWebhook, setDropWebhook] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; webhook: string; actionIdx?: number } | null>(null);

  const updateWebhook = useCallback((name: string, updates: Partial<Webhook>) => {
    setWebhooks(prev => prev.map(w => w.name === name ? { ...w, ...updates } : w));
    setDirty(true);
  }, [setWebhooks]);

  const addAction = useCallback((webhookName: string, action: DeckAction) => {
    setWebhooks(prev => prev.map(w =>
      w.name === webhookName ? { ...w, actions: [...w.actions, action] } : w
    ));
    setDirty(true);
  }, [setWebhooks]);

  const removeAction = useCallback((webhookName: string, idx: number) => {
    setWebhooks(prev => prev.map(w =>
      w.name === webhookName ? { ...w, actions: w.actions.filter((_, i) => i !== idx) } : w
    ));
    setDirty(true);
  }, [setWebhooks]);

  const moveAction = useCallback((webhookName: string, from: number, to: number) => {
    setWebhooks(prev => prev.map(w => {
      if (w.name !== webhookName) return w;
      const actions = [...w.actions];
      const [moved] = actions.splice(from, 1);
      actions.splice(to, 0, moved);
      return { ...w, actions };
    }));
    setDirty(true);
  }, [setWebhooks]);

  const createWebhook = useCallback(() => {
    const name = newName.trim().replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    if (!name || webhooks.some(w => w.name === name)) return;
    setWebhooks(prev => [...prev, { name, mode: 'series', seriesGap: 500, actions: [] }]);
    setNewName('');
    setEditing(name);
    setDirty(true);
  }, [newName, webhooks, setWebhooks]);

  const handleSave = useCallback(async () => {
    await save(webhooks);
    setDirty(false);
  }, [save, webhooks]);

  const handleDelete = useCallback(async (name: string) => {
    await remove(name);
    if (editing === name) setEditing(null);
    setDirty(false);
  }, [remove, editing]);

  const handleFire = useCallback(async (name: string) => {
    setFiring(name);
    await fire(name);
    setTimeout(() => setFiring(null), 500);
  }, [fire]);

  const handleCommandDrop = useCallback((webhookName: string, commandType: string) => {
    setDropWebhook(webhookName);
    setModalTarget({ commandType, cueId: null });
  }, []);

  const handleModalSubmit = useCallback((target: CommandModalTarget, osc: InlineOSC) => {
    if (dropWebhook) {
      if (osc.address === '__wait__') {
        addAction(dropWebhook, { actionId: 'wait', wait: osc.args[0] as number });
      } else {
        addAction(dropWebhook, { actionId: `inline:${target.commandType}:${Date.now()}`, osc });
      }
    }
    setModalTarget(null);
    setDropWebhook(null);
  }, [dropWebhook, addAction]);

  const handleActionDrop = useCallback((webhookName: string, e: React.DragEvent) => {
    e.preventDefault();

    // Command tile
    const cmdType = e.dataTransfer.getData('application/x-command-type');
    if (cmdType) {
      handleCommandDrop(webhookName, cmdType);
      return;
    }

    // Registry action
    const actionId = e.dataTransfer.getData('text/plain');
    if (actionId) {
      addAction(webhookName, { actionId });
      return;
    }
  }, [handleCommandDrop, addAction]);

  const copyCurl = useCallback((name: string) => {
    const cmd = `curl -X POST http://${API_HOST}/api/v1/webhooks/${name}`;
    navigator.clipboard.writeText(cmd);
    setCopied(name);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const actionLabel = useCallback((action: DeckAction) => {
    if (action.wait) return `Wait ${action.wait / 1000}s`;
    if (action.osc) return action.osc.label;
    // Look up in categories
    for (const cat of categories) {
      const item = cat.items.find(i => i.id === action.actionId);
      if (item) return item.label;
    }
    return action.actionId;
  }, [categories]);

  const handleWebhookContext = useCallback((e: React.MouseEvent, webhook: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, webhook });
  }, []);

  const handleActionContext = useCallback((e: React.MouseEvent, webhook: string, actionIdx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, webhook, actionIdx });
  }, []);

  const getCtxMenuItems = useCallback((): MenuItem[] => {
    if (!ctxMenu) return [];
    const { webhook, actionIdx } = ctxMenu;
    const wh = webhooks.find(w => w.name === webhook);
    if (!wh) return [];

    // Action-level context menu
    if (actionIdx !== undefined) {
      const action = wh.actions[actionIdx];
      if (!action) return [];
      return [
        {
          label: 'Duplicate Action',
          onClick: () => addAction(webhook, { ...action }),
        },
        {
          label: 'Move to Top',
          disabled: actionIdx === 0,
          onClick: () => moveAction(webhook, actionIdx, 0),
        },
        {
          label: 'Move to Bottom',
          disabled: actionIdx === wh.actions.length - 1,
          onClick: () => moveAction(webhook, actionIdx, wh.actions.length - 1),
        },
        { label: '', separator: true, onClick: () => {} },
        {
          label: 'Remove',
          danger: true,
          onClick: () => removeAction(webhook, actionIdx),
        },
      ];
    }

    // Webhook-level context menu
    return [
      {
        label: 'Copy curl',
        onClick: () => copyCurl(webhook),
      },
      {
        label: 'Fire',
        onClick: () => handleFire(webhook),
      },
      {
        label: 'Duplicate Webhook',
        onClick: () => {
          const copy: Webhook = { ...wh, name: `${wh.name}-copy`, actions: [...wh.actions] };
          setWebhooks(prev => [...prev, copy]);
          setDirty(true);
        },
      },
      { label: '', separator: true, onClick: () => {} },
      {
        label: 'Delete',
        danger: true,
        onClick: () => handleDelete(webhook),
      },
    ];
  }, [ctxMenu, webhooks, addAction, moveAction, removeAction, copyCurl, handleFire, handleDelete, setWebhooks]);

  if (loading) return <div style={{ padding: 40, color: '#888' }}>Loading...</div>;

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0a0a0a', color: '#e8e8e8',
      fontFamily: FONT_SANS,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '10px 20px',
        borderBottom: '1px solid #2a2a2a',
        background: '#111',
      }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: '#666', letterSpacing: '0.1em' }}>
          WEBHOOKS
        </span>
        <span style={{ fontFamily: FONT_SANS, fontSize: 13, color: '#888' }}>
          Production Hub
        </span>
        <div style={{ flex: 1 }} />
        {dirty && (
          <button
            onClick={handleSave}
            style={{
              background: '#2563EB', color: '#fff', border: 'none',
              borderRadius: 4, padding: '6px 16px', cursor: 'pointer',
              fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600,
            }}
          >SAVE</button>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar — action palette */}
        <div style={{
          width: 270, borderRight: '1px solid #2a2a2a',
          overflowY: 'auto', background: '#111',
        }}>
          <ActionPalette categories={categories} onNewShow={() => {}} />
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {/* Create new */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createWebhook()}
              placeholder="new-webhook-name"
              style={{
                background: '#1a1a1a', border: '1px solid #333', borderRadius: 4,
                padding: '6px 12px', color: '#e8e8e8', fontFamily: FONT_MONO,
                fontSize: 13, width: 250,
              }}
            />
            <button
              onClick={createWebhook}
              disabled={!newName.trim()}
              style={{
                background: '#1a1a1a', color: '#888', border: '1px solid #333',
                borderRadius: 4, padding: '6px 14px', cursor: 'pointer',
                fontFamily: FONT_MONO, fontSize: 12,
                opacity: newName.trim() ? 1 : 0.4,
              }}
            >+ CREATE</button>
          </div>

          {/* Webhook list */}
          {webhooks.length === 0 && (
            <div style={{ color: '#555', fontSize: 13, padding: 20 }}>
              No webhooks defined. Create one above and drag actions from the sidebar.
            </div>
          )}

          {webhooks.map(wh => {
            const isOpen = editing === wh.name;
            return (
              <div key={wh.name} style={{
                background: '#141414', border: '1px solid #2a2a2a',
                borderRadius: 6, marginBottom: 8,
              }}>
                {/* Header */}
                <div
                  onClick={() => setEditing(isOpen ? null : wh.name)}
                  onContextMenu={(e) => handleWebhookContext(e, wh.name)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', cursor: 'pointer',
                  }}
                >
                  <span style={{
                    fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600, color: '#e8e8e8',
                  }}>{wh.name}</span>
                  <span style={{
                    fontFamily: FONT_MONO, fontSize: 11, color: '#555',
                  }}>{wh.actions.length} action{wh.actions.length !== 1 ? 's' : ''}</span>
                  <span style={{
                    fontFamily: FONT_MONO, fontSize: 10, color: '#444',
                    background: '#1a1a1a', padding: '2px 6px', borderRadius: 3,
                  }}>{wh.mode}</span>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleFire(wh.name); }}
                    style={{
                      background: firing === wh.name ? '#16a34a' : '#1a1a1a',
                      color: firing === wh.name ? '#fff' : '#888',
                      border: '1px solid #333', borderRadius: 4,
                      padding: '4px 12px', cursor: 'pointer',
                      fontFamily: FONT_MONO, fontSize: 11,
                      transition: 'all 0.15s',
                    }}
                  >{firing === wh.name ? 'FIRED' : 'FIRE'}</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); copyCurl(wh.name); }}
                    style={{
                      background: '#1a1a1a', color: copied === wh.name ? '#16a34a' : '#666',
                      border: '1px solid #333', borderRadius: 4,
                      padding: '4px 10px', cursor: 'pointer',
                      fontFamily: FONT_MONO, fontSize: 11,
                    }}
                  >{copied === wh.name ? 'COPIED' : 'CURL'}</button>
                  <span style={{ color: '#555', fontSize: 12 }}>{isOpen ? '\u25B2' : '\u25BC'}</span>
                </div>

                {/* Expanded editor */}
                {isOpen && (
                  <div style={{ padding: '0 14px 14px', borderTop: '1px solid #222' }}>
                    {/* Mode & gap */}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0' }}>
                      <label style={{ fontSize: 11, color: '#666', fontFamily: FONT_MONO }}>MODE</label>
                      <select
                        value={wh.mode}
                        onChange={e => updateWebhook(wh.name, { mode: e.target.value as 'parallel' | 'series' })}
                        style={{
                          background: '#1a1a1a', border: '1px solid #333', borderRadius: 3,
                          color: '#ccc', padding: '3px 8px', fontFamily: FONT_MONO, fontSize: 12,
                        }}
                      >
                        <option value="series">series</option>
                        <option value="parallel">parallel</option>
                      </select>
                      {wh.mode === 'series' && (
                        <>
                          <label style={{ fontSize: 11, color: '#666', fontFamily: FONT_MONO }}>GAP (ms)</label>
                          <input
                            type="number"
                            value={wh.seriesGap}
                            onChange={e => updateWebhook(wh.name, { seriesGap: parseInt(e.target.value) || 0 })}
                            style={{
                              background: '#1a1a1a', border: '1px solid #333', borderRadius: 3,
                              color: '#ccc', padding: '3px 8px', width: 70,
                              fontFamily: FONT_MONO, fontSize: 12,
                            }}
                          />
                        </>
                      )}
                    </div>

                    {/* Action list */}
                    <div
                      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                      onDrop={e => handleActionDrop(wh.name, e)}
                      style={{
                        minHeight: 50, background: '#0f0f0f', borderRadius: 4,
                        border: '1px dashed #333', padding: 6,
                      }}
                    >
                      {wh.actions.length === 0 && (
                        <div style={{ color: '#444', fontSize: 12, padding: 12, textAlign: 'center', fontFamily: FONT_MONO }}>
                          Drop actions here
                        </div>
                      )}
                      {wh.actions.map((action, i) => (
                        <div key={i} onContextMenu={(e) => handleActionContext(e, wh.name, i)} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 8px', background: '#1a1a1a',
                          borderRadius: 3, marginBottom: 3,
                          border: '1px solid #252525',
                        }}>
                          {/* Reorder buttons */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            <button
                              onClick={() => i > 0 && moveAction(wh.name, i, i - 1)}
                              disabled={i === 0}
                              style={{
                                background: 'none', border: 'none', color: i > 0 ? '#666' : '#333',
                                cursor: i > 0 ? 'pointer' : 'default', fontSize: 9, padding: 0, lineHeight: 1,
                              }}
                            >{'\u25B2'}</button>
                            <button
                              onClick={() => i < wh.actions.length - 1 && moveAction(wh.name, i, i + 1)}
                              disabled={i === wh.actions.length - 1}
                              style={{
                                background: 'none', border: 'none',
                                color: i < wh.actions.length - 1 ? '#666' : '#333',
                                cursor: i < wh.actions.length - 1 ? 'pointer' : 'default',
                                fontSize: 9, padding: 0, lineHeight: 1,
                              }}
                            >{'\u25BC'}</button>
                          </div>
                          <span style={{
                            fontFamily: FONT_MONO, fontSize: 11, color: '#999', flex: 1,
                          }}>
                            {action.wait
                              ? `\u23F3 ${action.wait / 1000}s`
                              : action.osc
                                ? `\u2192 ${action.osc.label}`
                                : `\u25B6 ${actionLabel(action)}`
                            }
                          </span>
                          <button
                            onClick={() => removeAction(wh.name, i)}
                            style={{
                              background: 'none', border: 'none', color: '#a02020',
                              cursor: 'pointer', fontSize: 13, padding: '0 4px',
                              fontFamily: FONT_MONO,
                            }}
                          >x</button>
                        </div>
                      ))}
                    </div>

                    {/* Curl preview */}
                    <div style={{
                      marginTop: 10, padding: '6px 10px',
                      background: '#0a0a0a', borderRadius: 3, border: '1px solid #222',
                      fontFamily: FONT_MONO, fontSize: 11, color: '#555',
                      wordBreak: 'break-all',
                    }}>
                      curl -X POST http://{API_HOST}/api/v1/webhooks/{wh.name}
                    </div>

                    {/* Delete */}
                    <div style={{ marginTop: 10, textAlign: 'right' }}>
                      <button
                        onClick={() => handleDelete(wh.name)}
                        style={{
                          background: '#1a1a1a', color: '#a02020', border: '1px solid #333',
                          borderRadius: 4, padding: '4px 12px', cursor: 'pointer',
                          fontFamily: FONT_MONO, fontSize: 11,
                        }}
                      >DELETE</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Command modal */}
      {modalTarget && (
        <CommandModal
          target={modalTarget}
          onSubmit={handleModalSubmit}
          onCancel={() => { setModalTarget(null); setDropWebhook(null); }}
        />
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={getCtxMenuItems()}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
