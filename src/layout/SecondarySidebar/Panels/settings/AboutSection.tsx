import React from "react";
import { PARANOID } from "@/lib/paranoid";
import { STABLE_URL } from "@/components/ChannelBanner";
import { keybardVersion } from "@/utils/build-info";

export const NEXT_URL = "https://next.keybard.svalboard.com/";
export const RELEASE_NOTES_URL = "https://github.com/svalboard/keybard/releases";
export const COMMUNITY_URL = "https://svalboard.com/";

const linkClass = "underline underline-offset-2 hover:text-kb-ink";

/** Keybard's own facts and links. The other site is a plain link: the site is the channel. */
const AboutSection: React.FC = () => {
    const onNext = import.meta.env.VITE_CHANNEL === "next";
    const other = onNext
        ? { label: "Stable", url: STABLE_URL, host: "keybard.svalboard.com" }
        : { label: "Bleeding edge", url: NEXT_URL, host: "next.keybard.svalboard.com" };

    return (
        <div className="flex flex-col gap-2 px-3 py-2.5 text-sm">
            <dl aria-label="Keybard" className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Keybard</dt>
                <dd className="font-mono text-kb-ink break-all">{keybardVersion()}</dd>
                <dt className="text-muted-foreground">{other.label}</dt>
                <dd>
                    <a href={other.url} target="_blank" rel="noopener" className={linkClass}>{other.host}</a>
                </dd>
            </dl>
            <p className="flex flex-row flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                {!PARANOID && (
                    <a href={`${import.meta.env.BASE_URL}manual/`} target="_blank" rel="noopener" className={linkClass}>Manual</a>
                )}
                <a href={RELEASE_NOTES_URL} target="_blank" rel="noopener" className={linkClass}>Release notes</a>
                <a href={COMMUNITY_URL} target="_blank" rel="noopener" className={linkClass}>Svalboard community</a>
            </p>
        </div>
    );
};

export default AboutSection;
