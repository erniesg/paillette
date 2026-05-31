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
};

export function ImageWithFallback({
  src,
  fallbackSrc,
  fallback,
  onError,
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
      onError={(event) => {
        setFailedSources((current) =>
          current.includes(activeSrc) ? current : [...current, activeSrc]
        );
        onError?.(event);
      }}
    />
  );
}
