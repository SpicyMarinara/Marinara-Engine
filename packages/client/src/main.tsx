import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { startKeepAlive } from "./lib/keep-alive";
import { installCsrfFetchShim } from "./lib/csrf-fetch";
import "./styles/globals.css";

// Prevent Chrome/Edge from sleeping this tab
startKeepAlive();
installCsrfFetchShim();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true);
  },
  onRegisteredSW(_swUrl: string, registration?: ServiceWorkerRegistration) {
    if (!registration) {
      return;
    }

    window.setInterval(() => {
      void registration.update();
    }, 60_000);
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
