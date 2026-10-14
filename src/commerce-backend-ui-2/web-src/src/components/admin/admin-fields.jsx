/*
 * The page's fields: Spectrum 2's Picker, SearchField, TextField, DatePicker, Checkbox and
 * Switch, dressed as Commerce Admin fields (styles/admin-skin.css, by the Admin's own values:
 * 32 px, white, a 1 px #adadad border, radius 1 px, #007bdb on focus; Magento backend
 * variables/_forms.less). A filter row is built from these, in AdminFilterBar's panel, and a
 * Configuration row, in AdminConfigRow.
 */
import { parseDate } from "@internationalized/date";
import { Checkbox } from "@react-spectrum/s2/Checkbox";
import { DatePicker } from "@react-spectrum/s2/DatePicker";
import { Picker, PickerItem } from "@react-spectrum/s2/Picker";
import { SearchField } from "@react-spectrum/s2/SearchField";
import { Switch } from "@react-spectrum/s2/Switch";
import { TextField } from "@react-spectrum/s2/TextField";
import { useCallback } from "react";

/**
 * @param {object} props
 * @param {string} props.label the field's label: visible above it, as the Admin's filters have,
 *   or, with `labelHidden`, for a screen reader only (a Configuration row labels it on its left)
 * @param {Array<{ id: string, label: string }>} props.options the first is "every"
 * @param {string} props.value the chosen id
 * @param {(id: string) => void} props.onChange
 * @param {boolean} [props.labelHidden]
 * @param {boolean} [props.isDisabled]
 */
export function AdminPicker({
  isDisabled = false,
  label,
  labelHidden = false,
  onChange,
  options,
  value,
}) {
  return (
    <Picker
      aria-label={labelHidden ? label : undefined}
      isDisabled={isDisabled}
      items={options}
      label={labelHidden ? undefined : label}
      onSelectionChange={onChange}
      selectedKey={value}
      UNSAFE_className="adm-field adm-picker">
      {(option) => <PickerItem id={option.id}>{option.label}</PickerItem>}
    </Picker>
  );
}

/** A text field, labeled on its left by its Configuration row. */
export function AdminTextField({
  isDisabled = false,
  label,
  onChange,
  placeholder,
  value,
}) {
  return (
    <TextField
      aria-label={label}
      isDisabled={isDisabled}
      onChange={onChange}
      placeholder={placeholder}
      UNSAFE_className="adm-field adm-text"
      value={value}
    />
  );
}

/** A checkbox and its words: the Configuration page's "Use Default Value". */
export function AdminCheckbox({ children, isSelected, onChange }) {
  return (
    <Checkbox
      isSelected={isSelected}
      onChange={onChange}
      UNSAFE_className="adm-checkbox">
      {children}
    </Checkbox>
  );
}

/**
 * The Admin grid's keyword search: filters as it is typed, or, with `onSubmit`, looks up what
 * was typed on Enter (the Overview's search).
 * @param {object} props
 * @param {(text: string) => void} [props.onSubmit]
 */
export function AdminSearch({ label, onChange, onSubmit, placeholder, value }) {
  return (
    <SearchField
      aria-label={label}
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder={placeholder}
      UNSAFE_className="adm-field adm-search"
      value={value}
    />
  );
}

/** One end of a range: "from" or "to" on its left, as the Admin's range filters label them. */
function RangeEnd({ label, legend, onChange, value }) {
  const change = useCallback(
    (day) => onChange(day ? day.toString() : ""),
    [onChange],
  );
  return (
    <div className="adm-range-end">
      <span aria-hidden="true" className="adm-range-label">
        {label}
      </span>
      <DatePicker
        aria-label={`${legend} ${label}`}
        onChange={change}
        UNSAFE_className="adm-field adm-date"
        value={value ? parseDate(value) : null}
      />
    </div>
  );
}

/**
 * A date range as the Admin's grid filters draw one: a bold label over two fields, "from" and
 * "to" (Magento_Ui grid/filters, a range filter's inner fields). Either end may be empty. Its days
 * are YYYY-MM-DD strings, so its callers never handle date objects.
 * @param {object} props
 * @param {string} props.from the first day, or ""
 * @param {string} props.to the last day, or ""
 * @param {(from: string, to: string) => void} props.onChange
 */
export function AdminDateRange({ from, onChange, to }) {
  const onFrom = useCallback((day) => onChange(day, to), [onChange, to]);
  const onTo = useCallback((day) => onChange(from, day), [from, onChange]);
  return (
    <fieldset className="adm-range">
      <legend>Date</legend>
      <RangeEnd label="from" legend="Date" onChange={onFrom} value={from} />
      <RangeEnd label="to" legend="Date" onChange={onTo} value={to} />
    </fieldset>
  );
}

export function AdminSwitch({ children, isSelected, onChange }) {
  return (
    <Switch
      isSelected={isSelected}
      onChange={onChange}
      UNSAFE_className="adm-switch">
      {children}
    </Switch>
  );
}
