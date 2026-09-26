/* The redesigned Admin page, rendered against stand-in data (preview only). */
import "@react-spectrum/s2/page.css";
import "./next.css";

import { Provider } from "@react-spectrum/s2";
import { createRoot } from "react-dom/client";

import { Shell } from "./shell.jsx";

createRoot(document.getElementById("root")).render(
  <Provider background="base">
    <Shell />
  </Provider>,
);
