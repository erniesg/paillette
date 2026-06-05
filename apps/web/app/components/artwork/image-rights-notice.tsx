import type { MouseEventHandler } from 'react';
import { ExternalLink, ShieldAlert } from 'lucide-react';

export const NGS_IMAGE_REQUEST_URL =
  'https://www.nationalgallery.sg/sg/en/our-collections/search-collection/make-a-request.html';

type RequestImageUseLinkProps = {
  className?: string;
  compact?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export function RequestImageUseLink({
  className = '',
  compact = false,
  onClick,
}: RequestImageUseLinkProps) {
  return (
    <a
      href={NGS_IMAGE_REQUEST_URL}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
      className={`inline-flex max-w-full items-center gap-2 rounded-md border border-cyan-200/15 bg-cyan-200/[0.06] font-medium text-cyan-100/80 transition-colors hover:bg-cyan-200/[0.1] hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60 ${
        compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'
      } ${className}`}
    >
      <span className="truncate">Request image use</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

type ImageReuseNoticeProps = {
  className?: string;
  compact?: boolean;
};

export function ImageReuseNotice({
  className = '',
  compact = false,
}: ImageReuseNoticeProps) {
  return (
    <div
      className={`flex gap-3 rounded-md border border-white/[0.08] bg-black/25 text-white/65 ${
        compact ? 'p-3 text-xs' : 'p-4 text-sm'
      } ${className}`}
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-cyan-100/70" />
      <div className="min-w-0">
        <p className="leading-relaxed">
          Image preview for discovery only. Please request permission from
          National Gallery Singapore before reuse, download, publication, or
          reproduction.
        </p>
      </div>
    </div>
  );
}
