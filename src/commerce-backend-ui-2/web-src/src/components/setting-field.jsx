import {
  Button,
  Picker,
  PickerItem,
  Switch,
  TextField,
} from "@react-spectrum/s2";
import { useCallback } from "react";

/** The control a field is edited with: a switch for a boolean, a pick from a list, a text box otherwise. */
function Control({ field, onChange }) {
  const pick = useCallback((key) => onChange(String(key)), [onChange]);
  if (field.type === "list") {
    return (
      <Picker
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
        label={field.label}
        onChange={onChange}
        value={field.value ?? ""}
      />
    );
  }
  return (
    <Switch isSelected={field.value} onChange={onChange}>
      {field.label}
    </Switch>
  );
}

/**
 * One setting: its control, what it does, and — on a narrower scope — where it comes
 * from. Values are kept per scope and inherited like Stores ▸ Configuration; Use Default
 * sends `null`, which removes this scope's override so the wider scope decides again.
 */
export function SettingField({ field, onChange, onUseDefault }) {
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
      <Control field={field} onChange={change} />
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
