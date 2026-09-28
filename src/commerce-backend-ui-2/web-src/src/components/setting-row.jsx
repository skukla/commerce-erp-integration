/*
 * One setting, the way Stores › Configuration shows it and the mockup lays it out: the label
 * and a short help line on the left, with ⓘ for the longer text; the control on the right,
 * with Commerce's "Use Default Value" (or, for one ERP, "Same as All ERPs") under it. Ticked,
 * the control is grayed out and the wider value applies.
 */
import { useCallback, useState } from "react";

import { confirmStatusOptions, settingText } from "#web/settings-copy.js";

function Switch({ disabled, label, onChange, value }) {
  const change = useCallback(
    (event) => onChange(event.target.checked),
    [onChange],
  );
  return (
    <label className="switch">
      <input
        aria-checked={Boolean(value)}
        aria-label={label}
        checked={Boolean(value)}
        disabled={disabled}
        onChange={change}
        role="switch"
        type="checkbox"
      />
      <span className="track" />
      <span aria-hidden="true">{value ? "Yes" : "No"}</span>
    </label>
  );
}

function Select({ disabled, label, onChange, options, value }) {
  const change = useCallback(
    (event) => onChange(event.target.value),
    [onChange],
  );
  return (
    <select
      aria-label={label}
      className="select"
      disabled={disabled}
      onChange={change}
      value={value ?? ""}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** The confirm status: a pick from Commerce's Pending statuses, or a text box when unread. */
function ConfirmStatus({ disabled, label, onChange, statuses, value }) {
  const options = confirmStatusOptions(statuses, value);
  const change = useCallback(
    (event) => onChange(event.target.value),
    [onChange],
  );
  if (options) {
    return (
      <Select
        disabled={disabled}
        label={label}
        onChange={onChange}
        options={options}
        value={value}
      />
    );
  }
  return (
    <>
      <input
        aria-label={label}
        className="input"
        disabled={disabled}
        onChange={change}
        placeholder="erp_confirmed"
        value={value ?? ""}
      />
      <span className="hint">
        Commerce’s order statuses could not be read here, so type the status
        code, as erp_confirmed.
      </span>
    </>
  );
}

/** The control a field is edited with. */
function Control({ disabled, field, onChange, options, statuses, text }) {
  const change = useCallback(
    (event) => onChange(event.target.value),
    [onChange],
  );
  if (field.name === "orders_confirm_status") {
    return (
      <ConfirmStatus
        disabled={disabled}
        label={text.label}
        onChange={onChange}
        statuses={statuses}
        value={field.value}
      />
    );
  }
  if (options) {
    return (
      <Select
        disabled={disabled}
        label={text.label}
        onChange={onChange}
        options={options}
        value={field.value}
      />
    );
  }
  if (field.type === "boolean") {
    return (
      <Switch
        disabled={disabled}
        label={text.label}
        onChange={onChange}
        value={field.value}
      />
    );
  }
  return (
    <input
      aria-label={text.label}
      className="input"
      disabled={disabled}
      onChange={change}
      placeholder={text.placeholder}
      value={field.value ?? ""}
    />
  );
}

/**
 * @param {object} props
 * @param {object} props.field the field as shown (settings-fields.js)
 * @param {{ id: string, name: string }|null} props.erp the ERP shown, for its own words
 * @param {string|null} props.useDefault the box's label, or null for no box
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
  statuses,
  useDefault,
}) {
  const [open, setOpen] = useState(false);
  const text = settingText(field.name, erp);
  const moreId = `more-${field.name}`;
  const change = useCallback(
    (value) => onChange(field.name, value),
    [field.name, onChange],
  );
  const toggleDefault = useCallback(
    (event) =>
      event.target.checked
        ? onUseDefault(field.name)
        : onChange(field.name, field.value),
    [field.name, field.value, onChange, onUseDefault],
  );
  const toggleOpen = useCallback(() => setOpen((current) => !current), []);
  return (
    <div className="setting">
      <div>
        <div className="label">
          {text.label}
          <button
            aria-controls={moreId}
            aria-expanded={open}
            aria-label={`More about ${text.label.toLowerCase()}`}
            className="info"
            onClick={toggleOpen}
            type="button">
            i
          </button>
        </div>
        <p className="help">{text.help}</p>
      </div>
      <div className="control">
        <Control
          disabled={Boolean(useDefault) && field.inherited}
          field={field}
          onChange={change}
          options={options}
          statuses={statuses}
          text={text}
        />
        {useDefault && (
          <label className="use-default">
            <input
              checked={field.inherited}
              onChange={toggleDefault}
              type="checkbox"
            />
            <span>{useDefault}</span>
          </label>
        )}
      </div>
      <p className="more" hidden={!open} id={moreId}>
        {text.more}
      </p>
    </div>
  );
}
