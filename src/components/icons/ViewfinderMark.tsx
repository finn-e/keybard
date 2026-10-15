import React from "react";

/**
 * The rail logo's mark while a binding editor is open: four corner brackets
 * around a filled dot, a viewfinder that says the editor has the focus. The
 * brand mark (Logo) has bars on the middle of each side instead, with open
 * corners and a larger dot; it comes back when the editor closes.
 */
const ViewfinderMark: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
        <path
            d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"
            className="stroke-kb-ink"
            strokeWidth={2.4}
            strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="4.2" className="fill-kb-ink" />
    </svg>
);

export default ViewfinderMark;
