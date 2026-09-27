/*
 * What a merchant chooses, and nothing else, the way Commerce's configuration pages show it:
 * a scope at the top, the settings in short groups, each labelled with the scope it can be
 * set at, and on a website "Use Default" to go back to Default Config's value. At a website
 * only the website's settings are offered; the integration-wide ones live at Default Config
 * (settings-view.js, SETTING_GROUPS).
 */
import {
  Button,
  Heading,
  InlineAlert,
  ProgressCircle,
  Text,
} from "@react-spectrum/s2";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ScopeSwitcher } from "#web/components/scope-switcher.jsx";
import { SettingField } from "#web/components/setting-field.jsx";
import {
  dressField,
  groupsAt,
  pendingChanges,
  websiteChoices,
} from "#web/settings-view.js";

/**
 * A group's fields as its controls show them: what loaded, with this visit's edits on top.
 * On a website an edit decides "Use Default Value" before the save does: a value typed or
 * unticked is the website's own, a `null` (ticked) is Default Config's again.
 */
function groupFields(group, page, edits, scopeLevel) {
  const fields = new Map(
    (page.fields ?? []).map((field) => [field.name, field]),
  );
  const values = new Map(
    (page.values ?? []).map((value) => [value.name, value]),
  );
  const atWebsite = scopeLevel !== "global";
  return group.names
    .filter((name) => fields.has(name))
    .map((name) => {
      const dressed = {
        ...dressField(fields.get(name), values.get(name), scopeLevel),
        scope: group.scope,
      };
      if (!(name in edits)) {
        return dressed;
      }
      if (edits[name] === null) {
        return { ...dressed, clearable: false, inherited: atWebsite };
      }
      return {
        ...dressed,
        clearable: atWebsite,
        inherited: false,
        value: edits[name],
      };
    });
}

export function SettingsSection({ api, initialPage, onError, scopes }) {
  const [scopeId, setScopeId] = useState("");
  const [page, setPage] = useState(initialPage);
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const scopeLevel =
    websiteChoices(scopes).find((choice) => choice.id === scopeId)?.level ??
    "global";

  useEffect(() => {
    if (scopeId === "") {
      setPage(initialPage);
      return;
    }
    setPage(null);
    api
      .settings(scopeId)
      .then(setPage)
      .catch((e) => onError(`Settings could not be read: ${e.message}`));
  }, [api, initialPage, onError, scopeId]);

  const changes = pendingChanges(page?.values, edits);
  const changed = Object.keys(changes).length > 0;

  const switchScope = useCallback((next) => {
    setEdits({});
    setSaved(false);
    setScopeId(next);
  }, []);
  const onChange = useCallback((name, value) => {
    setSaved(false);
    setEdits((current) => ({ ...current, [name]: value }));
  }, []);
  const onUseDefault = useCallback((name) => {
    setSaved(false);
    setEdits((current) => ({ ...current, [name]: null }));
  }, []);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      setPage(await api.saveSettings(scopeId || undefined, changes));
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

  const groups = useMemo(
    () =>
      page
        ? groupsAt(scopeLevel).map((group) => ({
            ...group,
            fields: groupFields(group, page, edits, scopeLevel),
          }))
        : [],
    [page, edits, scopeLevel],
  );

  return (
    <section aria-labelledby="erp-settings-heading" className="erp-section">
      <div className="erp-section-head">
        <Heading id="erp-settings-heading" level={2}>
          Settings
        </Heading>
        <ScopeSwitcher
          hasUnsavedChanges={changed}
          onChange={switchScope}
          scopeId={scopeId}
          scopes={scopes}
        />
      </div>
      {page === null && (
        <ProgressCircle aria-label="Reading the settings" isIndeterminate />
      )}
      {groups.map((group) => (
        <fieldset className="erp-group" key={group.legend}>
          <legend>{group.legend}</legend>
          {group.fields.map((field) => (
            <SettingField
              field={field}
              key={field.name}
              onChange={onChange}
              onUseDefault={onUseDefault}
            />
          ))}
        </fieldset>
      ))}
      {scopeLevel !== "global" && page !== null && (
        <Text>
          Which products this ERP owns and its order-number prefix are set for
          the whole integration, at Default Config.
        </Text>
      )}
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
      </div>
      {saved && !changed && (
        <InlineAlert variant="positive">
          <Heading>Saved</Heading>
          <Text>The integration uses these from its next order or cart.</Text>
        </InlineAlert>
      )}
    </section>
  );
}
