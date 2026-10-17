import { useState } from "react";
import { useKeyboard } from "@/contexts/KeyboardContext";
import { useChanges } from "@/contexts/ChangesContext";
import { LabelService, validateLabelText } from "@/services/label.service";
import { usbInstance } from "@/services/usb.service";

const labels = new LabelService(usbInstance);

export type BindingNameKind = "macro" | "tapdance" | "combo";
const COSMETIC_KEY = { macro: "macros", tapdance: "tapdances", combo: "combos" } as const;

export function useBindingNames() {
    const { keyboard, setKeyboard, isConnected } = useKeyboard();
    const { queue } = useChanges();
    const [nameError, setNameError] = useState<string | null>(null);
    const renameBinding = async (kind: BindingNameKind, index: number, value: string) => {
        if (!keyboard) return false;
        const name = value.trim();
        setNameError(null);
        try {
            // Combo names stay in Keybard (files and backups): same rules, no board write.
            const boardKind = kind === "combo" || !isConnected ? null : kind;
            if (kind === "combo") validateLabelText(name);
            else if (boardKind) labels.validateName(keyboard, boardKind, name);
            const key = COSMETIC_KEY[kind];
            setKeyboard(current => {
                if (!current) return current;
                const names = { ...current.cosmetic?.[key] };
                if (name) names[String(index)] = name;
                else delete names[String(index)];
                return { ...current, cosmetic: { ...current.cosmetic, [key]: names } };
            });
            if (boardKind) await queue(`${boardKind} ${index} name`, async () => {
                await labels.saveName(keyboard, boardKind, index, name);
            }, { type: "label", writeKey: `label:${boardKind}:${index}` });
            return true;
        } catch (error) {
            setNameError(error instanceof Error ? error.message : "Could not save name.");
            return false;
        }
    };
    return { renameBinding, nameError };
}
