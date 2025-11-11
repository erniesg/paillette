import * as React from 'react';
import { cn } from '~/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'destructive';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold transition-colors',
        {
          'bg-primary-500/20 text-primary-300 border border-primary-500/30':
            variant === 'default',
          'bg-neutral-700 text-neutral-300': variant === 'secondary',
          'bg-green-500/20 text-green-300 border border-green-500/30':
            variant === 'success',
          'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30':
            variant === 'warning',
          'bg-red-500/20 text-red-300 border border-red-500/30':
            variant === 'destructive',
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
