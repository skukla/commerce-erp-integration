/*
 * The page's controls for choosing: Spectrum 2's Picker and Switch, dressed as Commerce Admin
 * fields (styles/admin-skin.css). A filter bar is built from these, never from pills.
 */
import { Picker, PickerItem } from "@react-spectrum/s2/Picker";
import { SearchField } from "@react-spectrum/s2/SearchField";
import { Switch } from "@react-spectrum/s2/Switch";

/**
 * @param {object} props
 * @param {string} props.label the field's visible label
 * @param {Array<{ id: string, label: string }>} props.options the first is "every"
 * @param {string} props.value the chosen id
 * @param {(id: string) => void} props.onChange
 */
export function AdminPicker({ label, onChange, options, value }) {
  return (
    <Picker
      items={options}
      label={label}
      labelPosition="side"
      onSelectionChange={onChange}
      selectedKey={value}
      size="S"
      UNSAFE_className="adm-picker">
      {(option) => <PickerItem id={option.id}>{option.label}</PickerItem>}
    </Picker>
  );
}

/** A keyword search above a table: filters as it is typed. */
export function AdminSearch({ label, onChange, placeholder, value }) {
  return (
    <SearchField
      aria-label={label}
      onChange={onChange}
      placeholder={placeholder}
      size="S"
      UNSAFE_className="adm-search"
      value={value}
    />
  );
}

export function AdminSwitch({ children, isSelected, onChange }) {
  return (
    <Switch
      isSelected={isSelected}
      onChange={onChange}
      size="S"
      UNSAFE_className="adm-switch">
      {children}
    </Switch>
  );
}
