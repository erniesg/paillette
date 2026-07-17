type DiagramNodeProps = {
  x: number;
  y: number;
  width: number;
  label: string;
  badge: string;
  tone: string;
};

function DiagramNode({
  x,
  y,
  width,
  label,
  badge,
  tone,
}: DiagramNodeProps) {
  const labelWidth = width - 82;
  const shouldConstrainLabel = label.length * 7 > labelWidth;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height="80"
        rx="10"
        fill="#10131d"
        stroke={tone}
        strokeWidth="2"
      />
      <rect
        x={x + 14}
        y={y + 18}
        width="44"
        height="44"
        rx="8"
        fill={tone}
        fillOpacity="0.16"
        stroke={tone}
        strokeOpacity="0.7"
      />
      <text
        x={x + 36}
        y={y + 44}
        textAnchor="middle"
        fill={tone}
        fontSize="11"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontWeight="700"
      >
        {badge}
      </text>
      <text
        x={x + 68}
        y={y + 45}
        fill="#f8fafc"
        fontSize="12"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontWeight="650"
        textLength={shouldConstrainLabel ? labelWidth : undefined}
        lengthAdjust={shouldConstrainLabel ? 'spacingAndGlyphs' : undefined}
      >
        {label}
      </text>
    </g>
  );
}

function Boundary({
  x,
  y,
  width,
  height,
  label,
  tone,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  tone: string;
}) {
  return (
    <g data-testid="architecture-boundary">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="14"
        fill={tone}
        fillOpacity="0.025"
        stroke={tone}
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeDasharray="8 7"
      />
      <text
        x={x + 18}
        y={y + 28}
        fill={tone}
        fillOpacity="0.9"
        fontSize="11"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontWeight="700"
        letterSpacing="1.8"
        style={{ textTransform: 'uppercase' }}
      >
        {label}
      </text>
    </g>
  );
}

function FlowLabel({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <g>
      <rect
        x={x - children.length * 3.25 - 7}
        y={y - 12}
        width={children.length * 6.5 + 14}
        height="20"
        rx="4"
        fill="#080a0f"
        className="architecture-connection-label-bg"
      />
      <text
        x={x}
        y={y + 2}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize="10"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        className="architecture-connection-label"
      >
        {children}
      </text>
    </g>
  );
}

function Connection({
  paths,
  label,
  labelX,
  labelY,
}: {
  paths: string[];
  label: string;
  labelX: number;
  labelY: number;
}) {
  return (
    <g
      data-testid="architecture-connection"
      className="architecture-connection group"
      tabIndex={0}
      aria-label={`${label} connection`}
    >
      {paths.map((path) => (
        <path
          key={`hit-${path}`}
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth="18"
          className="architecture-connection-hit"
        />
      ))}
      {paths.map((path) => (
        <path
          key={path}
          d={path}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="1.5"
          markerEnd="url(#architecture-arrow)"
          className="architecture-connection-line"
        />
      ))}
      <FlowLabel x={labelX} y={labelY}>{label}</FlowLabel>
    </g>
  );
}

export function SystemArchitectureDiagram(): JSX.Element {
  return (
    <figure
      aria-label="Paillette system architecture"
      className="overflow-x-auto rounded-2xl border border-white/10 bg-[#080a0f]"
    >
      <svg
        data-testid="architecture-svg"
        viewBox="0 0 1400 760"
        role="img"
        aria-label="Paillette search system topology"
        className="block min-w-[960px]"
      >
        <defs>
          <pattern id="architecture-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#94a3b8" strokeOpacity="0.055" />
          </pattern>
          <marker
            id="architecture-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" />
          </marker>
        </defs>

        <style>{`
          .architecture-connection { cursor: pointer; outline: none; }
          .architecture-connection-hit { pointer-events: stroke; }
          .architecture-connection-line,
          .architecture-connection-label,
          .architecture-connection-label-bg {
            transition: stroke 160ms ease, stroke-width 160ms ease, fill 160ms ease, filter 160ms ease;
          }
          .architecture-connection:hover .architecture-connection-line,
          .architecture-connection:focus .architecture-connection-line {
            stroke: #67e8f9;
            stroke-width: 3;
            filter: drop-shadow(0 0 5px rgba(103, 232, 249, 0.45));
          }
          .architecture-connection:hover .architecture-connection-label,
          .architecture-connection:focus .architecture-connection-label { fill: #cffafe; }
          .architecture-connection:hover .architecture-connection-label-bg,
          .architecture-connection:focus .architecture-connection-label-bg { fill: #172033; }
        `}</style>

        <rect width="1400" height="760" fill="url(#architecture-grid)" />

        <Boundary x={22} y={120} width={224} height={410} label="Client" tone="#7dd3fc" />
        <Boundary x={278} y={34} width={520} height={684} label="Cloudflare edge" tone="#c4b5fd" />
        <Boundary x={838} y={34} width={520} height={178} label="Model provider" tone="#fbbf24" />
        <Boundary x={838} y={244} width={520} height={474} label="Cloudflare data" tone="#6ee7b7" />
        <Boundary x={540} y={78} width={240} height={604} label="Hono API Worker" tone="#c4b5fd" />

        <DiagramNode x={46} y={300} width={176} label="Visitor browser" badge="WEB" tone="#7dd3fc" />
        <DiagramNode x={310} y={300} width={200} label="Remix web Worker" badge="UI" tone="#a78bfa" />
        <DiagramNode x={565} y={270} width={190} label="Auth + quota" badge="KEY" tone="#c4b5fd" />
        <DiagramNode x={565} y={390} width={190} label="Query router" badge="API" tone="#c4b5fd" />
        <DiagramNode x={566} y={550} width={194} label="RRF + hydration" badge="RRF" tone="#c4b5fd" />

        <DiagramNode x={978} y={90} width={236} label="Jina / Workers AI" badge="AI" tone="#fbbf24" />
        <DiagramNode x={878} y={304} width={212} label="Vectorize image + text" badge="VEC" tone="#6ee7b7" />
        <DiagramNode x={1134} y={304} width={190} label="Vectorize captions" badge="VEC" tone="#6ee7b7" />
        <DiagramNode x={878} y={484} width={212} label="D1 metadata + usage" badge="D1" tone="#6ee7b7" />
        <DiagramNode x={1134} y={580} width={190} label="Artwork assets" badge="R2" tone="#6ee7b7" />

        <Connection paths={['M 222 340 H 310']} label="HTTPS search" labelX={266} labelY={329} />
        <Connection
          paths={['M 510 340 C 530 340 536 310 565 310']}
          label="POST /search"
          labelX={535}
          labelY={322}
        />
        <Connection
          paths={['M 660 350 V 390']}
          label="validate + reserve"
          labelX={660}
          labelY={374}
        />
        <Connection
          paths={['M 755 418 C 840 418 860 130 978 130']}
          label="embed query"
          labelX={849}
          labelY={238}
        />
        <Connection
          paths={['M 1096 170 V 250 H 984 V 304', 'M 1096 250 H 1229 V 304']}
          label="vector query"
          labelX={1148}
          labelY={242}
        />
        <Connection
          paths={['M 755 438 C 820 438 812 524 878 524']}
          label="metadata query"
          labelX={810}
          labelY={466}
        />
        <Connection
          paths={[
            'M 984 384 V 436 C 984 470 810 470 760 580',
            'M 1229 384 V 438 C 1229 468 848 460 760 592',
            'M 878 524 C 818 524 818 604 760 604',
          ]}
          label="ranked candidates"
          labelX={920}
          labelY={452}
        />
        <Connection
          paths={['M 566 590 C 530 590 534 360 510 360']}
          label="ranked JSON"
          labelX={530}
          labelY={470}
        />
        <Connection
          paths={['M 222 360 C 250 360 244 688 318 688 H 1229 V 660']}
          label="load images"
          labelX={760}
          labelY={678}
        />
      </svg>
    </figure>
  );
}
