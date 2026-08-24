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
  showLabel = true,
}: NoImagePlaceholderProps) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-1.5 bg-white/[0.025] text-white/20',
        className
      )}
    >
      <ImageOff
        className={cn('h-4 w-4', iconClassName)}
        aria-hidden="true"
      />
      {showLabel ? (
        <span className="text-[11px] text-current">No image</span>
      ) : (
        <span className="sr-only">No image</span>
      )}
    </div>
  );
}
