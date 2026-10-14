/*
 * One setting, as Stores > Configuration shows one (admin-config.jsx AdminConfigRow): its label
 * on the left, the field with its short comment under it and its longer text behind the help
 * button, "Use Default Value" (or, for one ERP, "Same as All ERPs"), and where it is set.
 * Ticked, the field is off and the wider value applies. An on-or-off setting is a Yes/No list,
 * as every one is on the Configuration page.
 */
import { useCallback } from "react";

import { AdminConfigRow } from "#web/components/admin/admin-config.jsx";
import {
  AdminCheckbox,
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

/** The control a field is edited with. */
function Control({ disabled, field, onChange, options, statuses, text }) {
  const common = { disabled, label: text.label, onChange };
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

/** The comment under a field: its help, or, for an unread status list, what to type. */
function commentOf(field, statuses, text) {
  const unread =
    field.name === "orders_confirm_status" &&
    !confirmStatusOptions(statuses, field.value);
  return unread ? "Enter a status code." : text.help;
}

/**
 * @param {object} props
 * @param {object} props.field the field as shown (settings-fields.js)
 * @param {{ id: string, name: string }|null} props.erp the ERP shown, for its own words
 * @param {string|null} props.useDefault the box's label, or null for no box
 * @param {string} props.scope where the setting is set: "global" or "website"
 * @param {Array<{ value: string, label: string }>} [props.options] a list's choices
 * @param {(name: string, value: unknown) => void} props.onChange
 * @param {(name: string) => void} props.onUseDefault tick the box: the wider value applies
 */
export function SettingRow({
  erp,
  field,
  onChange,
  onUseDefault,
  options,
  scope,
  statuses,
  useDefault,
}) {
  const text = settingText(field.name, erp);
  const change = useCallback(
    (value) => onChange(field.name, value),
    [field.name, onChange],
  );
  const toggleDefault = useCallback(
    (ticked) =>
      ticked ? onUseDefault(field.name) : onChange(field.name, field.value),
    [field.name, field.value, onChange, onUseDefault],
  );
  return (
    <AdminConfigRow
      comment={commentOf(field, statuses, text)}
      label={text.label}
      more={text.more}
      scope={scope}
      useDefault={
        useDefault && (
          <AdminCheckbox isSelected={field.inherited} onChange={toggleDefault}>
            {useDefault}
          </AdminCheckbox>
        )
      }>
      <Control
        disabled={Boolean(useDefault) && field.inherited}
        field={field}
        onChange={change}
        options={options}
        statuses={statuses}
        text={text}
      />
    </AdminConfigRow>
  );
}
