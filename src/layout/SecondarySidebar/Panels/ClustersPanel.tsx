import React from "react";
import DescriptionBlock from "@/layout/SecondarySidebar/components/DescriptionBlock";
import FragmentsPanel from "./FragmentsPanel";

/**
 * Which key cluster sits at each finger and thumb position: a preset for the
 * whole board, then one choice per position, grouped by hand.
 */
const ClustersPanel: React.FC = () => (
    <section className="flex flex-col">
        <DescriptionBlock>
            Match the drawn layout to the clusters and pointing devices on your board.
        </DescriptionBlock>
        <FragmentsPanel />
    </section>
);

export default ClustersPanel;
