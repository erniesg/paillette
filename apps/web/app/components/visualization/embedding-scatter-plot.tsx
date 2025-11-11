/**
 * Interactive scatter plot for embedding visualization
 * Shows artworks in 2D reduced embedding space
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Point2D } from '~/lib/dimensionality-reduction';
import { reduceTo2D } from '~/lib/dimensionality-reduction';

export interface ArtworkPoint {
  id: string;
  title: string;
  artist: string | null;
  year: number | null;
  medium: string | null;
  imageUrl: string;
  thumbnailUrl: string;
  embedding: number[];
}

interface EmbeddingScatterPlotProps {
  artworks: ArtworkPoint[];
  width?: number;
  height?: number;
  colorBy?: 'artist' | 'year' | 'medium' | null;
  selectedArtwork?: string | null;
  onArtworkClick?: (artworkId: string) => void;
}

export function EmbeddingScatterPlot({
  artworks,
  width = 800,
  height = 600,
  colorBy = null,
  selectedArtwork = null,
  onArtworkClick,
}: EmbeddingScatterPlotProps) {
  const [hoveredArtwork, setHoveredArtwork] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  // Reduce embeddings to 2D
  const points = useMemo(() => {
    if (artworks.length === 0) return [];

    const embeddings = artworks.map((a) => a.embedding);
    const reduced = reduceTo2D(embeddings);

    return artworks.map((artwork, i) => ({
      ...artwork,
      x: reduced[i].x,
      y: reduced[i].y,
    }));
  }, [artworks]);

  // Color mapping
  const colorMap = useMemo(() => {
    if (!colorBy) return new Map<string, string>();

    const uniqueValues = new Set(
      points.map((p) => {
        if (colorBy === 'artist') return p.artist || 'Unknown';
        if (colorBy === 'year')
          return p.year ? Math.floor(p.year / 50) * 50 : 'Unknown';
        if (colorBy === 'medium') return p.medium || 'Unknown';
        return 'Unknown';
      })
    );

    const colors = generateColors(uniqueValues.size);
    const map = new Map<string, string>();
    Array.from(uniqueValues).forEach((value, i) => {
      map.set(String(value), colors[i]);
    });

    return map;
  }, [points, colorBy]);

  const getPointColor = (point: typeof points[0]): string => {
    if (!colorBy) return 'rgb(59, 130, 246)'; // Primary blue

    let key: string;
    if (colorBy === 'artist') {
      key = point.artist || 'Unknown';
    } else if (colorBy === 'year') {
      key = point.year ? String(Math.floor(point.year / 50) * 50) : 'Unknown';
    } else {
      key = point.medium || 'Unknown';
    }

    return colorMap.get(key) || 'rgb(156, 163, 175)'; // Gray fallback
  };

  // Handle zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prev) => Math.min(Math.max(prev * delta, 0.5), 5));
  };

  // Handle pan (drag)
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const margin = 40;
  const plotWidth = width - 2 * margin;
  const plotHeight = height - 2 * margin;

  const hovered = points.find((p) => p.id === hoveredArtwork);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        className="border border-neutral-700 rounded-lg bg-neutral-900 cursor-move"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${margin + pan.x}, ${margin + pan.y}) scale(${zoom})`}>
          {/* Grid lines */}
          <g opacity="0.1">
            {[0, 0.25, 0.5, 0.75, 1].map((i) => (
              <line
                key={`v-${i}`}
                x1={i * plotWidth}
                y1={0}
                x2={i * plotWidth}
                y2={plotHeight}
                stroke="white"
                strokeWidth={1}
              />
            ))}
            {[0, 0.25, 0.5, 0.75, 1].map((i) => (
              <line
                key={`h-${i}`}
                x1={0}
                y1={i * plotHeight}
                x2={plotWidth}
                y2={i * plotHeight}
                stroke="white"
                strokeWidth={1}
              />
            ))}
          </g>

          {/* Data points */}
          {points.map((point) => {
            const cx = point.x * plotWidth;
            const cy = (1 - point.y) * plotHeight; // Invert Y axis
            const isHovered = point.id === hoveredArtwork;
            const isSelected = point.id === selectedArtwork;

            return (
              <circle
                key={point.id}
                cx={cx}
                cy={cy}
                r={isHovered || isSelected ? 8 : 5}
                fill={getPointColor(point)}
                opacity={isHovered || isSelected ? 1 : 0.7}
                stroke={isSelected ? 'white' : 'none'}
                strokeWidth={2}
                className="transition-all cursor-pointer hover:opacity-100"
                onMouseEnter={() => setHoveredArtwork(point.id)}
                onMouseLeave={() => setHoveredArtwork(null)}
                onClick={() => onArtworkClick?.(point.id)}
              />
            );
          })}
        </g>
      </svg>

      {/* Hover tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute top-4 right-4 bg-neutral-800 border border-neutral-700 rounded-lg p-4 shadow-xl max-w-sm pointer-events-none"
          >
            <div className="flex gap-4">
              <img
                src={hovered.thumbnailUrl}
                alt={hovered.title}
                className="w-24 h-24 object-cover rounded"
              />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white truncate">
                  {hovered.title}
                </h3>
                {hovered.artist && (
                  <p className="text-sm text-neutral-400 truncate">
                    {hovered.artist}
                  </p>
                )}
                <div className="flex gap-2 mt-2 text-xs text-neutral-500">
                  {hovered.year && <span>{hovered.year}</span>}
                  {hovered.medium && (
                    <span className="truncate">{hovered.medium}</span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      {colorBy && colorMap.size > 0 && (
        <div className="absolute bottom-4 left-4 bg-neutral-800 border border-neutral-700 rounded-lg p-3 max-h-48 overflow-y-auto">
          <div className="text-xs font-semibold text-neutral-400 mb-2 uppercase">
            {colorBy === 'artist' && 'Artists'}
            {colorBy === 'year' && 'Periods'}
            {colorBy === 'medium' && 'Mediums'}
          </div>
          <div className="space-y-1">
            {Array.from(colorMap.entries()).map(([value, color]) => (
              <div key={value} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs text-neutral-300 truncate">
                  {value}
                  {colorBy === 'year' && value !== 'Unknown' && 's'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute top-4 left-4 bg-neutral-800 border border-neutral-700 rounded-lg p-2 space-y-1">
        <button
          onClick={() => setZoom((z) => Math.min(z * 1.2, 5))}
          className="block w-full px-3 py-1 text-sm text-white hover:bg-neutral-700 rounded transition-colors"
        >
          + Zoom In
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z * 0.8, 0.5))}
          className="block w-full px-3 py-1 text-sm text-white hover:bg-neutral-700 rounded transition-colors"
        >
          - Zoom Out
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="block w-full px-3 py-1 text-sm text-white hover:bg-neutral-700 rounded transition-colors"
        >
          ⟲ Reset
        </button>
      </div>

      {/* Info */}
      <div className="mt-4 text-sm text-neutral-400">
        <p>
          Showing {points.length} artworks in 2D embedding space. Drag to pan,
          scroll to zoom.
        </p>
      </div>
    </div>
  );
}

/**
 * Generate distinct colors for categories
 */
function generateColors(count: number): string[] {
  const colors: string[] = [];
  const goldenRatio = 0.618033988749895;
  let hue = Math.random();

  for (let i = 0; i < count; i++) {
    hue += goldenRatio;
    hue %= 1;
    const saturation = 0.6 + Math.random() * 0.2;
    const lightness = 0.5 + Math.random() * 0.1;
    colors.push(`hsl(${hue * 360}, ${saturation * 100}%, ${lightness * 100}%)`);
  }

  return colors;
}
