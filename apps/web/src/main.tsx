import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import { App } from "./App.js";

const wurzel = document.getElementById("wurzel");
if (wurzel === null) throw new Error("Element #wurzel fehlt in index.html");

createRoot(wurzel).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
