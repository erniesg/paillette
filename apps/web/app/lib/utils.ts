import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a similarity score as a percentage
 */
export function formatSimilarity(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

/**
 * Format artwork dimensions
 */
export function formatDimensions(dimensions?: {
  height?: number;
  width?: number;
  depth?: number;
  unit?: string;
}): string {
  if (!dimensions) return '';

  const parts: string[] = [];
  if (dimensions.height) parts.push(`H: ${dimensions.height}`);
  if (dimensions.width) parts.push(`W: ${dimensions.width}`);
  if (dimensions.depth) parts.push(`D: ${dimensions.depth}`);

  const unit = dimensions.unit || 'cm';
  return parts.length > 0 ? `${parts.join(' × ')} ${unit}` : '';
}

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const copyWithFallback = () => {
    if (typeof document === 'undefined') return false;

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';

    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  };

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return copyWithFallback();
  }

  return copyWithFallback();
}

export async function copyRichTextToClipboard({
  text,
  html,
}: {
  text: string;
  html: string;
}): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard?.write &&
      typeof ClipboardItem !== 'undefined'
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return true;
    }
  } catch {
    // Fall back to plain text below.
  }

  return copyToClipboard(text);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}
