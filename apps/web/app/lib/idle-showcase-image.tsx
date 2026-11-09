import {
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { ImageWithFallback } from '~/components/artwork/image-with-fallback';

export const SHOWCASE_IMAGE_TIMEOUT_MS = 4000;

type Props = ComponentProps<typeof ImageWithFallback> & {
  loadingFallback?: ReactNode;
};

// Mount the real image immediately, rather than fetching a separate preload.
// Each card progresses independently; even a stalled fallback has a deadline.
export function IdleShowcaseImage({
  src,
  fallbackSrc,
  loadingFallback,
  ...props
}: Props) {
  const [failed, setFailed] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const activeSrc = [src, fallbackSrc].find(
    (source): source is string => Boolean(source) && !failed.includes(source!)
  );

  useEffect(() => {
    setFailed([]);
    setLoaded(null);
  }, [src, fallbackSrc]);

  useEffect(() => {
    if (!activeSrc || loaded === activeSrc) return;
    const timeout = window.setTimeout(() => {
      setFailed((current) => [...current, activeSrc]);
    }, SHOWCASE_IMAGE_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [activeSrc, loaded]);

  return (
    <>
      {activeSrc && loaded !== activeSrc ? loadingFallback : null}
      <ImageWithFallback
        {...props}
        key={activeSrc || 'failed'}
        src={activeSrc}
        onLoad={(event) => {
          setLoaded(activeSrc || null);
          props.onLoad?.(event);
        }}
        onError={(event) => {
          if (activeSrc) setFailed((current) => [...current, activeSrc]);
          props.onError?.(event);
        }}
      />
    </>
  );
}
