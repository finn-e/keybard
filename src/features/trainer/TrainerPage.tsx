import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { GraduationCap, Upload, RotateCcw, Unplug } from 'lucide-react';
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
import { useFeedbackDemo } from './useFeedbackDemo';

/** The layer-change highlight choices; each sets the effect and its duration together. */
export const EFFECTS: Array<[string, Partial<Preferences>]> = [
    ['Off', { effect: 'Off' }],
    ['Flash', { effect: 'Quick flash', duration: 150 }],
    ['Fade', { effect: 'Short fade', duration: 400 }],
];
const ALPHAS = [['fill', 'Fill', 'Key fill'], ['outline', 'Outline', 'Outline'], ['legend', 'Legend', 'Legend']] as const;

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
    const [background, setBackground] = useState('Dark');
    const [layer, setLayer] = useState(0), [base, setBase] = useState(0);
    const [held, setHeld] = useState<Set<number>>(new Set());
    const [changed, setChanged] = useState<Set<number>>(new Set());
    const input = useRef<HTMLInputElement>(null);
    const previewCard = useRef<HTMLDivElement>(null);
    const importGeneration = useRef(0);
    useEffect(() => () => { importGeneration.current++; }, []);
    useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); setStorageError(false); } catch { setStorageError(true); } }, [prefs]);
    useEffect(() => { setLayer(0); setBase(0); }, [board]);
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
    const layerCount = board.keymap?.length || 1;
    const previewKeys = (shown: number) => surfaceKeys(board, 1 << Math.min(shown, layerCount - 1), 1 << Math.min(base, layerCount - 1), prefs.hands, internationalLayout);
    // The demo flips to the first layer that changes at least three keys, so the highlight shows.
    const alternate = useMemo(() => {
        if (following) return null;
        const codes = previewKeys(layer).map(k => k.code);
        for (let i = 0; i < layerCount; i++) {
            if (i === layer) continue;
            if (previewKeys(i).filter((k, n) => k.code !== codes[n]).length >= 3) return i;
        }
        return null;
    }, [board, layer, base, prefs.hands, internationalLayout, following]);
    const keysRef = useRef<SurfaceKey[]>([]);
    const demoLayer = useFeedbackDemo({
        enabled: !following && active, alternate, setHeld, card: previewCard,
        chord: () => keysRef.current.slice(8, 11).map(k => k.id),
        replay: `${prefs.effect}:${prefs.duration}:${prefs.appearance.changed}:${prefs.appearance.pressed}:${prefs.hands}`,
    });
    const keys = useMemo<SurfaceKey[]>(() => {
        if (following) {
            if (!host.state?.board || !host.state.valid) return [];
            try { return surfaceKeys(host.state.board, host.state.active, host.state.default ?? host.state.config.manualDefault, prefs.hands, internationalLayout); }
            catch { return []; }
        }
        return previewKeys(demoLayer ?? layer);
    }, [board, layer, base, demoLayer, prefs.hands, internationalLayout, following, host.state?.valid, host.state?.active, host.state?.default, host.state?.config.manualDefault]);
    keysRef.current = keys;
    const previous = useRef<SurfaceKey[]>([]);
    useEffect(() => {
        const before = new Map(previous.current.map(k => [k.id, `${k.code}:${k.layer}`]));
        setChanged(new Set(keys.filter(k => before.has(k.id) && before.get(k.id) !== `${k.code}:${k.layer}`).map(k => k.id)));
        previous.current = keys;
        setHeld(new Set());
        const timer = window.setTimeout(() => setChanged(new Set()), prefs.duration);
        return () => clearTimeout(timer);
    }, [keys, prefs.duration]);
    useEffect(() => { if (!held.size) return; const timer = setTimeout(() => setHeld(new Set()), 800); return () => clearTimeout(timer); }, [held]);
    const appearance = prefs.appearance;
    const preset = Object.entries(PRESETS).find(([, a]) => JSON.stringify(a) === JSON.stringify(appearance))?.[0] || 'Custom';
    const patch = (value: Partial<Preferences>) => { setHostDirty(true); setPrefs(p => ({ ...p, ...value })); };
    const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => patch({ [key]: value } as Partial<Preferences>);
    const color = <K extends keyof Appearance>(key: K, value: Appearance[K]) => update('appearance', { ...appearance, [key]: value });
    const effectChoice = EFFECTS.find(([, e]) => e.effect === prefs.effect)?.[0];
    async function importFile(file: File | undefined) {
        if (!file) return;
        const generation = ++importGeneration.current;
        try { const loaded = await fileService.loadFile(file); if (generation !== importGeneration.current) return;
            if (loaded.rows !== 10 || loaded.cols !== 6 || !loaded.keymap?.length) throw new Error('Choose a Svalboard layout with a 10 × 6 matrix.');
            setImported(loaded); setLive(false); setSource('import'); setError('');
        } catch (e) { if (generation === importGeneration.current) setError(e instanceof Error ? e.message : 'Could not read this layout.'); }
    }
    const segments = (label: string, options: readonly (readonly [string, boolean, () => void, string?])[], radio = false) =>
        <div className="trainer-segments small" role={radio ? 'radiogroup' : 'group'} aria-label={label}>
            {options.map(([text, on, act, title]) => <button key={text} type="button" title={title} onClick={act}
                {...(radio ? { role: 'radio', 'aria-checked': on } : { 'aria-pressed': on })}>{text}</button>)}
        </div>;
    return <div className="trainer-page">
        <header className="trainer-header"><GraduationCap size={19} className="text-kb-green" /><h1>Overlay</h1></header>
        <main className="trainer-main">
            {!host.state && (PARANOID ? <p className="trainer-note">For the desktop overlay, start Keybard Host in paranoid mode (Start-Paranoid.cmd) and use the Keybard it opens. This file never contacts anything else.</p> : <HostInstall onConnect={host.local ? undefined : host.connect} />)}
            <div className="trainer-workspace"><section className="trainer-stage">
                {host.state && <div className="trainer-host-section"><div className="trainer-host-toolbar">
                    <select aria-label="Host keyboard" value={host.state.selectedDevice || ''} onChange={e => { setLive(true); void host.command({ op: 'connect', id: e.target.value }); }}><option value="" disabled>Select a Svalboard…</option>{host.state.devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                    {host.state.selectedDevice && <Button variant="ghost" size="icon" aria-label="Disconnect" title="Disconnect" onClick={() => void host.command({ op: 'disconnect' })}><Unplug /></Button>}
                </div><p className="trainer-error" role="status" hidden={host.state.valid}>{host.state.status}</p><HostVersion build={host.build} /></div>}
                {host.error && <p role="alert" className="trainer-error">{host.error}</p>}
                <div className="trainer-preview-card" ref={previewCard}>
                    <div className={`trainer-canvas trainer-bg-${background.toLowerCase()}`}><div className="trainer-keyboard" style={{ width: `${prefs.scale}%` }}><OverlaySurface keys={keys} appearance={appearance} changed={changed} held={following ? new Set(host.state?.pressed || []) : held} effect={prefs.effect} duration={prefs.duration} hidden={new Set()} capitals={host.state?.config.capitalAlphas === true} /></div></div>
                    <div className="trainer-preview-footer"><span>Preview background</span><div className="trainer-segments">{['Light', 'Dark', 'Busy'].map(b => <button key={b} aria-pressed={background === b} onClick={() => setBackground(b)}>{b}</button>)}</div></div>
                </div>
                {!following && <>
                    <div className="trainer-source-card"><div className="trainer-field"><label htmlFor="trainer-source">Layout source</label><select id="trainer-source" value={source} onChange={e => { setLive(e.target.value === 'live'); if (e.target.value !== 'live') setSource(e.target.value); }}>{host.state && <option value="live">Live board · read-only</option>}<option value="snapshot">{originalKeyboard ? 'Loaded snapshot' : 'QWERTY example (no snapshot loaded)'}</option>{keyboard && <option value="draft">Editor draft{hasUnsavedChanges ? ' · unsaved changes' : ''}</option>}<option value="example">QWERTY example</option>{imported && <option value="import">Imported trainer layout</option>}</select></div><Button variant="outline" onClick={() => input.current?.click()}><Upload /> Import for trainer</Button><input ref={input} type="file" accept=".svil,.vil,.viable,.json,.kbi" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></div>
                    <div className="trainer-layer-controls">{[['Default layer', base, setBase], ['Preview layer', layer, setLayer]].map(([label, value, set]) => <div className="trainer-field" key={label as string}><label htmlFor={`trainer-${label}`}>{label as string}</label><select id={`trainer-${label}`} value={value as number} onChange={e => (set as (n: number) => void)(Number(e.target.value))}>{board.keymap?.map((_, i) => <option key={i} value={i}>{i} · {board.cosmetic?.layer?.[String(i)] || `Layer ${i}`}</option>)}</select></div>)}</div>
                </>}
                {error && <p role="alert" className="trainer-error">{error}</p>}
            </section><aside className="trainer-inspector">
                <section className="trainer-pane" role="group" aria-label="Overlay settings">
                    <div className="trainer-group">
                        <div className="trainer-group-head"><span className="trainer-eyebrow">STYLE</span>
                            <Button variant="ghost" size="icon" className="trainer-icon-button" aria-label="Reset style" title="Reset style" onClick={() => patch({ appearance: { ...DEFAULTS.appearance }, effect: DEFAULTS.effect, duration: DEFAULTS.duration })}><RotateCcw /></Button></div>
                        <div className="trainer-prop"><label htmlFor="trainer-preset">Preset</label><div className="trainer-prop-controls"><select id="trainer-preset" value={preset} onChange={e => { if (PRESETS[e.target.value]) update('appearance', { ...PRESETS[e.target.value] }); }}><option disabled value="Custom">Custom</option>{Object.keys(PRESETS).map(p => <option key={p}>{p}</option>)}</select></div></div>
                        {ALPHAS.map(([name, label, long]) => <div className="trainer-prop" key={name}><label htmlFor={`trainer-${name}-alpha`}>{label}</label><div className="trainer-prop-controls">
                            <input type="color" aria-label={`${long} color`} value={appearance[name]} onChange={e => color(name, e.target.value)} />
                            <input id={`trainer-${name}-alpha`} type="range" min="0" max="100" step="10" aria-label={`${long} opacity`} aria-valuetext={`${appearance[`${name}Alpha`]}%`} title={`${long} opacity`} value={appearance[`${name}Alpha`]} style={{ '--fill': `${appearance[`${name}Alpha`]}%` } as CSSProperties} onChange={e => color(`${name}Alpha`, +e.target.value)} />
                            <span className="trainer-readout" aria-hidden="true">{appearance[`${name}Alpha`]}%</span>
                            {name === 'legend' && <button type="button" className="trainer-chip" aria-pressed={appearance.halo} aria-label="Contrasting legend halo" title="Contrasting legend halo" onClick={() => color('halo', !appearance.halo)}>Halo</button>}
                        </div></div>)}
                        <div className="trainer-prop"><label>Width</label><div className="trainer-prop-controls"><span className="trainer-swatch-space" />{segments('Outline width', [0, 1, 2, 3, 4].map(w => [String(w), appearance.width === w, () => color('width', w), w ? `${w} px` : 'No outline'] as const))}</div></div>
                    </div>
                    <div className="trainer-group">
                        <div className="trainer-group-head"><span className="trainer-eyebrow">FEEDBACK</span></div>
                        <div className="trainer-prop"><label>Layer</label><div className="trainer-prop-controls">
                            <input type="color" aria-label="Layer change color" value={appearance.changed} onChange={e => color('changed', e.target.value)} />
                            {segments('Layer-change highlight', EFFECTS.map(([text, value]) => [text, effectChoice === text, () => patch(value)] as const), true)}
                        </div></div>
                        <div className="trainer-prop"><label>Held</label><div className="trainer-prop-controls">
                            <input type="color" aria-label="Held key color" value={appearance.pressed} onChange={e => color('pressed', e.target.value)} />
                            <Switch aria-label="Highlight held keys" title={host.state ? 'Highlight held keys' : 'Connect Keybard Host to change this'} checked={host.state ? host.state.config.highlightPressed : true} disabled={!host.state || host.busy || host.state.matrixAvailable === false} onCheckedChange={v => host.state && void host.configure({ ...host.state.config, highlightPressed: v })} />
                            {host.state?.matrixAvailable === false && <span className="trainer-muted" title="Matrix reads are unavailable on this firmware">No matrix</span>}
                        </div></div>
                        <div className="trainer-prop"><label>Hands</label><div className="trainer-prop-controls"><span className="trainer-swatch-space" />{segments('Hands', (['Both', 'Left', 'Right'] as const).map(h => [h, prefs.hands === h, () => update('hands', h)] as const))}</div></div>
                        {host.state && host.state.default === null && <div className="trainer-prop"><label htmlFor="host-default" title="Default layer (older firmware)">Default</label><div className="trainer-prop-controls"><select id="host-default" aria-label="Default layer (older firmware)" value={Math.max(0, Math.log2(host.state.config.manualDefault || 1))} onChange={e => void host.configure({ ...host.state!.config, manualDefault: (1 << Number(e.target.value)) >>> 0 })}>{board.keymap?.map((_, i) => <option key={i} value={i}>Layer {i}</option>)}</select></div></div>}
                    </div>
                </section>{(hostDirty || host.busy || storageError) && <div className="trainer-inspector-footer" role="status">{storageError ? 'Settings could not be saved' : 'Saving…'}</div>}
            </aside></div>
        </main>
    </div>;
}
