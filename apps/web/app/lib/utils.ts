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
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
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
