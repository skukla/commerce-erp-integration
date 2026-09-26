/*
 * What a merchant chooses, and nothing else: three short groups, per website, with
 * Commerce's own "Use Default" for a value inherited from Default Config.
 */
import {
  Button,
  Checkbox,
  Heading,
  Picker,
  PickerItem,
  Switch,
  Text,
  TextField,
} from "@react-spectrum/s2";
import { useState } from "react";

import { ERP, WEBSITES } from "./data.js";

function Field({ atDefault, children, help }) {
  const [useDefault, setUseDefault] = useState(true);
  return (
    <div className="nx-field">
      <div className="nx-field-control">
        {children(atDefault ? false : useDefault)}
      </div>
      {!atDefault && (
        <Checkbox isSelected={useDefault} onChange={setUseDefault}>
          Use Default
        </Checkbox>
      )}
      <Text UNSAFE_className="nx-help">{help}</Text>
    </div>
  );
}

export function SettingsView() {
  const [scope, setScope] = useState("");
  const atDefault = scope === "";
  return (
    <section aria-labelledby="nx-settings" className="nx-section">
      <div className="nx-section-head">
        <Heading id="nx-settings" level={2}>
          Settings
        </Heading>
        <Picker
          items={WEBSITES}
          label="Scope"
          onSelectionChange={setScope}
          selectedKey={scope}>
          {(w) => <PickerItem id={w.id}>{w.label}</PickerItem>}
        </Picker>
      </div>

      <fieldset className="nx-group">
        <legend>Orders</legend>
        <Field
          atDefault={atDefault}
          help={`Orders placed on this website are created in ${ERP.name}.`}>
          {(inherited) => (
            <Switch defaultSelected isDisabled={inherited}>
              Send orders to {ERP.name}
            </Switch>
          )}
        </Field>
        <Field
          atDefault={atDefault}
          help="Sent when the ERP is back, for up to a day.">
          {(inherited) => (
            <Switch defaultSelected isDisabled={inherited}>
              Hold orders while {ERP.name} is offline
            </Switch>
          )}
        </Field>
        <Field
          atDefault={atDefault}
          help="Created at Stores › Order Status on the Pending state.">
          {(inherited) => (
            <TextField
              defaultValue="erp_confirmed"
              isDisabled={inherited}
              label="Status when confirmed"
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="nx-group">
        <legend>Prices</legend>
        <Field
          atDefault={atDefault}
          help="Company contract prices go into each company's shared catalog.">
          {(inherited) => (
            <Switch defaultSelected isDisabled={inherited}>
              Use {ERP.name} contract prices
            </Switch>
          )}
        </Field>
      </fieldset>

      <fieldset className="nx-group">
        <legend>Products and organisation</legend>
        <Field
          atDefault={atDefault}
          help={`Which products ${ERP.name} owns and receives orders for.`}>
          {(inherited) => (
            <Picker
              defaultSelectedKey="attribute"
              isDisabled={inherited}
              label="Products this ERP owns">
              <PickerItem id="all">All products</PickerItem>
              <PickerItem id="attribute">
                Products with erp_owner = Northwind
              </PickerItem>
              <PickerItem id="sources">
                Products in chosen inventory sources
              </PickerItem>
            </Picker>
          )}
        </Field>
        <Field
          atDefault={atDefault}
          help="Orders from this website carry it in the ERP.">
          {(inherited) => (
            <Picker
              defaultSelectedKey="1000"
              isDisabled={inherited}
              label="Sales organisation">
              <PickerItem id="1000">Online US (1000)</PickerItem>
              <PickerItem id="2000">Online EU (2000)</PickerItem>
            </Picker>
          )}
        </Field>
      </fieldset>

      <div className="nx-actions">
        <Button variant="accent">Save</Button>
      </div>
    </section>
  );
}
