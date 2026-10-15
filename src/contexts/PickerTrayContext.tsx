import * as React from "react";

/**
 * Where the Standard Keys keyboard renders with the L-shaped picker
 * (?pickerShape=L|Lfull). The tray under the layout owns two slots: its
 * header (the layout selector) and its body (the keyboard). With no tray,
 * both are null and the keyboard stays in the side panel as usual.
 */
export interface PickerTrayValue {
    header: HTMLElement | null;
    body: HTMLElement | null;
    /** Room the keyboard has inside the tray, in px. */
    keyboardHeight: number;
}

const NO_TRAY: PickerTrayValue = { header: null, body: null, keyboardHeight: 0 };

const PickerTrayContext = React.createContext<PickerTrayValue>(NO_TRAY);

export const PickerTrayProvider = PickerTrayContext.Provider;

export const usePickerTray = (): PickerTrayValue => React.useContext(PickerTrayContext);
