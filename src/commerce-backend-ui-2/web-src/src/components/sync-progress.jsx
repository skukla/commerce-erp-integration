import { Heading, InlineAlert, ProgressBar, Text } from "@react-spectrum/s2";

const PHASE_TEXT = {
  partners: "Importing business partners…",
  products: "Importing products…",
  reading: "Reading products and companies from Commerce…",
};

/** A sync the ERP is still working through. */
export function isSyncActive(sync) {
  return sync?.state === "requested" || sync?.state === "running";
}

function headline(sync, erpName) {
  if (sync.state === "requested") {
    return "Starting the sync…";
  }
  if (sync.state === "running") {
    return PHASE_TEXT[sync.phase] ?? "Syncing records…";
  }
  const products = sync.products?.total ?? 0;
  const partners = sync.partners?.total ?? 0;
  return `Synced ${products} products and ${partners} business partners to ${erpName}.`;
}

function Bar({ label, value }) {
  if (!value) {
    return null;
  }
  return (
    <ProgressBar
      label={label}
      maxValue={Math.max(value.total, 1)}
      value={value.done}
      valueLabel={`${value.done} of ${value.total}`}
    />
  );
}

/** The ERP's sync record: what is running, how far along, and how it ended. */
export function SyncProgress({ sync, erpName }) {
  if (!sync) {
    return null;
  }
  if (sync.state === "failed") {
    return (
      <InlineAlert variant="negative">
        <Heading>The sync did not finish</Heading>
        <Text>{sync.error}</Text>
      </InlineAlert>
    );
  }
  return (
    <div className="erp-sync">
      <Text>{headline(sync, erpName)}</Text>
      {isSyncActive(sync) && !sync.partners && (
        <ProgressBar aria-label="Syncing" isIndeterminate />
      )}
      <Bar label="Business partners" value={sync.partners} />
      <Bar label="Products" value={sync.products} />
    </div>
  );
}
