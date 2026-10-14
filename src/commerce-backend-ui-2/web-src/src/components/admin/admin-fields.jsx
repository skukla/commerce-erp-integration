/*
 * The page's controls for choosing: Spectrum 2's Picker, SearchField, DatePicker and Switch,
 * dressed as Commerce Admin fields (styles/admin-skin.css, by the Admin's own values: 32 px,
 * white, a 1 px #adadad border, radius 1 px, #007bdb on focus; Magento backend
 * variables/_forms.less). A filter row is built from these, in AdminFilterBar's panel.
 */
import { parseDate } from "@internationalized/date";
import { DatePicker } from "@react-spectrum/s2/DatePicker";
import { Picker, PickerItem } from "@react-spectrum/s2/Picker";
import { SearchField } from "@react-spectrum/s2/SearchField";
import { Switch } from "@react-spectrum/s2/Switch";
import { useCallback } from "react";

/**
 * @param {object} props
 * @param {string} props.label the field's visible label, above it as the Admin's filters have
 * @param {Array<{ id: string, label: string }>} props.options the first is "every"
 * @param {string} props.value the chosen id
 * @param {(id: string) => void} props.onChange
 */
export function AdminPicker({ label, onChange, options, value }) {
  return (
    <Picker
      items={options}
      label={label}
      onSelectionChange={onChange}
      selectedKey={value}
      UNSAFE_className="adm-field adm-picker">
      {(option) => <PickerItem id={option.id}>{option.label}</PickerItem>}
    </Picker>
  );
}

/** The Admin grid's keyword search: filters as it is typed. */
export function AdminSearch({ label, onChange, placeholder, value }) {
  return (
    <SearchField
      aria-label={label}
      onChange={onChange}
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
