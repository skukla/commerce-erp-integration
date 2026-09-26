/*
 * What crossed between the systems, newest first, with Retry on what did not get through.
 * The order trace opens from Commerce's own order page ("Follow in Northwind") rather than
 * living here.
 */
import {
  ActionButton,
  Cell,
  Column,
  Heading,
  Row,
  SegmentedControl,
  SegmentedControlItem,
  StatusLight,
  TableBody,
  TableHeader,
  TableView,
} from "@react-spectrum/s2";
import { useState } from "react";

import { ACTIVITY, ERP } from "./data.js";

const RESULT = {
  applied: { label: "Applied", variant: "positive" },
  failed: { label: "Not sent", variant: "negative" },
  sent: { label: "Sent", variant: "positive" },
};

const WAY = { "from-erp": `← from ${ERP.name}`, "to-erp": `→ to ${ERP.name}` };

export function ActivityView() {
  const [show, setShow] = useState("all");
  const rows = ACTIVITY.filter((a) => show === "all" || a.result === "failed");
  return (
    <section aria-labelledby="nx-activity" className="nx-section">
      <div className="nx-section-head">
        <Heading id="nx-activity" level={2}>
          Activity
        </Heading>
        <SegmentedControl
          aria-label="Show"
          onSelectionChange={setShow}
          selectedKey={show}>
          <SegmentedControlItem id="all">Everything</SegmentedControlItem>
          <SegmentedControlItem id="problems">
            Problems only
          </SegmentedControlItem>
        </SegmentedControl>
      </div>
      <TableView aria-label="Activity" UNSAFE_className="nx-table">
        <TableHeader>
          <Column defaultWidth={80}>When</Column>
          <Column defaultWidth={220} isRowHeader>
            What
          </Column>
          <Column>Direction</Column>
          <Column>Result</Column>
          <Column>Detail</Column>
          <Column> </Column>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <Row id={a.id} key={a.id}>
              <Cell>{a.when}</Cell>
              <Cell>{a.what}</Cell>
              <Cell>{WAY[a.direction]}</Cell>
              <Cell>
                <StatusLight variant={RESULT[a.result].variant}>
                  {RESULT[a.result].label}
                </StatusLight>
              </Cell>
              <Cell>{a.detail}</Cell>
              <Cell>
                {a.result === "failed" ? (
                  <ActionButton isQuiet>Retry</ActionButton>
                ) : null}
              </Cell>
            </Row>
          ))}
        </TableBody>
      </TableView>
    </section>
  );
}
