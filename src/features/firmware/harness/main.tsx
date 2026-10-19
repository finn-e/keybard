import React from "react";
import ReactDOM from "react-dom/client";
import "../../../index.css";
import { HarnessApp } from "./HarnessApp";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <HarnessApp />
    </React.StrictMode>,
);
