import { useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, Upload, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useKeyboard } from '@/contexts/KeyboardContext';
import { fileService } from '@/services/file.service';
import { useLayoutSettings } from '@/contexts/LayoutSettingsContext';
import type { KeyboardInfo } from '@/types/keyboard.types';
import example from '@/default-layouts/sval-default.svil?raw';
import { DEFAULTS, PRESETS, STORAGE_KEY, changedPreferences, preferences, type Appearance, type Preferences } from './core';
import { OverlaySurface, type SurfaceKey } from './OverlaySurface';
import './trainer.css';
import { useHost } from './host';
import { PARANOID } from '@/lib/paranoid';
import { HostInstall, HostVersion } from './HostInstall';
import { surfaceKeys } from './useSurfaceKeys';

function readPreferences() { try { return preferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); } catch { return preferences(null); } }
export default function TrainerPage({ active = true }: { active?: boolean }) {
    const host = useHost();
    const { internationalLayout } = useLayoutSettings();
    const [live, setLive] = useState(true);
    const [hostDirty, setHostDirty] = useState(false);
    const { keyboard, originalKeyboard, hasUnsavedChanges } = useKeyboard();
    const [sample] = useState(() => fileService.parseContent(example));
    const [imported, setImported] = useState<KeyboardInfo | null>(null);
    const [source, setSource] = useState('snapshot');
    const following = !!host.state && live;
    const board = following ? host.state!.board || sample : source === 'example' ? sample : source === 'import' ? imported || sample : source === 'draft' ? keyboard || sample : originalKeyboard || sample;
    const [prefs, setPrefs] = useState<Preferences>(readPreferences);
    const prefsRef = useRef(prefs); prefsRef.current = prefs;
    // The Host's settings as this page last saw them: a save sends only what changed since.
    const syncedPrefs = useRef(prefs);
    const [storageError, setStorageError] = useState(false);
    const [error, setError] = useState('');
    const [tab, setTab] = useState('Appearance');
    const [background, setBackground] = useState('Dark');
    const [layer, setLayer] = useState(0), [base, setBase] = useState(0);
    const [held, setHeld] = useState<Set<number>>(new Set());
    const [changed, setChanged] = useState<Set<number>>(new Set());
    const [recall, setRecall] = useState(false), [revealed, setRevealed] = useState(false);
    const [cue, setCue] = useState(0), [attempts, setAttempts] = useState(0), [correct, setCorrect] = useState(0);
    const [familiar, setFamiliar] = useState<Set<string>>(new Set()), [hideFamiliar, setHideFamiliar] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const input = useRef<HTMLInputElement>(null);
    const importGeneration = useRef(0);
    useEffect(() => () => { importGeneration.current++; }, []);
    useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); setStorageError(false); } catch { setStorageError(true); } }, [prefs]);
    useEffect(() => { setLayer(0); setBase(0); setCue(0); setRevealed(false); setFamiliar(new Set()); setSelected(null); setAttempts(0); setCorrect(0); }, [board]);
    useEffect(() => {
        if (host.state && !hostDirty && !host.busy) { const synced = preferences(host.state.config); syncedPrefs.current = synced; setPrefs(synced); }
    }, [host.state?.revision, hostDirty, host.busy]);
    useEffect(() => {
        if (!host.state || !hostDirty || host.busy) return;
        const timer = setTimeout(() => {
            const changed = changedPreferences(syncedPrefs.current, prefs);
            void host.configure(latest => ({ ...latest, ...changed })).then(ok => {
                if (ok) syncedPrefs.current = { ...syncedPrefs.current, ...changed } as Preferences;
                if (!ok || prefsRef.current === prefs) setHostDirty(false);
            });
        }, 160);
        return () => clearTimeout(timer);
    }, [prefs, hostDirty, host.busy, host.configure]);
    useEffect(() => {
        if (!host.state || host.state.config.layoutId === internationalLayout) return;
        setPrefs(p => ({ ...p, layoutId: internationalLayout }));
        setHostDirty(true);
    }, [internationalLayout, host.state?.session]);
    const keys = useMemo<SurfaceKey[]>(() => {
        if (following) {
            if (!host.state?.board || !host.state.valid) return [];
            try { return surfaceKeys(host.state.board, host.state.active, host.state.default ?? host.state.config.manualDefault, prefs.hands, internationalLayout); }
            catch { return []; }
        }
        return surfaceKeys(board, 1 << Math.min(layer, (board.keymap?.length || 1) - 1),
            1 << Math.min(base, (board.keymap?.length || 1) - 1), prefs.hands, internationalLayout);
    }, [board, layer, base, prefs.hands, internationalLayout, following, host.state?.valid, host.state?.active, host.state?.default, host.state?.config.manualDefault]);
    const previous = useRef<SurfaceKey[]>([]);
    useEffect(() => {
        const before = new Map(previous.current.map(k => [k.id, `${k.code}:${k.layer}`]));
        setChanged(new Set(keys.filter(k => before.has(k.id) && before.get(k.id) !== `${k.code}:${k.layer}`).map(k => k.id)));
        previous.current = keys;
        setRevealed(false); setHeld(new Set());
        const timer = window.setTimeout(() => setChanged(new Set()), prefs.duration);
        return () => clearTimeout(timer);
    }, [keys, prefs.duration]);
    useEffect(() => { if (!held.size) return; const timer = setTimeout(() => setHeld(new Set()), 800); return () => clearTimeout(timer); }, [held]);
    const learnable = keys.filter(k => k.code > 1);
    const target = learnable.length ? learnable[cue % learnable.length] : undefined;
    const hidden = new Set(keys.filter(k => (recall && !revealed) || (hideFamiliar && familiar.has(`${k.id}:${k.code}`) && !revealed)).map(k => k.id));
    const practiceHidden = following ? [...hidden].sort((a, b) => a - b).join(',') : '';
    const practiceTarget = following && recall && revealed ? target?.id ?? null : null;
    useEffect(() => {
        if (!host.state || !active) return;
        const publish = () => void host.command({ op: 'practice', hidden: practiceHidden ? practiceHidden.split(',').map(Number) : [], target: practiceTarget });
        publish(); const timer = setInterval(publish, 1000);
        return () => { clearInterval(timer); void host.command({ op: 'practice', hidden: [], target: null }); };
    }, [practiceHidden, practiceTarget, host.command, !!host.state, active]);
    const chosen = keys.find(k => k.id === selected);
    const appearance = prefs.appearance;
    const preset = Object.entries(PRESETS).find(([, a]) => JSON.stringify(a) === JSON.stringify(appearance))?.[0] || 'Custom';
    const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => { setHostDirty(true); setPrefs(p => ({ ...p, [key]: value })); };
    const color = <K extends keyof Appearance>(key: K, value: Appearance[K]) => update('appearance', { ...appearance, [key]: value });
    const grade = (remembered: boolean) => { if (!revealed || !target) return; setAttempts(n => n + 1); if (remembered) setCorrect(n => n + 1); setCue(n => n + 1); setRevealed(false); };
    async function importFile(file: File | undefined) {
        if (!file) return;
        const generation = ++importGeneration.current;
        try { const loaded = await fileService.loadFile(file); if (generation !== importGeneration.current) return;
            if (loaded.rows !== 10 || loaded.cols !== 6 || !loaded.keymap?.length) throw new Error('Choose a Svalboard layout with a 10 × 6 matrix.');
            setImported(loaded); setLive(false); setSource('import'); setError('');
        } catch (e) { if (generation === importGeneration.current) setError(e instanceof Error ? e.message : 'Could not read this layout.'); }
    }
    return <div className="trainer-page">
        <header className="trainer-header"><GraduationCap size={19} className="text-kb-green" /><h1>Overlay</h1></header>
        <main className="trainer-main">
            {!host.state && (PARANOID ? <p className="trainer-note">For the desktop overlay, start Keybard Host in paranoid mode (Start-Paranoid.cmd) and use the Keybard it opens. This file never contacts anything else.</p> : <HostInstall onConnect={host.local ? undefined : host.connect} />)}
            <div className="trainer-workspace"><section className="trainer-stage">
                {host.state && <div className="trainer-host-section"><div className="trainer-host-toolbar"><select aria-label="Host keyboard" value={host.state.selectedDevice || ''} onChange={e => { setLive(true); void host.command({ op: 'connect', id: e.target.value }); }}><option value="" disabled>Select a Svalboard…</option>{host.state.devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div><p className="trainer-error" role="status" hidden={host.state.valid}>{host.state.status}</p><HostVersion build={host.build} /></div>}
                {host.error && <p role="alert" className="trainer-error">{host.error}</p>}
                <div className="trainer-preview-card">
                    <div className={`trainer-canvas trainer-bg-${background.toLowerCase()}`}><div className="trainer-keyboard" style={{ width: `${prefs.scale}%` }}><OverlaySurface keys={keys} appearance={appearance} changed={changed} held={following ? new Set(host.state?.pressed || []) : held} effect={prefs.effect} duration={prefs.duration} hidden={hidden} capitals={host.state?.config.capitalAlphas === true} target={recall && revealed ? target?.id : undefined} onSelect={setSelected} /></div></div>
                    <div className="trainer-preview-footer"><span>Preview background</span><div className="trainer-segments">{['Light', 'Dark', 'Busy'].map(b => <button key={b} aria-pressed={background === b} onClick={() => setBackground(b)}>{b}</button>)}</div></div>
                </div>
                <div className="trainer-source-card"><div className="trainer-field"><label htmlFor="trainer-source">Layout source</label><select id="trainer-source" value={following ? "live" : source} onChange={e => { setLive(e.target.value === "live"); if (e.target.value !== "live") setSource(e.target.value); }}>{host.state && <option value="live">Live board · read-only</option>}<option value="snapshot">{originalKeyboard ? 'Loaded snapshot' : 'QWERTY example (no snapshot loaded)'}</option>{keyboard && <option value="draft">Editor draft{hasUnsavedChanges ? ' · unsaved changes' : ''}</option>}<option value="example">QWERTY example</option>{imported && <option value="import">Imported trainer layout</option>}</select></div><Button variant="outline" onClick={() => input.current?.click()}><Upload /> Import for trainer</Button><input ref={input} type="file" accept=".svil,.vil,.viable,.json,.kbi" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></div>
                <div className="trainer-layer-controls" style={{ display: following ? 'none' : undefined }}>{[['Default layer', base, setBase], ['Preview layer', layer, setLayer]].map(([label, value, set]) => <div className="trainer-field" key={label as string}><label htmlFor={`trainer-${label}`}>{label as string}</label><select id={`trainer-${label}`} value={value as number} onChange={e => (set as (n: number) => void)(Number(e.target.value))}>{board.keymap?.map((_, i) => <option key={i} value={i}>{i} · {board.cosmetic?.layer?.[String(i)] || `Layer ${i}`}</option>)}</select></div>)}</div>

                {error && <p role="alert" className="trainer-error">{error}</p>}

            </section><aside className="trainer-inspector"><div className="trainer-tabs" role="tablist" aria-label="Overlay settings">{['Placement', 'Appearance', 'Feedback'].map(t => <button key={t} id={`trainer-tab-${t}`} role="tab" aria-selected={tab === t} aria-controls="trainer-panel" onClick={() => setTab(t)}>{t}</button>)}</div>
                <div className="trainer-pane" role="tabpanel" id="trainer-panel" aria-labelledby={`trainer-tab-${tab}`}>
                    {tab === 'Appearance' && <><div className="trainer-field"><label htmlFor="trainer-preset">Preset</label><select id="trainer-preset" value={preset} onChange={e => { if (PRESETS[e.target.value]) update('appearance', { ...PRESETS[e.target.value] }); }}><option disabled value="Custom">Custom</option>{Object.keys(PRESETS).map(p => <option key={p}>{p}</option>)}</select></div>
                        {(['fill', 'outline', 'legend'] as const).map((name, i) => <div className="trainer-field" key={name}><label htmlFor={`trainer-${name}-alpha`}>{['Key fill', 'Outline', 'Legend'][i]}</label><div className="trainer-color-row"><input type="color" aria-label={`${name} color`} value={appearance[name]} onChange={e => color(name, e.target.value)} /><input id={`trainer-${name}-alpha`} type="range" min="0" max="100" value={appearance[`${name}Alpha`]} onChange={e => color(`${name}Alpha`, +e.target.value)} /><output>{appearance[`${name}Alpha`]}%</output></div></div>)}
                        <div className="trainer-field"><label htmlFor="trainer-width">Outline thickness <span>{appearance.width} px</span></label><input id="trainer-width" type="range" min="0" max="4" step=".5" value={appearance.width} onChange={e => color('width', +e.target.value)} /></div>
                        <label className="trainer-toggle">Contrasting legend halo<Switch checked={appearance.halo} onCheckedChange={v => color('halo', v)} aria-label="Contrasting legend halo" /></label>
                        <div className="trainer-accent-row">{(['changed', 'pressed'] as const).map(name => <label key={name}>{name === 'changed' ? 'Layer change' : 'Pressed key'}<input type="color" aria-label={`${name} accent`} value={appearance[name]} onChange={e => color(name, e.target.value)} /></label>)}</div></>}
                    {tab === 'Placement' && <>{host.state && <><p className="trainer-note">Move the overlay with the grip above its corner, and resize it with the grip beside it. Clicks anywhere else always reach the window underneath.</p><div className="trainer-live-controls"><Button variant="outline" onClick={() => void host.command({ op: 'place' })}>Place at bottom</Button><Button variant="outline" onClick={() => void host.command({ op: 'reload' })}>Reload layout</Button><Button variant="ghost" onClick={() => void host.command({ op: 'disconnect' })}>Disconnect</Button></div></>}<div className="trainer-field"><label htmlFor="trainer-hands">Hands</label><select id="trainer-hands" value={prefs.hands} onChange={e => update('hands', e.target.value as Preferences['hands'])}>{['Both', 'Left', 'Right'].map(h => <option key={h}>{h}</option>)}</select></div><div className="trainer-field"><label htmlFor="trainer-scale">Overlay size <span>{prefs.scale}%</span></label><input type="range" id="trainer-scale" min="50" max="150" value={prefs.scale} onChange={e => update('scale', +e.target.value)} /></div><Button variant="outline" onClick={() => { setHostDirty(true); setPrefs(preferences(DEFAULTS)); }}><RotateCcw /> Reset appearance and view</Button></>}
                    {tab === 'Feedback' && <><div className="trainer-field"><label htmlFor="trainer-effect">Layer-change highlight</label><select id="trainer-effect" value={prefs.effect} onChange={e => update('effect', e.target.value as Preferences['effect'])}>{['Off', 'Quick flash', 'Short fade'].map(e => <option key={e}>{e}</option>)}</select></div><div className="trainer-field"><label htmlFor="trainer-duration">Duration <span>{prefs.duration} ms</span></label><input id="trainer-duration" type="range" min="50" max="750" step="25" disabled={prefs.effect === 'Off'} value={prefs.duration} onChange={e => update('duration', +e.target.value)} /></div><hr />{host.state && <><label className="trainer-toggle">Highlight held keys<Switch aria-label="Highlight held keys" checked={host.state.config.highlightPressed} disabled={host.busy} onCheckedChange={v => void host.configure({ ...host.state!.config, highlightPressed: v })} /></label>{host.state.matrixAvailable === false && <p className="trainer-note">Matrix reads are unavailable on this firmware.</p>}{host.state.default === null && <div className="trainer-field"><label htmlFor="host-default">Default layer (older firmware)</label><select id="host-default" value={Math.max(0, Math.log2(host.state.config.manualDefault || 1))} onChange={e => void host.configure({ ...host.state!.config, manualDefault: (1 << Number(e.target.value)) >>> 0 })}>{board.keymap?.map((_, i) => <option key={i} value={i}>Layer {i}</option>)}</select></div>}</>}<h2>Pressed-key color</h2><p className="trainer-note">Try a simulated chord. No key activity is being monitored.</p><Button variant="outline" onClick={() => setHeld(new Set(keys.slice(8, 11).map(k => k.id)))}>Preview held keys</Button></>}
                    {tab === 'Practice' && <><label className="trainer-toggle">Recall practice<Switch checked={recall} onCheckedChange={v => { setRecall(v); setRevealed(false); }} aria-label="Recall practice" /></label>{recall && target && <div className="trainer-recall"><span className="trainer-eyebrow">FIND THIS BINDING</span><strong>{target.label}</strong><p>{target.hand} hand</p><Button variant="outline" disabled={revealed} onClick={() => setRevealed(true)}>Reveal</Button><div className="trainer-grade"><Button variant="outline" disabled={!revealed} onClick={() => grade(true)}>Remembered</Button><Button variant="outline" disabled={!revealed} onClick={() => grade(false)}>Again</Button></div><p>{correct} remembered · {attempts} attempts</p></div>}<p className="trainer-note">Self-assessed practice. Nothing is recorded from your typing. While following the board, recall also hides the desktop legends. Closing these controls returns the overlay to reference mode.</p><hr /><h2>Familiar bindings</h2><p className="trainer-note">Select a key in the preview to mark its current binding familiar.</p><select aria-label="Familiar binding" value={selected ?? ''} onChange={e => setSelected(+e.target.value)}><option value="" disabled>Select a binding</option>{learnable.map(k => <option key={k.id} value={k.id}>{k.hand} · {k.label} · {k.id}</option>)}</select><div className="trainer-grade"><Button variant="outline" disabled={!chosen || chosen.code < 2} onClick={() => { if (chosen) setFamiliar(s => new Set([...s, `${chosen.id}:${chosen.code}`])); }}>Mark familiar</Button><Button variant="ghost" onClick={() => setFamiliar(new Set())}>Clear</Button></div><label className="trainer-toggle">Hide familiar legends<Switch checked={hideFamiliar} onCheckedChange={setHideFamiliar} aria-label="Hide familiar legends" /></label></>}
                </div>{(hostDirty || host.busy || storageError) && <div className="trainer-inspector-footer" role="status">{storageError ? 'Settings could not be saved' : 'Saving…'}</div>}
            </aside></div>
        </main>
    </div>;
}
