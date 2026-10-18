import React, { useEffect, useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiChevronUp, FiChevronDown, FiInbox } from 'react-icons/fi';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

// Small client-side table on top of the shadcn Table primitives. Columns take
// { key, title, render(row), sorter(a, b), className, width }.
const DataTable = ({ columns, data = [], rowKey = 'id', loading = false, pageSize = 10, emptyText = 'No data found.' }) => {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(null); // { key, dir: 1 | -1 }

  const sorted = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sorter) return data;
    return [...data].sort((a, b) => col.sorter(a, b) * sort.dir);
  }, [data, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const rows = sorted.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key) => {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 1 };
      if (s.dir === 1) return { key, dir: -1 };
      return null;
    });
  };

  return (
    <div className="relative">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
              <TableHead key={col.key} style={col.width ? { width: col.width } : undefined} className={col.headClassName}>
                {col.sorter ? (
                  <button type="button" onClick={() => toggleSort(col.key)} className="inline-flex cursor-pointer items-center gap-1 uppercase hover:text-foreground">
                    {col.title}
                    {sort?.key === col.key && (sort.dir === 1 ? <FiChevronUp /> : <FiChevronDown />)}
                  </button>
                ) : col.title}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="py-12 text-center text-muted-foreground">
                {loading ? (
                  <Spinner className="mx-auto size-5" />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <FiInbox className="size-8 text-slate-300" />
                    <span className="text-sm">{emptyText}</span>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ) : rows.map((row) => (
            <TableRow key={row[rowKey]}>
              {columns.map((col) => (
                <TableCell key={col.key} className={col.className}>
                  {col.render ? col.render(row) : row[col.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {loading && rows.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60">
          <Spinner className="size-5" />
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 pt-3">
          <span className="mr-2 text-xs text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button variant="outline" size="icon" className={cn('size-8')} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <FiChevronLeft />
          </Button>
          <Button variant="outline" size="icon" className="size-8" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
            <FiChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
};

export default DataTable;
