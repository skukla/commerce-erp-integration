/*
 * The page's one table: Spectrum 2's TableView, dressed as a Commerce Admin grid by
 * styles/admin-skin.css (the `.adm-table` rules). Every list on the page is this table, so a
 * list is never drawn a second way (owner, 2026-10-14).
 *
 * TableView draws only the rows in view, inside a box of a set height. An Admin grid instead
 * grows with its rows and the page scrolls, so the table takes the height its rows measure to
 * (useFitHeight).
 */
/* global MutationObserver */

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
 * The height of every row, as TableView's own layout sets it on the grid's sized box (its
 * first child, an element of role "presentation"), read again whenever the layout changes it.
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
      const sized = grid.firstElementChild;
      const px = Number.parseFloat(sized?.style.height ?? "");
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
      subtree: true,
    });
    return () => watch.disconnect();
  }, []);
  return [ref, height];
}

/**
 * @param {object} props
 * @param {string} props.label what the table lists, for a screen reader
 * @param {Array<{ id: string, name: string, width?: number|string, isRowHeader?: boolean }>}
 *   props.columns
 * @param {Array<{ key: string }>} props.rows
 * @param {(row: object, columnId: string) => React.ReactNode} props.cell one cell's content
 * @param {(row: object) => void} [props.onOpen] a row's click
 * @param {React.ReactNode} [props.empty] what an empty table says
 */
export function AdminTable({ cell, columns, empty, label, onOpen, rows }) {
  const [ref, height] = useFitHeight();
  const open = onOpen
    ? (key) => {
        const row = rows.find((r) => r.key === key);
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
        UNSAFE_style={{ height }}>
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
            <Row columns={columns} id={row.key}>
              {(column) => <Cell>{cell(row, column.id)}</Cell>}
            </Row>
          )}
        </TableBody>
      </TableView>
    </div>
  );
}
