import { Link } from '@remix-run/react';
import { type HTMLAttributes } from 'react';
import { cn } from '~/lib/utils';

interface LogoProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Size variant of the logo
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Whether to render the compact V0 frame behind "ai".
   */
  framed?: boolean;
  /**
   * Whether to render as a link to home
   */
  linkToHome?: boolean;
}

const sizeClasses = {
  sm: 'text-xl',
  md: 'text-2xl',
  lg: 'text-4xl',
  xl: 'text-6xl lg:text-8xl',
};

/**
 * Paillette Logo Component
 * Consistent branding across the application with gradient "ai"
 */
export function Logo({
  size = 'md',
  framed = true,
  linkToHome = false,
  className,
  ...props
}: LogoProps) {
  const logoElement = (
    <div
      className={cn(
        'font-display font-bold inline-block tracking-tight',
        sizeClasses[size],
        className
      )}
      {...props}
    >
      <span className="text-white">P</span>
      <span
        className={cn(
          'relative isolate inline-block',
          framed && 'ml-[0.07em] mr-[0.04em] px-[0.04em]'
        )}
      >
        {framed && (
          <span
            aria-hidden="true"
            className="absolute bottom-[-0.24em] left-[-0.02em] right-[-0.02em] top-[-0.34em] z-0 bg-[#07070a] shadow-[0_0_24px_rgba(168,85,247,0.32)]"
          />
        )}
        <span
          className={cn(
            'relative z-10 bg-gradient-accent bg-clip-text text-transparent',
            framed && 'drop-shadow-[0_0_9px_rgba(217,70,239,0.36)]'
          )}
        >
          ai
        </span>
      </span>
      <span className="text-white">llette</span>
    </div>
  );

  if (linkToHome) {
    return (
      <Link
        to="/"
        className="inline-block transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50 focus-visible:ring-offset-4 focus-visible:ring-offset-[#08080b]"
      >
        {logoElement}
      </Link>
    );
  }

  return logoElement;
}
