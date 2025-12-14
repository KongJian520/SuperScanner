import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from 'sonner';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
      <Toaster position="bottom-right" richColors={true} />
    </QueryClientProvider>
  </React.StrictMode>
);
