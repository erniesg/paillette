import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '~/lib/utils';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = 'default', size = 'default', asChild = false, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-gradient-accent text-white hover:opacity-90 hover:shadow-lg hover:shadow-primary-500/30':
              variant === 'default',
            'border-2 border-primary-500/50 bg-transparent text-primary-300 hover:border-primary-400 hover:bg-primary-500/10':
              variant === 'outline',
            'bg-transparent hover:bg-neutral-800 text-neutral-300':
              variant === 'ghost',
            'bg-red-600 text-white hover:bg-red-700':
              variant === 'destructive',
          },
          {
            'h-10 px-6 py-2': size === 'default',
            'h-8 px-4 text-sm': size === 'sm',
            'h-12 px-8 text-lg': size === 'lg',
            'h-10 w-10': size === 'icon',
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
