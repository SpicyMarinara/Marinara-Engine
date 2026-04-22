type ForceRefreshSpaOptions = {
  queryParamKey?: string;
  queryParamValue?: string;
};

async function getServiceWorkerRegistrations() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return [] as ServiceWorkerRegistration[];
  }

  try {
    return await navigator.serviceWorker.getRegistrations();
  } catch {
    return [] as ServiceWorkerRegistration[];
  }
}

function replaceCurrentUrl(queryParamKey: string, queryParamValue: string) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set(queryParamKey, queryParamValue);
  window.location.replace(nextUrl.toString());
}

export async function clearBrowserRuntimeCaches() {
  if (typeof window === "undefined") {
    return;
  }

  const registrations = await getServiceWorkerRegistrations();
  await Promise.allSettled(registrations.map((registration) => registration.unregister()));

  if (!("caches" in window)) {
    return;
  }

  const cacheKeys = await caches.keys();
  await Promise.allSettled(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
}

export async function forceRefreshSpa({
  queryParamKey = "spa_refresh",
  queryParamValue = Date.now().toString(),
}: ForceRefreshSpaOptions = {}) {
  await clearBrowserRuntimeCaches();
  replaceCurrentUrl(queryParamKey, queryParamValue);
}
