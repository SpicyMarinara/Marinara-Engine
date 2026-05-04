import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

function scheduleAfterFirstLoad(callback: () => void) {
  const schedule = () => {
    const requestIdleCallback = window.requestIdleCallback;
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(callback, { timeout: 3_000 });
      return;
    }

    globalThis.setTimeout(callback, 1_000);
  };

  if (document.readyState === "complete") {
    schedule();
    return;
  }

  window.addEventListener("load", schedule, { once: true });
}

function registerServiceWorker() {
  scheduleAfterFirstLoad(() => {
    void import("virtual:pwa-register")
      .then(({ registerSW }) => {
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
      })
      .catch(() => {
        // Service worker registration is a progressive enhancement.
      });
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

registerServiceWorker();
