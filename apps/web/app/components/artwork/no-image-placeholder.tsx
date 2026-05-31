import { ImageOff } from 'lucide-react';
import { cn } from '~/lib/utils';

type NoImagePlaceholderProps = {
  className?: string;
  iconClassName?: string;
  showLabel?: boolean;
};

export function NoImagePlaceholder({
  className,
  iconClassName,
  showLabel = false,
}: NoImagePlaceholderProps) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-2 bg-white/[0.03] text-white/25',
        className
      )}
    >
      <ImageOff
        className={cn('h-5 w-5', iconClassName)}
        aria-hidden="true"
      />
      {showLabel ? (
        <span className="text-xs text-current">No image</span>
      ) : (
        <span className="sr-only">No image</span>
      )}
    </div>
  );
}
