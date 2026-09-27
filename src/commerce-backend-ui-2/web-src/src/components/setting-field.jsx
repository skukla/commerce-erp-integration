import {
  Checkbox,
  Picker,
  PickerItem,
  Switch,
  TextField,
} from "@react-spectrum/s2";
import { useCallback } from "react";

/** The control a field is edited with: a switch for a boolean, a pick from a list, a text box otherwise. */
function Control({ field, isDisabled, onChange }) {
  const pick = useCallback((key) => onChange(String(key)), [onChange]);
  if (field.type === "list") {
    return (
      <Picker
        isDisabled={isDisabled}
        label={field.label}
        onSelectionChange={pick}
        selectedKey={field.value}>
        {(field.options ?? []).map((option) => (
          <PickerItem id={option.value} key={option.value}>
            {option.label}
          </PickerItem>
        ))}
      </Picker>
    );
  }
  if (field.type === "text") {
    return (
      <TextField
        isDisabled={isDisabled}
        label={field.label}
        onChange={onChange}
        value={field.value ?? ""}
      />
    );
  }
  return (
    <Switch
      isDisabled={isDisabled}
      isSelected={field.value}
      onChange={onChange}>
      {field.label}
    </Switch>
  );
}

/**
 * One setting, the way Stores ▸ Configuration shows it: the control, what it does, the scope
 * it can be set at, and on a website Commerce's "Use Default Value": ticked, the website takes
 * Default Config's value and the control is greyed out; unticked, the website sets its own.
 * Ticking it sends `null`, which removes the website's value so Default Config decides again.
 */
export function SettingField({ field, onChange, onUseDefault }) {
  const change = useCallback(
    (value) => onChange(field.name, value),
    [field.name, onChange],
  );
  const toggleDefault = useCallback(
    (useDefault) =>
      useDefault ? onUseDefault(field.name) : onChange(field.name, field.value),
    [field.name, field.value, onChange, onUseDefault],
  );
  const atWebsite = field.inherited || field.clearable;
  return (
    <div className="erp-setting">
      <Control field={field} isDisabled={field.inherited} onChange={change} />
      <span className="erp-setting-description">{field.description}</span>
      {field.scope && (
        // Commerce's own configuration labels a field with the scope it can be set at.
        <span className="erp-setting-scope">[{field.scope}]</span>
      )}
      {atWebsite && (
        <Checkbox isSelected={field.inherited} onChange={toggleDefault}>
          Use Default Value
        </Checkbox>
      )}
    </div>
  );
}
