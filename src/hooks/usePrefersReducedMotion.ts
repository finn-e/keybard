import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function query(): MediaQueryList | null {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    try {
        return window.matchMedia(QUERY);
    } catch {
        return null;
    }
}

/** The OS "reduce motion" preference, following changes. False where matchMedia is missing. */
export function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(() => query()?.matches ?? false);
    useEffect(() => {
        const mql = query();
        if (!mql) return;
        const update = () => setReduced(mql.matches);
        update();
        if (typeof mql.addEventListener === "function") {
            mql.addEventListener("change", update);
            return () => mql.removeEventListener("change", update);
        }
        mql.addListener?.(update);
        return () => mql.removeListener?.(update);
    }, []);
    return reduced;
}
