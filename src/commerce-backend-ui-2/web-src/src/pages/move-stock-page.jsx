/*
 * The page the product grid's "Move stock between <ERP> warehouses" opens (lib/move-stock.js):
 * the selected products, where from and where to, all of it or a quantity, and the move.
 * Commerce's own transfer raises no event, so this one tells the ERP as it moves.
 */
import {
  useHostConnection,
  useIms,
  useMassActionContext,
} from "@adobe/aio-commerce-lib-admin-ui/web";
import {
  Button,
  ButtonGroup,
  Heading,
  InlineAlert,
  NumberField,
  Picker,
  PickerItem,
  ProgressCircle,
  Radio,
  RadioGroup,
  Text,
} from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The form, once the sources are read. */
function MoveForm({ busy, onMove, productCount, sources }) {
  const [from, setFrom] = useState(sources[0]?.code ?? null);
  const [to, setTo] = useState(sources[1]?.code ?? null);
  const [amount, setAmount] = useState("all");
  const [quantity, setQuantity] = useState(1);
  const ready = from && to && from !== to;
  const submit = useCallback(
    () => onMove({ from, quantity: amount === "some" ? quantity : null, to }),
    [amount, from, onMove, quantity, to],
  );
  return (
    <div className="erp-move-form">
      <Picker label="From" onSelectionChange={setFrom} selectedKey={from}>
        {sources.map((s) => (
          <PickerItem id={s.code} key={s.code}>
            {s.name}
          </PickerItem>
        ))}
      </Picker>
      <Picker label="To" onSelectionChange={setTo} selectedKey={to}>
        {sources.map((s) => (
          <PickerItem id={s.code} key={s.code}>
            {s.name}
          </PickerItem>
        ))}
      </Picker>
      <RadioGroup label="How much" onChange={setAmount} value={amount}>
        <Radio value="all">
          All of it (the origin is taken off the product)
        </Radio>
        <Radio value="some">A quantity of each product</Radio>
      </RadioGroup>
      {amount === "some" && (
        <NumberField
          label="Quantity of each product"
          minValue={1}
          onChange={setQuantity}
          step={1}
          value={quantity}
        />
      )}
      {from && from === to && <Text>Choose two different warehouses.</Text>}
      <ButtonGroup>
        <Button
          isDisabled={!ready}
          isPending={busy}
          onPress={submit}
          variant="accent">
          Move {plural(productCount, "product", "products")}
        </Button>
      </ButtonGroup>
    </div>
  );
}

export function MoveStockPage() {
  const { data: ims, error: imsError } = useIms();
  const { data: selection, error: selectionError } = useMassActionContext();
  const { actions: host } = useHostConnection();
  const api = useMemo(() => (ims ? makeApi(ims) : null), [ims]);
  const [sources, setSources] = useState(null);
  const [erpName, setErpName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const productIds = useMemo(() => selection?.selectedIds ?? [], [selection]);
  const move = useCallback(
    async ({ from, quantity, to }) => {
      setBusy(true);
      setError(null);
      try {
        const answer = await api.moveStock({ from, productIds, quantity, to });
        setDone(answer.moved.length);
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [api, productIds],
  );
  const back = useCallback(() => host?.close(), [host]);

  useEffect(() => {
    if (!api) {
      return;
    }
    api
      .moveStockSources()
      .then((answer) => {
        setErpName(answer.erpName);
        setSources(answer.sources);
      })
      .catch((e) => setError(e.message));
  }, [api]);

  const trouble = imsError?.message ?? selectionError?.message ?? error;
  if (!(sources || trouble)) {
    return (
      <main className="erp-loading">
        <ProgressCircle aria-label="Loading" isIndeterminate />
      </main>
    );
  }
  return (
    <main>
      {/* Commerce's own header already carries the action's title. */}
      <Text>
        {plural(productIds.length, "product", "products")} selected. The move is
        made in Commerce and sent to {erpName} at once.
      </Text>
      {trouble && (
        <InlineAlert variant="negative">
          <Heading>The stock was not moved</Heading>
          <Text>{trouble}</Text>
        </InlineAlert>
      )}
      {done !== null && (
        <InlineAlert variant="positive">
          <Heading>Moved</Heading>
          <Text>
            {plural(done, "product", "products")} moved, and {erpName} has the
            new quantities.
          </Text>
        </InlineAlert>
      )}
      {sources && done === null && (
        <MoveForm
          busy={busy}
          onMove={move}
          productCount={productIds.length}
          sources={sources}
        />
      )}
      <ButtonGroup>
        <Button onPress={back} variant="secondary">
          Back to products
        </Button>
      </ButtonGroup>
    </main>
  );
}
