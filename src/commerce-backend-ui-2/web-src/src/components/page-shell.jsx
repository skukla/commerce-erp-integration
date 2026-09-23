import {
  Heading,
  InlineAlert,
  Picker,
  PickerItem,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
} from "@react-spectrum/s2";

import { SettingsForm } from "#web/components/settings-form.jsx";
import { StatusTab } from "#web/components/status-tab.jsx";
import { scopeChoices } from "#web/settings-view.js";

/**
 * The page as it looks: the ERP's name, the scope bar, and the tabs. Everything it shows
 * arrives as props, so the same shell renders against the live actions (MainPage) and
 * against stand-in data in a local preview — the layout is checked without a Commerce
 * Admin and a sign-in (AB-10's plan, step 4).
 */
export function PageShell({
  api,
  busy,
  erpName,
  error,
  log,
  onError,
  onScopeChange,
  run,
  scopeId,
  scopes,
  /** Which tab opens first; the page opens on Settings, a preview may ask for another. */
  selectedTab = "settings",
  status,
}) {
  const choices = scopeChoices(scopes);
  const scopeLevel =
    choices.find((choice) => choice.id === scopeId)?.level ?? "global";
  return (
    <main>
      <Heading level={1}>{erpName}</Heading>
      <Text>
        Orders flow to {erpName} with its number written back; contract prices and
        the discount ceiling apply at cart time; the ERP's prices, stock, credit
        limits and order statuses flow back here every minute.
      </Text>
      {error && (
        <InlineAlert variant="negative">
          <Heading>Something went wrong</Heading>
          <Text>{error}</Text>
        </InlineAlert>
      )}
      <div className="erp-scope-bar">
        <Picker
          aria-label="Scope"
          items={choices}
          onSelectionChange={onScopeChange}
          selectedKey={scopeId}>
          {(choice) => <PickerItem id={choice.id}>{choice.label}</PickerItem>}
        </Picker>
        <span className="erp-scope-note">
          Settings apply to this scope and anything under it.
        </span>
      </div>
      <Tabs aria-label="ERP integration" defaultSelectedKey={selectedTab}>
        <TabList>
          <Tab id="settings">Settings</Tab>
          <Tab id="status">Status &amp; sync</Tab>
        </TabList>
        <TabPanel id="settings">
          <SettingsForm
            api={api}
            onError={onError}
            scopeId={scopeId}
            scopeLevel={scopeLevel}
          />
        </TabPanel>
        <TabPanel id="status">
          <StatusTab
            api={api}
            busy={busy}
            erpName={erpName}
            log={log}
            onError={onError}
            run={run}
            status={status}
          />
        </TabPanel>
      </Tabs>
    </main>
  );
}
