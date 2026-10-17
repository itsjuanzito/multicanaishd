import { atom } from 'nanostores';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
    id: string;
    message: string;
    type: ToastType;
}

export const toastStore = atom<ToastMessage | null>(null);

export function showToast(message: string, type: ToastType = 'success') {
    const id = Math.random().toString(36).substring(2, 9);
    toastStore.set({ id, message, type });
}
