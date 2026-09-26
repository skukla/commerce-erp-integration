import {
  Button,
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

import { MappingTab } from "#web/components/mapping-tab.jsx";
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
  onRefreshScopes,
  onScopeChange,
  run,
  scopeId,
  scopes,
  /** Why the website list may be missing or old, when Commerce could not be read. */
  scopesNote,
  /** Which tab opens first; the page opens on the map, a preview may ask for another. */
  selectedTab = "mapping",
  status,
}) {
  const choices = scopeChoices(scopes);
  const scopeLevel =
    choices.find((choice) => choice.id === scopeId)?.level ?? "global";
  return (
    <main>
      <Heading level={1}>{erpName}</Heading>
      <Text>
        Orders flow to {erpName} with its number written back; contract prices
        and the discount ceiling apply at cart time; the ERP's prices, stock,
        credit limits and order statuses flow back here every minute.
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
        <Button
          isDisabled={!onRefreshScopes}
          onPress={onRefreshScopes}
          variant="secondary">
          Refresh websites
        </Button>
        <span className="erp-scope-note">
          The joins and switches below apply to this scope and anything under
          it.
        </span>
      </div>
      {scopesNote && (
        <InlineAlert variant="notice">
          <Text>{scopesNote}</Text>
        </InlineAlert>
      )}
      <Tabs aria-label="ERP integration" defaultSelectedKey={selectedTab}>
        <TabList>
          <Tab id="mapping">Mapping</Tab>
          <Tab id="status">Status &amp; sync</Tab>
        </TabList>
        <TabPanel id="mapping">
          <MappingTab
            api={api}
            erpName={erpName}
            onError={onError}
            scopeId={scopeId}
            scopeLevel={scopeLevel}
            status={status}
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
