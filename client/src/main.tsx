import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from 'sonner';
import { HashRouter } from 'react-router-dom';

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
    <Toaster position="bottom-right" richColors={true} />
  </React.StrictMode>
);
