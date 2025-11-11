import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { motion } from 'framer-motion';
import type { ArtworkSearchResult } from '~/types';
import { formatSimilarity, formatDimensions, cn } from '~/lib/utils';
import { Badge } from '~/components/ui/badge';
import { Input } from '~/components/ui/input';
import { ArtworkDialog } from './artwork-dialog';

interface SearchResultsProps {
  results: ArtworkSearchResult[];
  queryTime: number;
}

export function SearchResults({ results, queryTime }: SearchResultsProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'similarity', desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [selectedArtwork, setSelectedArtwork] =
    useState<ArtworkSearchResult | null>(null);

  const columns: ColumnDef<ArtworkSearchResult>[] = [
    {
      accessorKey: 'thumbnailUrl',
      header: 'Image',
      cell: ({ row }) => (
        <div className="w-24 h-24 flex items-center justify-center">
          <img
            src={row.original.thumbnailUrl || row.original.imageUrl}
            alt={row.original.title || 'Artwork'}
            className="max-w-full max-h-full object-contain rounded-lg cursor-pointer hover:scale-105 transition-transform"
            onClick={() => setSelectedArtwork(row.original)}
          />
        </div>
      ),
      enableSorting: false,
      enableColumnFilter: false,
    },
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <div>
          <div
            className="font-medium text-white cursor-pointer hover:text-primary-400 transition-colors"
            onClick={() => setSelectedArtwork(row.original)}
          >
            {row.original.title || 'Untitled'}
          </div>
          {row.original.metadata?.medium && (
            <div className="text-sm text-neutral-500 mt-1">
              {row.original.metadata.medium}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'artist',
      header: 'Artist',
      cell: ({ row }) => (
        <span className="text-neutral-300">
          {row.original.artist || 'Unknown'}
        </span>
      ),
    },
    {
      accessorKey: 'year',
      header: 'Year',
      cell: ({ row }) => (
        <span className="text-neutral-400">{row.original.year || '—'}</span>
      ),
    },
    {
      accessorKey: 'similarity',
      header: 'Similarity',
      cell: ({ row }) => {
        const score = row.original.similarity;
        const variant =
          score >= 0.9
            ? 'success'
            : score >= 0.8
              ? 'default'
              : score >= 0.7
                ? 'warning'
                : 'secondary';
        return (
          <Badge variant={variant}>{formatSimilarity(score)}</Badge>
        );
      },
      sortingFn: 'basic',
    },
    {
      id: 'dimensions',
      header: 'Dimensions',
      accessorFn: (row) => formatDimensions(row.metadata?.dimensions),
      cell: ({ row }) => (
        <span className="text-sm text-neutral-500">
          {formatDimensions(row.original.metadata?.dimensions)}
        </span>
      ),
      enableColumnFilter: false,
    },
  ];

  const table = useReactTable({
    data: results,
    columns,
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-6">
      {/* Results Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-display font-bold text-white">
            Search Results
          </h2>
          <p className="text-sm text-neutral-400 mt-1">
            Found {results.length} artworks in {queryTime.toFixed(0)}ms
          </p>
        </div>

        {/* Global Filter */}
        <div className="w-64">
          <Input
            placeholder="Filter results..."
            value={(table.getColumn('title')?.getFilterValue() as string) ?? ''}
            onChange={(e) =>
              table.getColumn('title')?.setFilterValue(e.target.value)
            }
            className="h-10"
          />
        </div>
      </div>

      {/* Results Table */}
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 backdrop-blur-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-neutral-800/50 border-b border-neutral-700">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        'px-6 py-4 text-left text-sm font-semibold text-neutral-300',
                        header.column.getCanSort() &&
                          'cursor-pointer select-none hover:text-white'
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-2">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {header.column.getIsSorted() && (
                          <span>
                            {header.column.getIsSorted() === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {table.getRowModel().rows.map((row, index) => (
                <motion.tr
                  key={row.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="hover:bg-neutral-800/50 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-6 py-4">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Empty State */}
        {table.getRowModel().rows.length === 0 && (
          <div className="text-center py-12 text-neutral-500">
            No results match your filters
          </div>
        )}
      </div>

      {/* Artwork Detail Dialog */}
      {selectedArtwork && (
        <ArtworkDialog
          artwork={selectedArtwork}
          open={!!selectedArtwork}
          onClose={() => setSelectedArtwork(null)}
        />
      )}
    </div>
  );
}
