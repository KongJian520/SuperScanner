import React from "react";
import "./lib/i18n";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from 'sonner';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';

type BootController = {
  setProgress: (value: number) => void;
  done: () => void;
};

const boot = (window as Window & { __SS_BOOT__?: BootController }).__SS_BOOT__;
boot?.setProgress(56);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

boot?.setProgress(72);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
        <Toaster position="bottom-right" richColors={true} />
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
