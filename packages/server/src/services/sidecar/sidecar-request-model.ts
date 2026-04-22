import type { SidecarBackend } from "@marinara-engine/shared";

export const LOCAL_SIDECAR_REQUEST_MODEL = "local-sidecar";

export function resolveSidecarRequestModel(
  backend: SidecarBackend,
  configuredModelRef: string | null,
): string {
  if (backend === "mlx" && configuredModelRef) {
    return configuredModelRef;
  }

  return LOCAL_SIDECAR_REQUEST_MODEL;
}
