import { useState } from 'react';

type DiagramNodeProps = {
  id: string;
  x: number;
  y: number;
  width: number;
  label: string;
  badge: string;
  tone: string;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
};

function DiagramNode({
  id,
  x,
  y,
  width,
  label,
  badge,
  tone,
  active,
  onActivate,
  onDeactivate,
}: DiagramNodeProps) {
  const labelWidth = width - 82;
  const shouldConstrainLabel = label.length * 7 > labelWidth;

  return (
    <g
      data-testid={`architecture-node-${id}`}
      className={`architecture-node${active ? ' architecture-node-active' : ''}`}
      tabIndex={0}
      aria-label={`${label} component`}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height="80"
        rx="10"
        fill="#10131d"
        stroke={tone}
        strokeWidth="2"
        className="architecture-node-shell"
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
        className="architecture-node-badge"
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
    </g>
  );
}

function BoundaryLabel({
  x,
  y,
  label,
  tone,
}: {
  x: number;
  y: number;
  label: string;
  tone: string;
}) {
  return (
    <g className="architecture-boundary-label">
      <rect
        x={x + 12}
        y={y + 10}
        width={label.length * 8.2 + 14}
        height="25"
        rx="4"
        fill="#080a0f"
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

function FlowLabel({
  x,
  y,
  active,
  children,
}: {
  x: number;
  y: number;
  active: boolean;
  children: string;
}) {
  return (
    <g
      data-testid="architecture-connection-label"
      className={active ? 'architecture-connection-label-active' : undefined}
      pointerEvents="none"
    >
      <rect
        data-testid="architecture-connection-label-bg"
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
  active,
  onActivate,
  onDeactivate,
}: {
  paths: string[];
  label: string;
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
}) {
  return (
    <g
      data-testid="architecture-connection"
      className={`architecture-connection group${active ? ' architecture-connection-active' : ''}`}
      tabIndex={0}
      aria-label={`${label} connection`}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
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
    </g>
  );
}

type ArchitectureConnection = {
  paths: string[];
  label: string;
  labelX: number;
  labelY: number;
  nodeIds: string[];
};

const CONNECTIONS: ArchitectureConnection[] = [
  {
    paths: ['M 222 340 H 310'],
    label: 'HTTPS search',
    labelX: 266,
    labelY: 329,
    nodeIds: ['visitor-browser', 'remix-web-worker'],
  },
  {
    paths: ['M 510 340 C 530 340 536 310 565 310'],
    label: 'POST /search',
    labelX: 520,
    labelY: 286,
    nodeIds: ['remix-web-worker', 'auth-quota'],
  },
  {
    paths: ['M 660 350 V 390'],
    label: 'validate + reserve',
    labelX: 660,
    labelY: 374,
    nodeIds: ['auth-quota', 'query-router'],
  },
  {
    paths: ['M 755 418 C 840 418 860 130 978 130'],
    label: 'embed query',
    labelX: 849,
    labelY: 238,
    nodeIds: ['query-router', 'jina-workers-ai'],
  },
  {
    paths: ['M 1096 170 V 250 H 984 V 304', 'M 1096 250 H 1229 V 304'],
    label: 'vector query',
    labelX: 1148,
    labelY: 242,
    nodeIds: ['jina-workers-ai', 'vectorize-image-text', 'vectorize-captions'],
  },
  {
    paths: ['M 755 438 C 820 438 812 524 878 524'],
    label: 'metadata query',
    labelX: 810,
    labelY: 466,
    nodeIds: ['query-router', 'd1-metadata-usage'],
  },
  {
    paths: [
      'M 984 384 V 436 C 984 470 810 470 760 580',
      'M 1229 384 V 438 C 1229 468 848 460 760 592',
      'M 878 524 C 818 524 818 604 760 604',
    ],
    label: 'ranked candidates',
    labelX: 920,
    labelY: 452,
    nodeIds: [
      'vectorize-image-text',
      'vectorize-captions',
      'd1-metadata-usage',
      'rrf-hydration',
    ],
  },
  {
    paths: ['M 566 590 C 520 590 490 500 480 380'],
    label: 'ranked JSON',
    labelX: 500,
    labelY: 478,
    nodeIds: ['rrf-hydration', 'remix-web-worker'],
  },
  {
    paths: ['M 190 380 V 610 C 190 654 226 680 278 680 H 1215 V 660'],
    label: 'GET artwork asset',
    labelX: 1050,
    labelY: 670,
    nodeIds: ['visitor-browser', 'artwork-assets'],
  },
  {
    paths: ['M 1245 660 V 710 H 244 C 188 710 160 660 160 610 V 380'],
    label: 'image response',
    labelX: 610,
    labelY: 707,
    nodeIds: ['visitor-browser', 'artwork-assets'],
  },
];

const BOUNDARIES = [
  {
    x: 22,
    y: 120,
    width: 224,
    height: 410,
    label: 'Client',
    tone: '#7dd3fc',
  },
  {
    x: 278,
    y: 34,
    width: 520,
    height: 684,
    label: 'Cloudflare edge',
    tone: '#c4b5fd',
  },
  {
    x: 838,
    y: 34,
    width: 520,
    height: 178,
    label: 'Model provider',
    tone: '#fbbf24',
  },
  {
    x: 838,
    y: 244,
    width: 520,
    height: 474,
    label: 'Cloudflare data',
    tone: '#6ee7b7',
  },
  {
    x: 540,
    y: 78,
    width: 240,
    height: 604,
    label: 'Hono API Worker',
    tone: '#c4b5fd',
  },
] as const;

const NODES = [
  {
    id: 'visitor-browser',
    x: 46,
    y: 300,
    width: 176,
    label: 'Visitor browser',
    badge: 'WEB',
    tone: '#7dd3fc',
  },
  {
    id: 'remix-web-worker',
    x: 310,
    y: 300,
    width: 200,
    label: 'Remix web Worker',
    badge: 'UI',
    tone: '#a78bfa',
  },
  {
    id: 'auth-quota',
    x: 565,
    y: 270,
    width: 190,
    label: 'Auth + quota',
    badge: 'KEY',
    tone: '#c4b5fd',
  },
  {
    id: 'query-router',
    x: 565,
    y: 390,
    width: 190,
    label: 'Query router',
    badge: 'API',
    tone: '#c4b5fd',
  },
  {
    id: 'rrf-hydration',
    x: 566,
    y: 550,
    width: 194,
    label: 'RRF + hydration',
    badge: 'RRF',
    tone: '#c4b5fd',
  },
  {
    id: 'jina-workers-ai',
    x: 978,
    y: 90,
    width: 236,
    label: 'Jina / Workers AI',
    badge: 'AI',
    tone: '#fbbf24',
  },
  {
    id: 'vectorize-image-text',
    x: 878,
    y: 304,
    width: 212,
    label: 'Vectorize image + text',
    badge: 'VEC',
    tone: '#6ee7b7',
  },
  {
    id: 'vectorize-captions',
    x: 1134,
    y: 304,
    width: 190,
    label: 'Vectorize captions',
    badge: 'VEC',
    tone: '#6ee7b7',
  },
  {
    id: 'd1-metadata-usage',
    x: 878,
    y: 484,
    width: 212,
    label: 'D1 metadata + usage',
    badge: 'D1',
    tone: '#6ee7b7',
  },
  {
    id: 'artwork-assets',
    x: 1134,
    y: 580,
    width: 190,
    label: 'Artwork assets',
    badge: 'R2',
    tone: '#6ee7b7',
  },
] as const;

export function SystemArchitectureDiagram(): JSX.Element {
  const [activeTarget, setActiveTarget] = useState<
    { kind: 'node' | 'connection'; id: string } | undefined
  >();

  const activeConnection =
    activeTarget?.kind === 'connection'
      ? CONNECTIONS.find((connection) => connection.label === activeTarget.id)
      : undefined;

  const isNodeActive = (nodeId: string) =>
    activeTarget?.kind === 'node'
      ? activeTarget.id === nodeId
      : (activeConnection?.nodeIds.includes(nodeId) ?? false);

  const isConnectionActive = (connection: ArchitectureConnection) =>
    activeTarget?.kind === 'connection'
      ? activeTarget.id === connection.label
      : activeTarget?.kind === 'node' &&
        connection.nodeIds.includes(activeTarget.id);

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
          <pattern
            id="architecture-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 24 0 L 0 0 0 24"
              fill="none"
              stroke="#94a3b8"
              strokeOpacity="0.055"
            />
          </pattern>
          <marker
            id="architecture-arrow"
            data-testid="architecture-arrow"
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>

        <style>{`
          .architecture-connection,
          .architecture-node { cursor: pointer; outline: none; }
          .architecture-connection-hit { pointer-events: stroke; }
          .architecture-connection-line,
          .architecture-connection-label,
          .architecture-connection-label-bg,
          .architecture-node-shell,
          .architecture-node-badge {
            transition: stroke 160ms cubic-bezier(0.16, 1, 0.3, 1), stroke-width 160ms cubic-bezier(0.16, 1, 0.3, 1), fill 160ms cubic-bezier(0.16, 1, 0.3, 1), filter 160ms cubic-bezier(0.16, 1, 0.3, 1);
          }
          .architecture-connection:hover .architecture-connection-line,
          .architecture-connection:focus .architecture-connection-line,
          .architecture-connection-active .architecture-connection-line {
            stroke: #67e8f9;
            stroke-width: 3;
            filter: drop-shadow(0 0 3px rgba(103, 232, 249, 0.36));
          }
          .architecture-connection:hover .architecture-connection-label,
          .architecture-connection:focus .architecture-connection-label,
          .architecture-connection-active .architecture-connection-label,
          .architecture-connection-label-active .architecture-connection-label { fill: #cffafe; }
          .architecture-connection:hover .architecture-connection-label-bg,
          .architecture-connection:focus .architecture-connection-label-bg,
          .architecture-connection-active .architecture-connection-label-bg,
          .architecture-connection-label-active .architecture-connection-label-bg { fill: #172033; }
          .architecture-node:hover .architecture-node-shell,
          .architecture-node:focus .architecture-node-shell,
          .architecture-node-active .architecture-node-shell {
            fill: #172033;
            stroke: #67e8f9;
            stroke-width: 3;
            filter: drop-shadow(0 0 4px rgba(103, 232, 249, 0.3));
          }
          .architecture-node:hover .architecture-node-badge,
          .architecture-node:focus .architecture-node-badge,
          .architecture-node-active .architecture-node-badge {
            fill-opacity: 0.3;
            stroke: #67e8f9;
          }
          @media (prefers-reduced-motion: reduce) {
            .architecture-connection-line,
            .architecture-connection-label,
            .architecture-connection-label-bg,
            .architecture-node-shell,
            .architecture-node-badge { transition: none; }
          }
        `}</style>

        <rect width="1400" height="760" fill="url(#architecture-grid)" />

        <g data-testid="architecture-boundary-layer">
          {BOUNDARIES.map((boundary) => (
            <Boundary key={boundary.label} {...boundary} />
          ))}
        </g>

        <g data-testid="architecture-connection-layer">
          {CONNECTIONS.map((connection) => (
            <Connection
              key={connection.label}
              {...connection}
              active={isConnectionActive(connection)}
              onActivate={() =>
                setActiveTarget({ kind: 'connection', id: connection.label })
              }
              onDeactivate={() => setActiveTarget(undefined)}
            />
          ))}
        </g>

        <g data-testid="architecture-node-layer">
          {NODES.map((node) => (
            <DiagramNode
              key={node.id}
              {...node}
              active={isNodeActive(node.id)}
              onActivate={() => setActiveTarget({ kind: 'node', id: node.id })}
              onDeactivate={() => setActiveTarget(undefined)}
            />
          ))}
        </g>

        <g data-testid="architecture-connection-label-layer">
          {CONNECTIONS.map((connection) => (
            <FlowLabel
              key={connection.label}
              x={connection.labelX}
              y={connection.labelY}
              active={isConnectionActive(connection)}
            >
              {connection.label}
            </FlowLabel>
          ))}
        </g>

        <g data-testid="architecture-boundary-label-layer">
          {BOUNDARIES.map((boundary) => (
            <BoundaryLabel key={boundary.label} {...boundary} />
          ))}
        </g>
      </svg>
    </figure>
  );
}
