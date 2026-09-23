import {
  Button,
  Divider,
  Heading,
  InlineAlert,
  Switch,
  Text,
} from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { pendingChanges, settingSections } from "#web/settings-view.js";

/** One setting: the switch, what it does, and — on a narrower scope — where it comes from. */
function SettingField({ field, onChange, onUseDefault }) {
  const change = useCallback(
    (value) => onChange(field.name, value),
    [field.name, onChange],
  );
  const useDefault = useCallback(
    () => onUseDefault(field.name),
    [field.name, onUseDefault],
  );
  return (
    <div className="erp-setting">
      <Switch isSelected={field.value} onChange={change}>
        {field.label}
      </Switch>
      <span className="erp-setting-description">{field.description}</span>
      {field.inherited && <span className="erp-setting-origin">Inherited</span>}
      {field.clearable && (
        <Button onPress={useDefault} variant="secondary">
          Use Default
        </Button>
      )}
    </div>
  );
}

/**
 * The merchant's settings for this integration, at the scope they picked: what is sent to
 * the ERP, and what Commerce does with the ERP's answers. Values are kept per scope and
 * inherited like Stores ▸ Configuration, so a website can differ from the default and a
 * store view from its website (erp/settings).
 *
 * Save sends only what changed; Use Default sends `null`, which removes this scope's
 * override so the wider scope decides again.
 */
export function SettingsForm({ api, onError, scopeId, scopeLevel }) {
  const [page, setPage] = useState(null);
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

  const onChange = useCallback((name, value) => {
    setSaved(false);
    setEdits((current) => ({ ...current, [name]: value }));
  }, []);

  const onUseDefault = useCallback((name) => {
    setSaved(false);
    setEdits((current) => ({ ...current, [name]: null }));
  }, []);

  // What the page shows is what was loaded, with this visit's edits on top. A cleared
  // field shows the value it will fall back to only after the save answers.
  const shown = useMemo(() => {
    const values = (page?.values ?? []).map((value) =>
      value.name in edits && edits[value.name] !== null
        ? { ...value, value: edits[value.name] }
        : value,
    );
    return settingSections(page?.fields ?? [], values, { scopeLevel });
  }, [page, edits, scopeLevel]);

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
    <section className="erp-settings">
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
      {shown.map((section) => (
        <div className="erp-settings-section" key={section.title}>
          <Heading level={3}>{section.title}</Heading>
          <Divider />
          {section.fields.map((field) => (
            <SettingField
              field={field}
              key={field.name}
              onChange={onChange}
              onUseDefault={onUseDefault}
            />
          ))}
        </div>
      ))}
    </section>
  );
}
