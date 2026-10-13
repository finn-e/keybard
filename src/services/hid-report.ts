// Raw HID report length of a connected keyboard.
//
// Svalboard firmware sends and expects raw HID reports of one fixed length:
// 32 bytes on today's firmware, 64 bytes on newer builds. The length is read
// from the device's HID report descriptor (as WebHID exposes it), never
// assumed, and every buffer, pad and chunk size is derived from it.

/** Report length used when the descriptor can't be read: today's firmware. */
export const DEFAULT_REPORT_LENGTH = 32;

/** The smallest report the protocol fits in (the client-ID bootstrap uses bytes 0-30). */
export const MIN_REPORT_LENGTH = 32;

/** Bytes of the 0xDD client wrapper: [0xDD][client_id:4][protocol]. */
export const WRAPPER_HEADER_BYTES = 6;

/** Raw HID interfaces Svalboard firmware exposes (usage page, usage). */
export const RAW_HID_USAGES: ReadonlyArray<{ usagePage: number; usage: number }> = [
    { usagePage: 0xff61, usage: 0x62 },  // Svil keyboards
    { usagePage: 0xff60, usage: 0x61 },  // Raw HID interface used by some Sval firmware builds
    { usagePage: 0xff60, usage: 0x62 },  // Alternate Raw HID interface
];

/** Length in bytes of a report's data, from its descriptor items (report ID excluded). */
function reportBytes(report: HIDReportInfo): number {
    const bits = (report.items ?? []).reduce(
        (sum, item) => sum + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0);
    return Math.floor(bits / 8);
}

/**
 * The raw HID report length of a device: the size of the first output report of
 * its raw HID collection. Falls back to DEFAULT_REPORT_LENGTH when the device has
 * no such collection or its descriptor gives no usable size.
 */
export function reportLength(device: HIDDevice | null | undefined): number {
    const collections = device?.collections ?? [];
    const raw = collections.find((c) =>
        RAW_HID_USAGES.some((u) => c.usagePage === u.usagePage && c.usage === u.usage));
    const output = raw?.outputReports?.[0];
    const length = output ? reportBytes(output) : 0;
    return length >= MIN_REPORT_LENGTH ? length : DEFAULT_REPORT_LENGTH;
}

/**
 * Bytes left for data in one report after `headerBytes` of framing (counted from
 * the start of the report, wrapper included). Takes anything with an optional
 * reportLength so services work with test doubles that don't set one.
 */
export function payloadCapacity(link: { reportLength?: number } | null | undefined, headerBytes: number): number {
    return (link?.reportLength || DEFAULT_REPORT_LENGTH) - headerBytes;
}
