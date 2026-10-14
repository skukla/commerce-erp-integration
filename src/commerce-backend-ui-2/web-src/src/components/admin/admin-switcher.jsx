/*
 * The Admin's scope switcher, "Scope: Default Config ▾ ?", as Stores > Configuration draws it
 * (magento/magento2 2.4-develop, Magento_Backend templates/store/switcher.phtml and
 * main/actions-bar/_store-switcher.less, actions/_actions-dropdown.less, read 2026-10-14): a bold
 * label, the current choice as plain 13 px text with a small arrow and no box until it is opened,
 * then its hint. The Settings tab has two, ERP and Scope, side by side (owner, 2026-10-14).
 *
 * Spectrum 2's quiet Picker is the dropdown (its keyboard, list and focus): quiet is its own
 * no-box, as-wide-as-its-text form, the switcher's shape. Where there is nothing to
 * switch between (one ERP) the choice is shown as text in the same place, so the page always
 * says whose settings these are.
 */
import { Content } from "@react-spectrum/s2/Content";
import { ContextualHelp } from "@react-spectrum/s2/ContextualHelp";
import { Picker, PickerItem } from "@react-spectrum/s2/Picker";

/**
 * @param {object} props
 * @param {string} props.label "ERP", "Scope"
 * @param {Array<{ id: string, label: string }>} props.options; one only is shown as text
 * @param {string} props.value the chosen id
 * @param {(id: string) => void} props.onChange
 * @param {string} [props.hint] the text behind its "?"
 */
export function AdminSwitcher({ hint, label, onChange, options, value }) {
  const chosen = options.find((option) => option.id === value);
  return (
    <div className="adm-switcher">
      <span className="adm-switcher-label">{label}:</span>
      {options.length > 1 ? (
        <Picker
          aria-label={label}
          isQuiet
          items={options}
          onSelectionChange={onChange}
          selectedKey={value}
          UNSAFE_className="adm-switcher-picker">
          {(option) => <PickerItem id={option.id}>{option.label}</PickerItem>}
        </Picker>
      ) : (
        <span className="adm-switcher-value">{chosen?.label}</span>
      )}
      {hint && (
        <ContextualHelp aria-label={`About ${label.toLowerCase()}`}>
          <Content>{hint}</Content>
        </ContextualHelp>
      )}
    </div>
  );
}
