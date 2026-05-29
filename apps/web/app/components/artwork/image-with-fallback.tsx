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
  fallback: ReactNode;
};

export function ImageWithFallback({
  src,
  fallback,
  onError,
  ...imageProps
}: ImageWithFallbackProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (src !== failedSrc) {
      setFailedSrc(null);
    }
  }, [failedSrc, src]);

  if (!src || failedSrc === src) {
    return <>{fallback}</>;
  }

  return (
    <img
      {...imageProps}
      src={src}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
