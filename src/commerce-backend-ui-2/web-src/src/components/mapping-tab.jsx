import { Button, Heading, InlineAlert, Text } from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Lookup } from "#web/components/lookup.jsx";
import { SettingField } from "#web/components/setting-field.jsx";
import { mappingCards, syncText } from "#web/mapping-view.js";
import { pendingChanges } from "#web/settings-view.js";

/** What the arrow means, for a screen reader and the title on hover. */
const OWNER_TEXT = {
  both: "both systems change it, under the rule below",
  commerce: "Commerce owns it; the ERP follows",
  erp: "the ERP owns it; Commerce follows",
};

/** One piece of the composite on each side, and the direction the truth flows. */
function MapRow({ row }) {
  return (
    <li className={`erp-map-row erp-map-row-${row.owner}`}>
      <span className="erp-map-side">{row.commerce ?? ""}</span>
      <span
        aria-label={OWNER_TEXT[row.owner]}
        className="erp-map-arrow"
        role="img"
        title={OWNER_TEXT[row.owner]}>
        {row.arrow}
      </span>
      <span className="erp-map-side">{row.erp ?? ""}</span>
      {row.rule && <span className="erp-map-rule">{row.rule}</span>}
    </li>
  );
}

/**
 * One composite entity: the two systems side by side, the join at the top with the
 * setting that makes it, the pieces as rows with the ownership arrow, the card's other
 * settings, and what has crossed for it.
 */
function MapCard({ api, card, erpName, onChange, onError, onUseDefault }) {
  return (
    <section className="erp-map-card">
      <div className="erp-map-head">
        <Heading level={3}>{card.title}</Heading>
        <span className="erp-map-systems">
          {card.systems[0]} · {card.systems[1]}
        </span>
      </div>
      <div className="erp-map-join">
        <span className="erp-map-join-text">{card.join.text}</span>
        {card.join.fields.map((field) => (
          <SettingField
            field={field}
            key={field.name}
            onChange={onChange}
            onUseDefault={onUseDefault}
          />
        ))}
      </div>
      {card.rows.length > 0 && (
        <ul className="erp-map-rows">
          <li className="erp-map-row erp-map-row-head">
            <span className="erp-map-side">Commerce</span>
            <span className="erp-map-arrow" />
            <span className="erp-map-side">{erpName}</span>
          </li>
          {card.rows.map((row) => (
            <MapRow key={`${row.commerce}|${row.erp}`} row={row} />
          ))}
        </ul>
      )}
      {card.settings.length > 0 && (
        <div className="erp-map-settings">
          {card.settings.map((field) => (
            <SettingField
              field={field}
              key={field.name}
              onChange={onChange}
              onUseDefault={onUseDefault}
            />
          ))}
        </div>
      )}
      {card.lookup && (
        <Lookup
          api={api}
          erpName={erpName}
          lookup={card.lookup}
          onError={onError}
        />
      )}
      <div className="erp-map-foot">
        {card.figures.map((figure) => (
          <span className="erp-map-figure" key={figure.label}>
            <small>{figure.label}</small> {figure.value}
          </span>
        ))}
        <span className="erp-map-sync">
          {syncText(card.sync.toErp, `To ${erpName}`)} ·{" "}
          {syncText(card.sync.fromErp, `From ${erpName}`)}
        </span>
        {card.erpHash && (
          <span className="erp-map-hash">
            In {erpName}: <code>{card.erpHash}</code>
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * The map: one card per composite entity, and the settings on the card of the entity each
 * one joins — the settings ARE the mapping (owner, 2026-09-24). Save sends only what
 * changed at the scope picked in the bar above; Use Default sends `null`, which removes
 * this scope's override so the wider scope decides again (erp/settings).
 */
export function MappingTab({
  api,
  erpName,
  onError,
  scopeId,
  scopeLevel,
  status,
}) {
  const [page, setPage] = useState(null);
  const [history, setHistory] = useState([]);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!api) {
      return;
    }
    try {
      setPage(await api.settings(scopeId));
      setEdits({});
    } catch (e) {
      onError(`Settings could not be read: ${e.message}`);
    }
  }, [api, onError, scopeId]);

  useEffect(() => {
    load();
  }, [load]);

  // What has crossed, per card. A history that cannot be read leaves the cards without
  // their sync line rather than without the map.
  useEffect(() => {
    if (!api) {
      return;
    }
    api
      .history(false)
      .then((answer) => setHistory(answer.entries ?? []))
      .catch(() => setHistory([]));
  }, [api]);

  const onChange = useCallback((name, value) => {
    setSaved(false);
    setEdits((current) => ({ ...current, [name]: value }));
  }, []);

  const onUseDefault = useCallback((name) => {
    setSaved(false);
    setEdits((current) => ({ ...current, [name]: null }));
  }, []);

  // What the cards show is what was loaded, with this visit's edits on top. A cleared
  // field shows the value it will fall back to only after the save answers.
  const cards = useMemo(() => {
    const values = (page?.values ?? []).map((value) =>
      value.name in edits && edits[value.name] !== null
        ? { ...value, value: edits[value.name] }
        : value,
    );
    return mappingCards({
      erpName,
      fields: page?.fields ?? [],
      history,
      scopeLevel,
      status,
      values,
    }).filter((card) => card.key !== "other" || card.settings.length > 0);
  }, [page, edits, history, erpName, scopeLevel, status]);

  const changes = pendingChanges(page?.values, edits);
  const changed = Object.keys(changes).length > 0;

  const save = useCallback(async () => {
    setSaving(true);
    try {
      setPage(await api.saveSettings(scopeId, changes));
      setEdits({});
      setSaved(true);
    } catch (e) {
      onError(`Settings could not be saved: ${e.message}`);
    }
    setSaving(false);
  }, [api, changes, onError, scopeId]);

  const cancel = useCallback(() => {
    setEdits({});
    setSaved(false);
  }, []);

  if (!page) {
    return <Text>Reading the settings…</Text>;
  }
  return (
    <section className="erp-map">
      <Text>
        Each card is one business concept as both systems hold it: Commerce's
        records on the left, {erpName}'s on the right, the arrow saying which
        side the truth flows from, and the setting that joins them sitting on
        the join.
      </Text>
      <div className="erp-settings-actions">
        <Button isDisabled={!changed || saving} onPress={save} variant="accent">
          {saving ? "Saving" : "Save"}
        </Button>
        <Button
          isDisabled={!changed || saving}
          onPress={cancel}
          variant="secondary">
          Cancel
        </Button>
        {saved && !changed && (
          <InlineAlert variant="positive">
            <Heading>Saved</Heading>
            <Text>The integration uses these from its next order or cart.</Text>
          </InlineAlert>
        )}
      </div>
      {cards.map((card) => (
        <MapCard
          api={api}
          card={card}
          erpName={erpName}
          key={card.key}
          onChange={onChange}
          onError={onError}
          onUseDefault={onUseDefault}
        />
      ))}
    </section>
  );
}
