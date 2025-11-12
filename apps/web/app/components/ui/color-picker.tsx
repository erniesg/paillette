import { useState, useEffect } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { Card, CardContent } from './card';

export interface ColorPickerProps {
  value?: string[];
  onChange: (colors: string[]) => void;
  maxColors?: number;
  className?: string;
}

export function ColorPicker({
  value = [],
  onChange,
  maxColors = 5,
  className = '',
}: ColorPickerProps) {
  const [selectedColors, setSelectedColors] = useState<string[]>(value);
  const [customColor, setCustomColor] = useState('#000000');

  // Common color palette
  const commonColors = [
    // Reds
    '#FF0000', '#DC143C', '#8B0000', '#CD5C5C', '#FFC0CB',
    // Oranges
    '#FFA500', '#FF8C00', '#FF4500', '#FF6347', '#FFD700',
    // Yellows
    '#FFFF00', '#FFFFE0', '#F0E68C', '#BDB76B', '#EEE8AA',
    // Greens
    '#00FF00', '#32CD32', '#228B22', '#006400', '#7CFC00',
    // Blues
    '#0000FF', '#4169E1', '#1E90FF', '#87CEEB', '#00BFFF',
    // Purples
    '#800080', '#9370DB', '#8A2BE2', '#9400D3', '#DDA0DD',
    // Browns
    '#A52A2A', '#8B4513', '#D2691E', '#CD853F', '#F4A460',
    // Grays
    '#000000', '#808080', '#C0C0C0', '#FFFFFF', '#D3D3D3',
  ];

  useEffect(() => {
    setSelectedColors(value);
  }, [value]);

  const handleColorClick = (color: string) => {
    let newColors: string[];

    if (selectedColors.includes(color)) {
      // Remove color
      newColors = selectedColors.filter((c) => c !== color);
    } else if (selectedColors.length < maxColors) {
      // Add color
      newColors = [...selectedColors, color];
    } else {
      // Replace last color
      newColors = [...selectedColors.slice(0, -1), color];
    }

    setSelectedColors(newColors);
    onChange(newColors);
  };

  const handleAddCustomColor = () => {
    if (!selectedColors.includes(customColor) && selectedColors.length < maxColors) {
      const newColors = [...selectedColors, customColor];
      setSelectedColors(newColors);
      onChange(newColors);
    }
  };

  const handleRemoveColor = (color: string) => {
    const newColors = selectedColors.filter((c) => c !== color);
    setSelectedColors(newColors);
    onChange(newColors);
  };

  const clearAll = () => {
    setSelectedColors([]);
    onChange([]);
  };

  return (
    <Card className={className}>
      <CardContent className="p-4">
        {/* Selected Colors Display */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-semibold">
              Selected Colors ({selectedColors.length}/{maxColors})
            </Label>
            {selectedColors.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-6 text-xs text-neutral-500 hover:text-white"
              >
                Clear All
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2 min-h-[40px] p-2 border border-neutral-700 rounded-lg bg-neutral-900/50">
            {selectedColors.length === 0 ? (
              <p className="text-sm text-neutral-500 m-auto">
                Select colors from the palette below
              </p>
            ) : (
              selectedColors.map((color) => (
                <div
                  key={color}
                  className="group relative flex items-center gap-1 px-2 py-1 rounded-md border border-neutral-600 bg-neutral-800 hover:border-neutral-500 transition-colors"
                >
                  <div
                    className="w-5 h-5 rounded border border-neutral-600"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-xs font-mono text-neutral-300">
                    {color}
                  </span>
                  <button
                    onClick={() => handleRemoveColor(color)}
                    className="ml-1 text-neutral-500 hover:text-red-400 transition-colors"
                    aria-label={`Remove ${color}`}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Common Color Palette */}
        <div className="mb-4">
          <Label className="text-sm font-semibold mb-2 block">
            Common Colors
          </Label>
          <div className="grid grid-cols-10 gap-2">
            {commonColors.map((color) => (
              <button
                key={color}
                onClick={() => handleColorClick(color)}
                className={`w-8 h-8 rounded border-2 transition-all duration-200 ${
                  selectedColors.includes(color)
                    ? 'border-primary-500 ring-2 ring-primary-500/50 scale-110'
                    : 'border-neutral-600 hover:border-neutral-400 hover:scale-105'
                }`}
                style={{ backgroundColor: color }}
                title={color}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
        </div>

        {/* Custom Color Input */}
        <div>
          <Label htmlFor="custom-color" className="text-sm font-semibold mb-2 block">
            Custom Color
          </Label>
          <div className="flex gap-2">
            <Input
              id="custom-color"
              type="color"
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value)}
              className="w-16 h-10 p-1 cursor-pointer"
            />
            <Input
              type="text"
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value)}
              placeholder="#000000"
              pattern="^#[0-9A-Fa-f]{6}$"
              className="flex-1 font-mono"
            />
            <Button
              onClick={handleAddCustomColor}
              disabled={
                selectedColors.includes(customColor) ||
                selectedColors.length >= maxColors
              }
              size="sm"
            >
              Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
