import React from "react";
import ReactDOM from "react-dom/client";
import { CompanionApp } from "./App";
import { CompanionErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

window.addEventListener("error", (event) => {
  const node = document.getElementById("root");
  if (!node || node.querySelector(".companion-crash")) return;
  const pre = document.createElement("pre");
  pre.className = "companion-crash";
  pre.style.cssText = "padding:16px;white-space:pre-wrap;color:#c94b42";
  pre.textContent = event.message || "unknown error";
  node.prepend(pre);
});

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
try {
  ReactDOM.createRoot(root).render(
    <CompanionErrorBoundary>
      <CompanionApp />
    </CompanionErrorBoundary>,
  );
} catch (error) {
  root.textContent = error instanceof Error ? error.message : String(error);
}
