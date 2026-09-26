/*
 * This ERP's credit for each company: its account, limit, exposure, what is left and held
 * orders. Editing a limit writes it to the ERP (the ERP decides credit); the change comes back
 * as the ERP's event, updating this ERP's custom attributes on the company and the total in
 * Commerce's company credit. In the preview the edit only changes what is shown.
 */
import {
  ActionButton,
  Button,
  ButtonGroup,
  Cell,
  Column,
  Content,
  Dialog,
  DialogTrigger,
  Heading,
  NumberField,
  Row,
  StatusLight,
  TableBody,
  TableHeader,
  TableView,
  Text,
} from "@react-spectrum/s2";
import { useCallback, useState } from "react";

import { CREDIT, ERP } from "./data.js";

const money = (n) =>
  new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(n);

function EditLimit({ row, onSave }) {
  const [limit, setLimit] = useState(row.limit);
  const save = useCallback(
    () => onSave(row.account, limit),
    [onSave, row.account, limit],
  );
  const renderDialog = useCallback(
    ({ close }) => (
      <>
        <Heading slot="title">Credit limit for {row.company}</Heading>
        <Content>
          <Text>
            Saved in {ERP.name}, which decides credit. Commerce's company credit
            shows the total across ERPs and follows in a moment.
          </Text>
          <NumberField
            formatOptions={{ currency: "USD", style: "currency" }}
            label="Credit limit"
            marginTop="size-200"
            minValue={0}
            onChange={setLimit}
            value={limit}
          />
        </Content>
        <ButtonGroup>
          <Button onPress={close} variant="secondary">
            Cancel
          </Button>
          <SaveButton close={close} save={save} />
        </ButtonGroup>
      </>
    ),
    [row.company, limit, save],
  );
  return (
    <DialogTrigger>
      <ActionButton isQuiet>Edit limit</ActionButton>
      <Dialog>{renderDialog}</Dialog>
    </DialogTrigger>
  );
}

function SaveButton({ save, close }) {
  const press = useCallback(() => {
    save();
    close();
  }, [save, close]);
  return (
    <Button onPress={press} variant="accent">
      Save to {ERP.name}
    </Button>
  );
}

export function CreditView() {
  const [rows, setRows] = useState(CREDIT);
  const save = useCallback(
    (account, limit) =>
      setRows((all) =>
        all.map((r) =>
          r.account === account
            ? { ...r, available: Math.max(0, limit - r.exposure), limit }
            : r,
        ),
      ),
    [],
  );
  return (
    <section aria-labelledby="nx-credit" className="nx-section">
      <Heading id="nx-credit" level={2}>
        Credit in {ERP.name}
      </Heading>
      <Text UNSAFE_className="nx-lede">
        {`Each company's account in ${ERP.name}. Orders over a company's limit are held in ${ERP.name} and show On Hold in Commerce.`}
      </Text>
      <TableView
        aria-label={`Credit in ${ERP.name}`}
        UNSAFE_className="nx-table">
        <TableHeader>
          <Column defaultWidth={240} isRowHeader>
            Company
          </Column>
          <Column defaultWidth={100}>Account</Column>
          <Column align="end">Credit limit</Column>
          <Column align="end">Exposure</Column>
          <Column align="end">Available</Column>
          <Column>Orders</Column>
          <Column> </Column>
        </TableHeader>
        <TableBody items={rows}>
          {(r) => (
            <Row id={r.account}>
              <Cell>{r.company}</Cell>
              <Cell>{r.account}</Cell>
              <Cell align="end">{money(r.limit)}</Cell>
              <Cell align="end">{money(r.exposure)}</Cell>
              <Cell align="end">{money(r.available)}</Cell>
              <Cell>
                <StatusLight variant={r.held > 0 ? "negative" : "positive"}>
                  {r.held > 0 ? `${r.held} on hold` : "Clear"}
                </StatusLight>
              </Cell>
              <Cell>
                <EditLimit onSave={save} row={r} />
              </Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </section>
  );
}
