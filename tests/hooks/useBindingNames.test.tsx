import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { KeyboardInfo } from '../../src/types/keyboard.types';
import { useBindingNames } from '../../src/hooks/useBindingNames';
const state = vi.hoisted(() => ({keyboard: null as KeyboardInfo|null, isConnected:true,setKeyboard:vi.fn(),queue:vi.fn(),sendSvil:vi.fn()}));
vi.mock('@/contexts/KeyboardContext',()=>({useKeyboard:()=>state}));
vi.mock('@/contexts/ChangesContext',()=>({useChanges:()=>({queue:state.queue})}));
vi.mock('@/services/usb.service',async original=>({...await original<typeof import('../../src/services/usb.service')>(),usbInstance:{svilProtocolVersion:3,sendSvil:state.sendSvil}}));
beforeEach(()=>{vi.clearAllMocks();state.keyboard={svil_proto:3,macro_count:4,tapdance_count:4};state.isConnected=true;state.setKeyboard.mockImplementation(fn=>state.keyboard=fn(state.keyboard));state.queue.mockResolvedValue(undefined);state.sendSvil.mockResolvedValue(Uint8Array.of(0x1c,0));});
describe('binding name draft persistence',()=>{
    it('stages name and blank clearing under stable write keys',async()=>{
        const {result}=renderHook(()=>useBindingNames());
        await act(async()=>{await result.current.renameBinding('macro',2,'Email')});
        expect(state.keyboard?.cosmetic?.macros?.['2']).toBe('Email');
        expect(state.queue.mock.calls[0][2].writeKey).toBe('label:macro:2');
        expect(state.sendSvil).not.toHaveBeenCalled();
        await state.queue.mock.calls[0][1]();expect(state.sendSvil).toHaveBeenCalledTimes(1);
        await act(async()=>{await result.current.renameBinding('macro',2,'')});
        expect(state.keyboard?.cosmetic?.macros).toEqual({});
    });
    it('rejects unsupported board labels without creating a false saved-looking name',async()=>{
        state.keyboard!.svil_proto=1;const {result}=renderHook(()=>useBindingNames());
        await act(async()=>{expect(await result.current.renameBinding('tapdance',0,'Tap')).toBe(false)});
        expect(result.current.nameError).toContain('firmware');expect(state.queue).not.toHaveBeenCalled();expect(state.keyboard?.cosmetic).toBeUndefined();
    });
    it('names a combo in Keybard only: no queued write and no USB traffic, even when connected',async()=>{
        const {result}=renderHook(()=>useBindingNames());
        await act(async()=>{expect(await result.current.renameBinding('combo',3,'  Dictation ')).toBe(true)});
        expect(state.keyboard?.cosmetic?.combos).toEqual({'3':'Dictation'});
        await act(async()=>{await result.current.renameBinding('combo',3,'')});
        expect(state.keyboard?.cosmetic?.combos).toEqual({});
        expect(state.queue).not.toHaveBeenCalled();expect(state.sendSvil).not.toHaveBeenCalled();
    });
    it('checks combo names with the label rules on any firmware',async()=>{
        state.keyboard!.svil_proto=1;const {result}=renderHook(()=>useBindingNames());
        await act(async()=>{expect(await result.current.renameBinding('combo',0,'Zoom')).toBe(true)});
        expect(state.keyboard?.cosmetic?.combos?.['0']).toBe('Zoom');
        await act(async()=>{expect(await result.current.renameBinding('combo',0,'x'.repeat(17))).toBe(false)});
        expect(result.current.nameError).toMatch(/16 UTF-8 bytes/);expect(state.keyboard?.cosmetic?.combos?.['0']).toBe('Zoom');
        expect(state.queue).not.toHaveBeenCalled();
    });
    it('keeps offline names exportable without queuing device writes',async()=>{
        state.isConnected=false;const {result}=renderHook(()=>useBindingNames());
        await act(async()=>{await result.current.renameBinding('tapdance',0,'Tap')});
        expect(state.keyboard?.cosmetic?.tapdances?.['0']).toBe('Tap');expect(state.queue).not.toHaveBeenCalled();
    });
});
