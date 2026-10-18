// @vitest-environment node
import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, lockDown } from '../../build/paranoid';

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('base64');
const page = (body: string) => `<!doctype html>\r\n<html lang="en"><head><meta charset="UTF-8" />\r\n<script>\r\nwindow.a = 1;\r\n</script></head><body>${body}<script type="module">console.log(2)</script></body></html>`;

describe('Keybard Paranoid lockdown', () => {
    it('adds a no-network policy right after the charset, hashing scripts as browsers see them (LF)', () => {
        const out = lockDown(page(''));
        expect(out).not.toContain('\r');
        const meta = out.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
        expect(meta).not.toBeNull();
        expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<script'));
        expect(meta![1]).toContain(`'sha256-${sha('\nwindow.a = 1;\n')}'`);
        expect(meta![1]).toContain(`'sha256-${sha('console.log(2)')}'`);
        expect(meta![1]).toContain("default-src 'none'");
        expect(meta![1]).not.toMatch(/unsafe-eval|https?:/);
    });

    it('refuses pages that still load anything from elsewhere', () => {
        for (const bad of [
            '<script src="https://cdn.example/x.js"></script>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2">',
            '<img src="/favicon.png">', '<link rel="icon" href="/favicon.png">',
            // Bypasses found in review:
            '<img srcset="data:image/png;base64,AA== 1x, https://x.example/a.png 2x">', '<video poster="https://x.example/p.png"></video>',
            '<svg><use href="https://x.example/s.svg#a"></use></svg>', '<svg><image xlink:href="https://x.example/i.png"></image></svg>',
            '<img src=https://x.example/unquoted.png>', '<style>@import "https://x.example/a.css";</style>',
            '<style>body{background:url(//x.example/b.png)}</style>', '<meta http-equiv="refresh" content="0;url=https://x.example/">',
            '<a ping="https://x.example/p" href="#">x</a>', '<link rel="prerender" href="data:text/html,">',
            '<link rel="dns-prefetch" href="//x.example">', '<script type="speculationrules">{}</script>',
            // Round-2 review bypasses:
            '<meta content="0;url=https://x.example/?a>b" http-equiv="refresh">', '<meta http-equiv="&#114;efresh" content="0;url=https://x.example/">',
            '<script type="&#115;peculationrules">{"prefetch":[{"urls":["https://x.example/"]}]}</script>', '<div style="background:url(https://x.example/i.png)"></div>',
            '<style>a{background:u\\72l(https://x.example/e.png)}</style>', '<style>@\\69mport "https://x.example/a.css";</style>',
            '<svg><a href="#"><set attributeName="href" to="https://x.example/"></set></a></svg>', '<meta http-equiv="link" content="<https://x.example/>; rel=preload">',
            '<base href="https://x.example/">', '<iframe srcdoc="<img src=https://x.example/>"></iframe>',
        ]) {
            expect(() => lockDown(page(bad))).toThrow(/external resources/);
        }
        expect(() => lockDown(page('<img src="data:image/png;base64,AA==">'))).not.toThrow();
        expect(() => lockDown(page('<style>a{background:url(data:image/png;base64,AA==)}</style><script>const s = "<img src=https://x.example>";</script>'))).not.toThrow();
    });

    it('only lets the page reach itself (the Keybard Overlay that serves it) or embedded data', () => {
        const policy = contentSecurityPolicy(['x']);
        expect(policy).toMatch(/connect-src 'self' data: blob:;/);
        expect(policy).toMatch(/form-action 'none'/);
        expect(policy).toMatch(/base-uri 'none'/);
    });
});
