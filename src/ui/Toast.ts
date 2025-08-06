export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

const TOAST_STYLES_ID = 'linguatube-toast-styles';

function ensureGlobalStyles(): void {
  if (document.getElementById(TOAST_STYLES_ID)) return;
  const style = document.createElement('style');
  style.id = TOAST_STYLES_ID;
  style.textContent = `
    @keyframes lt-slide-in-right { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes lt-slide-out-right { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
  `;
  document.head.appendChild(style);
}

function variantColors(variant: ToastVariant): { bg: string; fg: string } {
  switch (variant) {
    case 'success':
      return { bg: '#4CAF50', fg: '#ffffff' };
    case 'error':
      return { bg: '#f56565', fg: '#ffffff' };
    case 'warning':
      return { bg: '#f59e0b', fg: '#111827' };
    case 'info':
    default:
      return { bg: '#2563eb', fg: '#ffffff' };
  }
}

export function showToast(message: string, variant: ToastVariant = 'info', durationMs = 4000): void {
  ensureGlobalStyles();

  const { bg, fg } = variantColors(variant);
  const toast = document.createElement('div');
  toast.textContent = `[LinguaTube] ${message}`;
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bg};
    color: ${fg};
    padding: 12px 20px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 2147483647;
    max-width: 360px;
    word-wrap: break-word;
    animation: lt-slide-in-right 0.3s ease-out;
  `;

  document.body.appendChild(toast);

  window.setTimeout(() => {
    toast.style.animation = 'lt-slide-out-right 0.3s ease-in forwards';
    window.setTimeout(() => toast.parentNode && toast.parentNode.removeChild(toast), 300);
  }, Math.max(1000, durationMs));
}


