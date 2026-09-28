/*
 * What a merchant chooses, and nothing else, the way Commerce's configuration pages show it:
 * a scope at the top, the settings in short groups, each labelled with the scope it can be
 * set at, and on a website "Use Default" to go back to Default Config's value. At a website
 * only the website's settings are offered; the integration-wide ones live at Default Config
 * (settings-view.js, SETTING_GROUPS).
 *
 * With several ERPs an ERP switcher sits beside the scope (design v1 §2). "Every ERP" edits the
 * integration's configuration, which is every ERP's default; picking an ERP edits only the
 * settings that ERP sets for itself (which products it owns, its prefix, its sales
 * organisation), on its entry in the ERP list, and shows what it does not set as inherited.
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
  dressErpField,
  dressField,
  erpChoices,
  erpGroupsAt,
  erpValues,
  groupsAt,
  pendingChanges,
  websiteChoices,
  websiteCodeOf,
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

/** An ERP's group of fields: its own values, the integration's where it sets none, edits on top. */
function erpGroupFields(group, page, values, edits) {
  const fields = new Map(
    (page.fields ?? []).map((field) => [field.name, field]),
  );
  const held = new Map(values.map((value) => [value.name, value]));
  return group.names
    .filter((name) => fields.has(name))
    .map((name) => {
      const dressed = {
        ...dressErpField(fields.get(name), held.get(name)),
        scope: group.scope,
      };
      if (!(name in edits)) {
        return dressed;
      }
      if (edits[name] === null) {
        return { ...dressed, clearable: false, inherited: true };
      }
      return {
        ...dressed,
        clearable: true,
        inherited: false,
        value: edits[name],
      };
    });
}

/** The ERP list, read once; an older integration without it has one ERP and no switcher. */
function useErpList(api) {
  const [erps, setErps] = useState([]);
  useEffect(() => {
    if (!api.erps) {
      return;
    }
    api
      .erps()
      .then((answer) => setErps(answer.entries ?? []))
      .catch(() => setErps([]));
  }, [api]);
  return [erps, setErps];
}

export function SettingsSection({ api, initialPage, onError, scopes }) {
  const [erps, setErps] = useErpList(api);
  const [erpId, setErpId] = useState("");
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

  const entry = erps.find((candidate) => candidate.id === erpId);
  const websiteCode = websiteCodeOf(scopes, scopeId);
  const shownValues = entry
    ? erpValues(entry, websiteCode, page?.values)
    : page?.values;
  const changes = pendingChanges(shownValues, edits);
  const changed = Object.keys(changes).length > 0;

  const switchScope = useCallback((next) => {
    setEdits({});
    setSaved(false);
    setScopeId(next);
  }, []);
  const switchErp = useCallback((next) => {
    setEdits({});
    setSaved(false);
    setErpId(next);
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
      if (entry) {
        const answer = await api.saveErpSettings(
          entry.id,
          websiteCode,
          changes,
        );
        setErps((list) =>
          list.map((candidate) =>
            candidate.id === answer.entry.id ? answer.entry : candidate,
          ),
        );
      } else {
        setPage(await api.saveSettings(scopeId || undefined, changes));
      }
      setEdits({});
      setSaved(true);
    } catch (e) {
      onError(`Settings could not be saved: ${e.message}`);
    }
    setSaving(false);
  }, [api, changes, entry, onError, scopeId, setErps, websiteCode]);
  const cancel = useCallback(() => {
    setEdits({});
    setSaved(false);
  }, []);

  const groups = useMemo(() => {
    if (!page) {
      return [];
    }
    if (entry) {
      return erpGroupsAt(scopeLevel).map((group) => ({
        ...group,
        fields: erpGroupFields(group, page, shownValues, edits),
      }));
    }
    return groupsAt(scopeLevel).map((group) => ({
      ...group,
      fields: groupFields(group, page, edits, scopeLevel),
    }));
  }, [page, edits, entry, scopeLevel, shownValues]);
  const erpList = erpChoices(erps);

  return (
    <section aria-labelledby="erp-settings-heading" className="erp-section">
      <div className="erp-section-head">
        <Heading id="erp-settings-heading" level={2}>
          Settings
        </Heading>
        {erpList.length > 0 && (
          <ScopeSwitcher
            choices={erpList}
            hasUnsavedChanges={changed}
            label="ERP"
            onChange={switchErp}
            scopeId={erpId}
          />
        )}
        <ScopeSwitcher
          hasUnsavedChanges={changed}
          onChange={switchScope}
          scopeId={scopeId}
          scopes={scopes}
        />
      </div>
      {entry && (
        <Text>
          The settings {entry.name} sets for itself. Anything it does not set is
          the integration's value, under "Every ERP".
        </Text>
      )}
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
      {scopeLevel !== "global" && page !== null && !entry && (
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
