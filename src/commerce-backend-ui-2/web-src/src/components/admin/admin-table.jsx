/*
 * The page's one table: Spectrum 2's TableView, dressed as a Commerce Admin grid by
 * styles/admin-skin.css (the `.adm-table` rules). Every list on the page is this table, so a
 * list is never drawn a second way (owner, 2026-10-14).
 *
 * TableView draws only the rows in view, inside a box of a set height. An Admin grid instead
 * grows with its rows and the page scrolls, so the table takes the height its rows measure to
 * (useFitHeight).
 */
/* global MutationObserver, ResizeObserver, cancelAnimationFrame, document, requestAnimationFrame */

import {
  Cell,
  Column,
  Row,
  TableBody,
  TableHeader,
  TableView,
} from "@react-spectrum/s2/TableView";
import { useEffect, useRef, useState } from "react";

/** Room for the head row and the border before the rows have measured themselves. */
const FIRST_GUESS_PX = 400;
const BORDER_PX = 2;
/**
 * An empty table's height: its head row and room for what it says instead. It measured to its
 * head row alone and hid the words (seen in the parts gallery, 2026-10-14).
 */
const EMPTY_PX = 120;

/**
 * How tall the rows need the table to be: TableView's own layout height (on the grid's sized
 * box, its first child, an element of role "presentation"), or where the last row really ends
 * when that is lower. On some loads the layout's height came out 25 px short of the rows, and
 * the last row was cut off (measured over 16 loads under load, 2026-10-14).
 */
function rowsHeight(grid) {
  const sized = grid.firstElementChild;
  if (!sized) {
    return 0;
  }
  const laidOut = Number.parseFloat(sized.style.height ?? "") || 0;
  const rows = grid.querySelectorAll('[role="row"]');
  const last = [...rows].at(-1);
  const ends = last
    ? last.getBoundingClientRect().bottom - sized.getBoundingClientRect().top
    : 0;
  return Math.max(laidOut, Math.ceil(ends));
}

/**
 * The table's height, read again whenever its layout changes: a style TableView sets, rows
 * added or taken away, or the grid itself resized.
 * @returns {[React.RefObject, number]}
 */
function useFitHeight() {
  const ref = useRef(null);
  const [height, setHeight] = useState(FIRST_GUESS_PX);
  useEffect(() => {
    const grid = ref.current?.querySelector('[role="grid"]');
    if (!grid) {
      return;
    }
    const read = () => {
      const px = rowsHeight(grid);
      if (px > 0) {
        setHeight((current) =>
          Math.abs(current - (px + BORDER_PX)) < 1 ? current : px + BORDER_PX,
        );
      }
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(grid, {
      attributeFilter: ["style"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    const resized = new ResizeObserver(read);
    resized.observe(grid);
    return () => {
      watch.disconnect();
      resized.disconnect();
    };
  }, []);
  return [ref, height];
}

/**
 * TableView measures its rows when it first draws and again when its width changes, not
 * otherwise; on some loads the first measure was missed, and a one-line row kept the 44 px
 * estimate where a measured one is 32 px (found by the screen test, 2026-10-14). Drawing it
 * again did not settle it; a change of width always did. So once the page's fonts are in, and
 * whenever the rows change, the table is 1 px narrower for one frame, and measures every row.
 * @returns {boolean} whether this frame is the narrow one
 */
function useRemeasure(rowCount) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    let current = true;
    let frame = 0;
    document.fonts.ready.then(() => {
      if (!current) {
        return;
      }
      setNarrow(true);
      frame = requestAnimationFrame(() => current && setNarrow(false));
    });
    return () => {
      current = false;
      cancelAnimationFrame(frame);
    };
  }, [rowCount]);
  return narrow;
}

/**
 * A row's id in the table. Rows and columns share one collection, so a row keyed like a column
 * ("erp", the single ERP's id, is also the ERP column's) broke the table: "Cell count must match
 * column count" (the Overview's ERPs table, 2026-10-14). Row ids are kept apart by a prefix.
 */
const rowId = (key) => `row:${key}`;

export function AdminTable({ cell, columns, empty, label, onOpen, rows }) {
  const [ref, height] = useFitHeight();
  const narrow = useRemeasure(rows.length);
  const open = onOpen
    ? (id) => {
        const row = rows.find((r) => rowId(r.key) === id);
        if (row) {
          onOpen(row);
        }
      }
    : undefined;
  return (
    <div ref={ref}>
      <TableView
        aria-label={label}
        density="compact"
        onAction={open}
        overflowMode="wrap"
        UNSAFE_className="adm-table"
        UNSAFE_style={{
          height: rows.length === 0 ? Math.max(height, EMPTY_PX) : height,
          ...(narrow ? { width: "calc(100% - 1px)" } : {}),
        }}>
        <TableHeader columns={columns}>
          {(column) => (
            <Column
              id={column.id}
              isRowHeader={column.isRowHeader}
              width={column.width}>
              {column.name}
            </Column>
          )}
        </TableHeader>
        <TableBody
          items={rows}
          renderEmptyState={empty ? () => empty : undefined}>
          {(row) => (
            <Row columns={columns} id={rowId(row.key)}>
              {(column) => <Cell>{cell(row, column.id)}</Cell>}
            </Row>
          )}
        </TableBody>
      </TableView>
    </div>
  );
}
