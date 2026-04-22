import { create } from "zustand";

export type AppDialogTone = "default" | "destructive";

type AppDialogCommon = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: AppDialogTone;
};

export type AlertDialogState = AppDialogCommon & {
  kind: "alert";
};

export type ConfirmDialogState = AppDialogCommon & {
  kind: "confirm";
};

export type PromptDialogState = AppDialogCommon & {
  kind: "prompt";
  defaultValue?: string;
  placeholder?: string;
};

export type AppDialogState = AlertDialogState | ConfirmDialogState | PromptDialogState;

interface DialogStoreState {
  dialog: AppDialogState | null;
  openDialog: (dialog: AppDialogState) => void;
  closeDialog: () => void;
}

export const useDialogStore = create<DialogStoreState>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
}));
