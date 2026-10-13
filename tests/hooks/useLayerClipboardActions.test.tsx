import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayerClipboardActions } from '../../src/hooks/useLayerClipboardActions';
const m = vi.hoisted(() => ({keyboard: {} as any, setKeyboard: vi.fn(), updateKey: vi.fn(), queue: vi.fn(), copyLayer: vi.fn(), read: vi.fn(), led: vi.fn()}));
vi.mock('@/contexts/KeyboardContext', () => ({useKeyboard: () => ({...m, isConnected: true})}));
vi.mock('@/contexts/ChangesContext', () => ({useChanges: () => ({queue: m.queue})}));
vi.mock('@/contexts/LayoutLibraryContext', () => ({useLayoutLibrary: () => ({copyLayer: m.copyLayer})}));
vi.mock('@/utils/layer-clipboard', async original => ({...await original(), readLayerClipboard: m.read}));
vi.mock('@/services/usb.service', () => ({usbInstance: {setLayerColor: m.led}}));
beforeEach(() => {vi.clearAllMocks(); m.keyboard = {rows: 1, cols: 2, layers: 2, keymap: [[4,5],[6,7]], cosmetic:{layer_colors:{0:'green'}}, layer_colors:[{hue:1,sat:2,val:3}]};});
describe('shared layer clipboard actions', () => {
 it('copies the requested layer with UI and hardware colors as a snapshot', () => {
  const {result}=renderHook(useLayerClipboardActions);
  act(()=>result.current.copy(0));
  expect(m.copyLayer.mock.calls[0][0]).toMatchObject({keymap:[4,5],layerColor:'green',ledColor:{hue:1,sat:2,val:3}});
  m.keyboard.keymap[0][0]=99;
  expect(m.copyLayer.mock.calls[0][0].keymap).toEqual([4,5]);
 });
 it('pastes into the requested target and stages all hardware writes', async () => {
  const {result}=renderHook(useLayerClipboardActions);
  act(()=>result.current.apply({keymap:[4,5],layerColor:'blue',ledColor:{hue:10,sat:20,val:30}},1));
  expect(m.setKeyboard.mock.calls[0][0]).toMatchObject({keymap:[[4,5],[4,5]],cosmetic:{layer_colors:{1:'blue'}}});
  expect(m.updateKey).not.toHaveBeenCalled(); expect(m.led).not.toHaveBeenCalled();
  expect(m.queue.mock.calls.map(c=>c[2].writeKey)).toEqual(['key:1:0:0','key:1:0:1','layer-color:1']);
  for(const call of m.queue.mock.calls) await call[1]();
  expect(m.updateKey).toHaveBeenCalledWith(1,0,0,4); expect(m.led).toHaveBeenCalledWith(1,10,20);
 });
 it('rejects malformed or differently sized layers before any mutation', () => {
  const {result}=renderHook(useLayerClipboardActions);
  expect(()=>result.current.apply({keymap:[4]},1)).toThrow('destination needs 2');
  expect(()=>result.current.apply({keymap:[4,-1]},1)).toThrow();
  expect(m.queue).not.toHaveBeenCalled();expect(m.setKeyboard).not.toHaveBeenCalled();
 });
 it('reports clipboard errors visibly instead of silently ignoring them', async () => {
  m.read.mockRejectedValue(new Error('Clipboard blocked'));
  const {result}=renderHook(useLayerClipboardActions);
  await act(()=>result.current.paste(1));
  expect(result.current.clipboardError).toBe('Clipboard blocked');expect(m.queue).not.toHaveBeenCalled();
 });
 it('does not paste stale data when the editing target changes during a clipboard read', async () => {
  let resolve!: (value:any)=>void; m.read.mockImplementation(()=>new Promise(r=>resolve=r));
  const {result,rerender}=renderHook(useLayerClipboardActions);
  let pending!:Promise<void>;act(()=>{pending=result.current.paste(1)});
  m.keyboard=structuredClone(m.keyboard);rerender();
  await act(async()=>{resolve({keymap:[4,5]});await pending});
  expect(m.queue).not.toHaveBeenCalled();expect(result.current.clipboardError).toContain('layout changed');
 });
});
