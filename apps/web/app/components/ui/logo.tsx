import { Link } from '@remix-run/react';
import { type HTMLAttributes } from 'react';
import { cn } from '~/lib/utils';

interface LogoProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Size variant of the logo
   */
  size?: 'sm' | 'md' | 'lg' | 'xl';
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
 * Consistent branding across the application
 */
export function Logo({
  size = 'md',
  linkToHome = false,
  className,
  ...props
}: LogoProps) {
  const logoElement = (
    <div
      className={cn(
        'font-display font-bold inline-block',
        sizeClasses[size],
        className
      )}
      {...props}
    >
      <span className="text-primary-400">Paillette</span>
    </div>
  );

  if (linkToHome) {
    return (
      <Link
        to="/"
        className="hover:opacity-80 transition-opacity inline-block"
      >
        {logoElement}
      </Link>
    );
  }

  return logoElement;
}
