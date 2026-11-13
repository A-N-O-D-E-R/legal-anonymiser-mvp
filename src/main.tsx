import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import "./ui/styles.css";

const render = () => createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
// Inside Word, wait for Office.js; when opened in a plain browser (development) render immediately.
if (typeof Office !== "undefined" && Office.onReady) Office.onReady().then(render, render); else render();
