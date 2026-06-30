import {
  useEffect,
  useState,
  type ImgHTMLAttributes,
  type ReactNode,
} from 'react';

type ImageWithFallbackProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src'
> & {
  src?: string | null;
  fallbackSrc?: string | null;
  fallback: ReactNode;
  protectFromDownload?: boolean;
};

export function ImageWithFallback({
  src,
  fallbackSrc,
  fallback,
  protectFromDownload = false,
  onError,
  onContextMenu,
  onDragStart,
  draggable,
  style,
  ...imageProps
}: ImageWithFallbackProps) {
  const [failedSources, setFailedSources] = useState<string[]>([]);

  useEffect(() => {
    setFailedSources([]);
  }, [fallbackSrc, src]);

  const sources = [src, fallbackSrc].filter(
    (source, index, list): source is string =>
      Boolean(source) && list.indexOf(source) === index
  );
  const activeSrc = sources.find((source) => !failedSources.includes(source));

  if (!activeSrc) {
    return <>{fallback}</>;
  }

  return (
    <img
      {...imageProps}
      src={activeSrc}
      draggable={protectFromDownload ? false : draggable}
      style={
        protectFromDownload
          ? { ...style, userSelect: 'none' }
          : style
      }
      onContextMenu={(event) => {
        if (protectFromDownload) {
          event.preventDefault();
        }
        onContextMenu?.(event);
      }}
      onDragStart={(event) => {
        if (protectFromDownload) {
          event.preventDefault();
        }
        onDragStart?.(event);
      }}
      onError={(event) => {
        setFailedSources((current) =>
          current.includes(activeSrc) ? current : [...current, activeSrc]
        );
        onError?.(event);
      }}
    />
  );
}
