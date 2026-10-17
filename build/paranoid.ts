// Keybard Paranoid: a single self-contained HTML file meant to be opened from
// disk. Everything is inlined, and a Content Security Policy written into the
// page blocks it from fetching or loading anything. The policy cannot stop
// navigations; the contained-browser launchers handle that. See docs/paranoid.md.
import { createHash } from "crypto";
import { parse } from "parse5";
import { readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import type { Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const LAYERS = "virtual:bundled-layers";
const FONTS = "virtual:paranoid-fonts";
export const PARANOID_FILE = "keybard-paranoid.html";

/** The layer library: fetched from public/ normally, compiled in for Paranoid. */
export function bundledLayersPlugin(paranoid: boolean, root = process.cwd()): Plugin {
    return {
        name: "keybard-bundled-layers",
        resolveId(id) {
            if (id === LAYERS || id === FONTS) return "\0" + id;
        },
        load(id) {
            if (id === "\0" + LAYERS) {
                if (!paranoid) return "export default null;";
                const json = readFileSync(path.join(root, "public/layer-library/layers.json"), "utf8");
                JSON.parse(json);
                return `export default ${json};`;
            }
            if (id === "\0" + FONTS) {
                return paranoid ? `import ${JSON.stringify(path.join(root, "src/paranoid/fonts.css").replace(/\\/g, "/"))};` : "";
            }
        },
    };
}

/** Policy for the finished file. Only data embedded in the page may be read. */
export function contentSecurityPolicy(scriptHashes: string[]): string {
    return [
        "default-src 'none'",
        `script-src ${scriptHashes.map(h => `'sha256-${h}'`).join(" ")}`,
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "font-src data:",
        // 'self' is Keybard Overlay when it serves this page; opened from disk it reaches nothing.
        "connect-src 'self' data: blob:",
        "media-src 'none'",
        "object-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
        "manifest-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join("; ");
}

// The static page is checked with a real HTML parser, so entity-encoded or
// oddly quoted attributes are seen exactly as the browser sees them.
type Node = { nodeName: string; tagName?: string; value?: string; attrs?: { name: string; value: string; prefix?: string }[]; childNodes?: Node[]; content?: Node };
const URL_ATTRIBUTES = new Set(["src", "href", "srcset", "poster", "data", "action", "formaction", "ping", "background", "xlink:href",
    "to", "from", "values", "codebase", "cite", "longdesc", "manifest", "icon", "archive", "classid", "lowsrc", "dynsrc", "itemtype"]);
const BANNED_ELEMENTS = new Set(["base", "iframe", "frame", "frameset", "object", "embed", "portal", "fencedframe", "applet", "form",
    "set", "animate", "animatemotion", "animatetransform"]);
const BANNED_RELS = /\b(prerender|prefetch|preconnect|dns-prefetch|preload|modulepreload|manifest|serviceworker)\b/i;
const SCRIPT_TYPES = new Set(["", "module", "text/javascript"]);

function walk(node: Node, visit: (n: Node) => void) {
    visit(node);
    for (const child of node.childNodes ?? []) walk(child, visit);
    if (node.content) walk(node.content, visit);
}
const textOf = (n: Node) => (n.childNodes ?? []).map(c => c.value ?? "").join("");
const isEmbedded = (url: string) => { const v = url.trim(); return !v || /^data:/i.test(v) || v.startsWith("#"); };
// Undo CSS escapes (u\72l, @\69mport) and comments before looking for loads.
const decodeCss = (css: string) => css
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

function cssProblems(css: string, where: string): string[] {
    const decoded = decodeCss(css);
    const problems = /@import/i.test(decoded) ? [`${where}: @import`] : [];
    for (const [, fn, , ref] of decoded.matchAll(/(url|src|image-set|image)\(\s*(["']?)([^"')]*)\2/gi)) {
        if (!isEmbedded(ref)) problems.push(`${where}: ${fn}(${ref})`);
    }
    return problems;
}

/** Inline scripts the CSP will allow by hash: classic or module scripts with no src. */
function inlineScripts(html: string): Node[] {
    const scripts: Node[] = [];
    walk(parse(html) as unknown as Node, n => {
        if (n.tagName !== "script") return;
        const type = (n.attrs?.find(a => a.name === "type")?.value ?? "").trim().toLowerCase();
        if (SCRIPT_TYPES.has(type) && !n.attrs?.some(a => a.name === "src")) scripts.push(n);
    });
    return scripts;
}

/** Everything in the static page that could load or navigate anywhere but embedded data. */
export function staticReferences(html: string): string[] {
    const problems: string[] = [];
    walk(parse(html) as unknown as Node, n => {
        if (!n.tagName) return;
        const tag = n.tagName.toLowerCase();
        const attrs = new Map((n.attrs ?? []).map(a => [(a.prefix ? `${a.prefix}:` : "") + a.name.toLowerCase(), a.value]));
        const shown = `<${tag}${[...attrs].map(([k, v]) => ` ${k}="${v.slice(0, 80)}"`).join("")}>`;
        if (BANNED_ELEMENTS.has(tag)) { problems.push(shown); return; }
        // Refresh, Link, Set-Cookie… none belong in the source; the build adds its own CSP meta.
        if (tag === "meta" && attrs.has("http-equiv")) problems.push(shown);
        if (tag === "link" && BANNED_RELS.test(attrs.get("rel") ?? "")) problems.push(shown);
        if (tag === "script" && (!SCRIPT_TYPES.has((attrs.get("type") ?? "").trim().toLowerCase()) || attrs.has("src"))) problems.push(shown);
        if (tag === "style") problems.push(...cssProblems(textOf(n), "<style>"));
        for (const [name, value] of attrs) {
            if (name === "style") { problems.push(...cssProblems(value, shown)); continue; }
            if (!URL_ATTRIBUTES.has(name)) continue;
            const urls = name === "srcset" ? value.split(",").map(v => v.trim().split(/\s+/)[0]) : [value];
            if (!urls.every(isEmbedded)) { problems.push(shown); break; }
        }
    });
    return problems;
}

/** Add the CSP to a built page, refusing anything that would load from elsewhere. */
export function lockDown(source: string): string {
    // Browsers hash script text after turning CRLF into LF, so hash (and ship) LF text.
    const html = source.replace(/\r\n?/g, "\n");
    const problems = staticReferences(html);
    if (problems.length) throw new Error(`Paranoid build still references external resources:\n${problems.join("\n")}`);
    const hashes = inlineScripts(html).map(n => createHash("sha256").update(textOf(n), "utf8").digest("base64"));
    if (!hashes.length) throw new Error("Paranoid build has no inline scripts");
    const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(hashes)}">`;
    const charset = /<meta\s+charset=["']?utf-8["']?\s*\/?>/i;
    if (!charset.test(html)) throw new Error("Paranoid build lost its charset meta");
    return html.replace(charset, m => `${m}\n${meta}`);
}

export function paranoidPlugins(root: string): Plugin[] {
    const outDir = path.join(root, "dist-paranoid");
    return [
        viteSingleFile({ removeViteModuleLoader: true }),
        {
            name: "keybard-paranoid-html",
            transformIndexHtml: {
                order: "pre",
                handler(html) {
                    const icon = readFileSync(path.join(root, "public/favicon.png")).toString("base64");
                    return html
                        .replace(/^\s*<link\b[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*$/gim, "")
                        .replace(/(<link\b[^>]*rel=["']icon["'][^>]*href=)["'][^"']*["']/i, `$1"data:image/png;base64,${icon}"`);
                },
            },
            closeBundle() {
                const built = path.join(outDir, "index.html");
                writeFileSync(built, lockDown(readFileSync(built, "utf8")));
                const final = path.join(outDir, PARANOID_FILE);
                renameSync(built, final);
                const digest = createHash("sha256").update(readFileSync(final)).digest("hex");
                writeFileSync(path.join(outDir, "SHA256SUMS.txt"), `${digest}  ${PARANOID_FILE}\n`);
            },
        },
    ];
}
