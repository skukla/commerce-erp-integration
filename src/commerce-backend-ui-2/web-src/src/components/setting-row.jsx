/*
 * One setting, as Stores > Configuration shows one (admin-config.jsx AdminConfigRow): its label
 * on the left, the field with its short comment under it and its longer text behind the help
 * button, "Use Default Value" (or, for one ERP, "Use Default for all ERPs"), and where it is set.
 * Ticked, the field is off and the wider value applies. An on-or-off setting is a Yes/No list,
 * as every one is on the Configuration page.
 *
 * No field is shown empty (owner, 2026-10-14). A setting whose blank means a value the
 * integration works out (settings-copy.js systemValueOf) shows that value, off, under "Use
 * system value", the Admin's own words for it; unticked, the value is the merchant's to change.
 * The websites an ERP owns are chosen from the store's own websites in the Admin's multiselect,
 * not typed (owner, 2026-10-14: settings that name several websites use it; one only, a list).
 */
import { useCallback } from "react";

import { AdminConfigRow } from "#web/components/admin/admin-config.jsx";
import {
  AdminCheckbox,
  AdminMultiselect,
  AdminPicker,
  AdminTextField,
} from "#web/components/admin/admin-fields.jsx";
import { confirmStatusOptions, settingText } from "#web/settings-copy.js";

/**
 * A list choice's id in the Picker. A collection's keys cannot be "" (the choice of None, or
 * of the default ownership), so each value is kept apart by a prefix.
 */
const idOf = (value) => `v:${value ?? ""}`;
const valueFrom = (id) => String(id).slice(2);

const YES_NO = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];

/** A list of `{ value, label }` choices, as a Picker. */
function Choice({ disabled, label, onChange, options, value }) {
  const items = options.map((o) => ({ id: idOf(o.value), label: o.label }));
  const change = useCallback((id) => onChange(valueFrom(id)), [onChange]);
  return (
    <AdminPicker
      isDisabled={disabled}
      label={label}
      labelHidden
      onChange={change}
      options={items}
      value={idOf(value)}
    />
  );
}

function YesNo({ disabled, label, onChange, value }) {
  const change = useCallback((id) => onChange(id === "yes"), [onChange]);
  return (
    <AdminPicker
      isDisabled={disabled}
      label={label}
      labelHidden
      onChange={change}
      options={YES_NO}
      value={value ? "yes" : "no"}
    />
  );
}

/** "bodea, citisignal" and the chosen list, both ways. */
const codesIn = (text) =>
  String(text ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

function Websites({ disabled, label, onChange, value, websites }) {
  const options = websites.map((w) => ({ id: w.code, label: w.label }));
  const change = useCallback((ids) => onChange(ids.join(", ")), [onChange]);
  return (
    <AdminMultiselect
      isDisabled={disabled}
      label={label}
      onChange={change}
      options={options}
      value={codesIn(value)}
    />
  );
}

/** The control a field is edited with. */
function Control({
  disabled,
  field,
  onChange,
  options,
  statuses,
  text,
  websites,
}) {
  const common = { disabled, label: text.label, onChange };
  if (field.name === "structure_owns_websites" && websites?.length) {
    return (
      <Websites
        disabled={disabled}
        label={text.label}
        onChange={onChange}
        value={field.value}
        websites={websites}
      />
    );
  }
  if (field.name === "orders_confirm_status") {
    // A pick from Commerce's Pending statuses, or a text box when they could not be read.
    const pending = confirmStatusOptions(statuses, field.value);
    if (pending) {
      return <Choice {...common} options={pending} value={field.value} />;
    }
  }
  if (options) {
    return <Choice {...common} options={options} value={field.value} />;
  }
  if (field.type === "boolean") {
    return <YesNo {...common} value={field.value} />;
  }
  return (
    <AdminTextField
      isDisabled={disabled}
      label={text.label}
      onChange={onChange}
      placeholder={text.placeholder}
      value={field.value ?? ""}
    />
  );
}

/**
 * The comment under a field: its help; for an unread status list, what to type; for the
 * websites when they are typed, their form.
 */
function commentOf(field, statuses, text, websites) {
  if (field.name === "structure_owns_websites" && !websites?.length) {
    return "Website codes, comma-separated.";
  }
  const unread =
    field.name === "orders_confirm_status" &&
    !confirmStatusOptions(statuses, field.value);
  return unread ? "Enter a status code." : text.help;
}

/**
 * The row's box and what its field shows: "Use Default Value" where the wider scope's value can
 * apply; else "Use system value" where blank means a worked-out value. Either ticked, the field
 * is off and shows the value that applies.
 */
function useBox({ field, onChange, onUseDefault, systemValue, useDefault }) {
  const blank =
    field.value === "" || field.value === null || field.value === undefined;
  const ownBox = !useDefault && systemValue !== undefined;
  const toggleDefault = useCallback(
    (ticked) =>
      ticked
        ? onUseDefault(field.name)
        : onChange(field.name, field.value || systemValue || field.value),
    [field.name, field.value, onChange, onUseDefault, systemValue],
  );
  const toggleSystem = useCallback(
    (ticked) => onChange(field.name, ticked ? "" : systemValue),
    [field.name, onChange, systemValue],
  );
  const off = ownBox ? blank : Boolean(useDefault) && field.inherited;
  const shown =
    off && blank && systemValue ? { ...field, value: systemValue } : field;
  let box = null;
  if (ownBox) {
    box = (
      <AdminCheckbox isSelected={blank} onChange={toggleSystem}>
        Use system value
      </AdminCheckbox>
    );
  } else if (useDefault) {
    box = (
      <AdminCheckbox isSelected={field.inherited} onChange={toggleDefault}>
        {useDefault}
      </AdminCheckbox>
    );
  }
  return { box, off, shown };
}

/**
 * @param {object} props
 * @param {object} props.field the field as shown (settings-fields.js)
 * @param {{ id: string, name: string }|null} props.erp the ERP shown, for its own words
 * @param {string|null} props.useDefault the box's label, or null for no box
 * @param {string} props.scope where the setting is set: "global" or "website"
 * @param {string} [props.systemValue] what blank means, shown instead of an empty field
 * @param {Array<{ code: string, label: string }>} [props.websites] the store's websites
 * @param {Array<{ value: string, label: string }>} [props.options] a list's choices
 * @param {(name: string, value: unknown) => void} props.onChange
 * @param {(name: string) => void} props.onUseDefault tick the box: the wider value applies
 * @param {string} [props.problem] why a save was refused, shown under the field in red
 */
export function SettingRow(props) {
  const { erp, field, onChange, options, problem, scope, statuses, websites } =
    props;
  const text = settingText(field.name, erp);
  const change = useCallback(
    (value) => onChange(field.name, value),
    [field.name, onChange],
  );
  const { box, off, shown } = useBox(props);
  return (
    <AdminConfigRow
      comment={commentOf(field, statuses, text, websites)}
      label={text.label}
      more={text.more}
      problem={problem}
      scope={scope}
      useDefault={box}>
      <Control
        disabled={off}
        field={shown}
        onChange={change}
        options={options}
        statuses={statuses}
        text={text}
        websites={websites}
      />
    </AdminConfigRow>
  );
}
