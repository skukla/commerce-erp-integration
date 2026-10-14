/*
 * Every shared part of the Admin page (src/commerce-backend-ui-2/web-src/src/components/admin/)
 * in each of its states, on one page: `?page=parts`. The parts were only ever seen inside a
 * screen, so a change to one showed up wherever it happened to be used; here each is seen
 * alone, and test/web/admin-screens.test.js fingerprints this page with the screens, so a part
 * that changes its look has to be accepted on purpose. Never shipped.
 */
import { useCallback, useMemo } from "react";

import { AdminButton } from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-button.jsx";
import {
  AdminConfigGroup,
  AdminConfigRow,
} from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-config.jsx";
import { AdminFacts } from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-facts.jsx";
import {
  AdminCheckbox,
  AdminDateRange,
  AdminPicker,
  AdminSearch,
  AdminSwitch,
  AdminTextField,
} from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-fields.jsx";
import { AdminFilterBar } from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-filter-bar.jsx";
import { AdminNotice } from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-notice.jsx";
import { AdminRefresh } from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-refresh.jsx";
import { AdminSection } from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-section.jsx";
import { AdminStatus } from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-status.jsx";
import { AdminTable } from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-table.jsx";
import { AdminTotals } from "../src/commerce-backend-ui-2/web-src/src/components/admin/admin-totals.jsx";
import { ErpIdentity } from "../src/commerce-backend-ui-2/web-src/src/components/admin/erp-identity.jsx";
import {
  LOG_CELLS,
  LOG_COLUMNS,
} from "../src/commerce-backend-ui-2/web-src/src/components/admin/log-cells.jsx";
import { eventRow } from "../src/commerce-backend-ui-2/web-src/src/history-view.js";
import {
  erpColors,
  erpStatusLine,
} from "../src/commerce-backend-ui-2/web-src/src/overview-view.js";
import { historyRecords, statusErps } from "./fake-records.js";

const NOTHING = () => undefined;
const OPTIONS = [
  { id: "all", label: "All types" },
  { id: "orders", label: "Orders" },
];
const REFRESH = { busy: false, onRefresh: NOTHING, updated: "just now" };
const COLUMNS = ["date", "time", "erp", "details", "record", "result"].map(
  (id) => LOG_COLUMNS[id],
);

/** One part, named, with its states beside each other. */
function Part({ children, name }) {
  return (
    <section className="gallery-part">
      <h2 className="gallery-name">{name}</h2>
      <div className="gallery-states">{children}</div>
    </section>
  );
}

function Buttons() {
  return (
    <Part name="AdminButton">
      <AdminButton onPress={NOTHING}>Default</AdminButton>
      <AdminButton onPress={NOTHING} variant="primary">
        Primary
      </AdminButton>
      <AdminButton onPress={NOTHING} variant="secondary">
        Secondary
      </AdminButton>
      <AdminButton onPress={NOTHING} variant="tertiary">
        Tertiary
      </AdminButton>
      <AdminButton isDisabled onPress={NOTHING}>
        Disabled
      </AdminButton>
    </Part>
  );
}

function Fields() {
  return (
    <Part name="Fields">
      <AdminSearch
        label="Search"
        onChange={NOTHING}
        placeholder="Search by keyword"
        value=""
      />
      <AdminSearch
        label="Search, filled"
        onChange={NOTHING}
        placeholder=""
        value="3000000023"
      />
      <AdminPicker
        label="Type"
        onChange={NOTHING}
        options={OPTIONS}
        value="all"
      />
      <AdminDateRange from="" onChange={NOTHING} to="" />
      <AdminDateRange from="2026-10-13" onChange={NOTHING} to="2026-10-14" />
      <AdminSwitch isSelected={false} onChange={NOTHING}>
        Off
      </AdminSwitch>
      <AdminSwitch isSelected onChange={NOTHING}>
        On
      </AdminSwitch>
      <AdminTextField
        label="Text"
        onChange={NOTHING}
        placeholder="UTC"
        value=""
      />
      <AdminTextField
        isDisabled
        label="Text, off"
        onChange={NOTHING}
        value="1000"
      />
      <AdminPicker
        isDisabled
        label="Type, off"
        onChange={NOTHING}
        options={OPTIONS}
        value="all"
      />
      <AdminCheckbox isSelected={false} onChange={NOTHING}>
        Use Default Value
      </AdminCheckbox>
      <AdminCheckbox isSelected onChange={NOTHING}>
        Use Default Value
      </AdminCheckbox>
    </Part>
  );
}

function Statuses() {
  return (
    <Part name="AdminStatus">
      <AdminStatus tone="ok">Done</AdminStatus>
      <AdminStatus tone="warn">Waiting</AdminStatus>
      <AdminStatus tone="bad">Failed</AdminStatus>
      <AdminStatus tone="neutral">Done</AdminStatus>
    </Part>
  );
}

function Refreshes() {
  return (
    <Part name="AdminRefresh">
      <AdminRefresh {...REFRESH} />
      <AdminRefresh {...REFRESH} busy />
      <AdminRefresh {...REFRESH} disabled updated="2 minutes ago" />
    </Part>
  );
}

function Identities({ erpInfo }) {
  return (
    <Part name="ErpIdentity">
      {erpInfo.erps.map((erp) => (
        <ErpIdentity
          colors={erpInfo.colors}
          erp={erp}
          key={erp.id}
          line={erpStatusLine(erp)}
        />
      ))}
      <ErpIdentity
        colors={erpInfo.colors}
        erp={{ id: "acme", name: "Acme ERP" }}
        line={{ reachable: true, text: "Connected" }}
      />
    </Part>
  );
}

const CHIPS = [
  { id: "type", label: "Type: Orders", onRemove: NOTHING },
  { id: "problems", label: "Problems only", onRemove: NOTHING },
];

function FilterBars() {
  const search = (
    <AdminSearch
      label="Search"
      onChange={NOTHING}
      placeholder="Search by keyword"
      value=""
    />
  );
  const fields = (
    <>
      <AdminDateRange from="" onChange={NOTHING} to="" />
      <AdminPicker
        label="Type"
        onChange={NOTHING}
        options={OPTIONS}
        value="all"
      />
    </>
  );
  const bar = {
    fields,
    onApply: NOTHING,
    onClearAll: NOTHING,
    onOpen: NOTHING,
    refresh: REFRESH,
    search,
  };
  return (
    <Part name="AdminFilterBar">
      <div className="gallery-wide">
        <AdminFilterBar {...bar} active={[]} />
        <AdminFilterBar {...bar} active={CHIPS} />
        <AdminFilterBar {...bar} active={[]} initiallyOpen />
      </div>
    </Part>
  );
}

function Tables({ erpInfo, now }) {
  const rows = useMemo(
    () =>
      historyRecords(false)
        .slice(0, 6)
        .map((entry) => eventRow(entry, { erps: erpInfo.erps, now })),
    [erpInfo.erps, now],
  );
  const cell = useCallback(
    (row, column) => LOG_CELLS[column](row, erpInfo),
    [erpInfo],
  );
  return (
    <Part name="AdminTable with the log's cells">
      <div className="gallery-wide">
        <AdminTable cell={cell} columns={COLUMNS} label="Log" rows={rows} />
        <AdminTable
          cell={cell}
          columns={COLUMNS}
          empty={<p className="adm-empty">Nothing matches these filters.</p>}
          label="Empty log"
          rows={[]}
        />
      </div>
    </Part>
  );
}

function Sections() {
  return (
    <Part name="AdminSection and AdminFacts">
      <div className="gallery-wide">
        <AdminSection actions={<span>5 problems</span>} title="Needs attention">
          <AdminFacts
            label="Order 3000000023"
            rows={[
              {
                label: "Number",
                values: [
                  "3000000023",
                  "Sales order 0000001013",
                  "Sales order 0000001002",
                ],
              },
              { label: "Status", values: ["Pending", "Confirmed", "Invoiced"] },
              {
                label: "Paid",
                values: ["1,859.00", "", "Payment P-0000000017"],
              },
            ]}
            sides={["Commerce", "Northwind ERP", "Contoso ERP"]}
          />
        </AdminSection>
        <AdminSection title="One column">
          <AdminFacts
            label="Northwind ERP"
            rows={[
              { label: "Status", values: ["Connected"] },
              { label: "Last update", values: ["2 minutes ago"] },
            ]}
          />
        </AdminSection>
      </div>
    </Part>
  );
}

function Totals() {
  return (
    <Part name="AdminTotals">
      <div className="gallery-wide">
        <AdminTotals
          items={[
            { label: "Orders sent today", value: 2 },
            { label: "Need attention, none", value: 0 },
            { label: "Need attention", tone: "bad", value: 5 },
            {
              foot: (
                <AdminButton onPress={NOTHING} variant="tertiary">
                  Last ran 2:05 PM
                </AdminButton>
              ),
              label: "With a foot",
              value: "3:05 PM",
            },
          ]}
          label="Totals"
        />
      </div>
    </Part>
  );
}

function Configuration() {
  return (
    <Part name="AdminConfigGroup and AdminConfigRow">
      <div className="gallery-wide adm-config">
        <AdminConfigGroup note="A group's note." title="A group">
          <AdminConfigRow
            comment="A comment under the field."
            label="A setting"
            more="Its longer text, behind the help button."
            scope="website"
            useDefault={
              <AdminCheckbox isSelected={false} onChange={NOTHING}>
                Use Default Value
              </AdminCheckbox>
            }>
            <AdminTextField label="A setting" onChange={NOTHING} value="1000" />
          </AdminConfigRow>
          <AdminConfigRow label="A setting with no box" scope="global">
            <AdminPicker
              label="A setting with no box"
              labelHidden
              onChange={NOTHING}
              options={OPTIONS}
              value="all"
            />
          </AdminConfigRow>
        </AdminConfigGroup>
      </div>
    </Part>
  );
}

function Notices() {
  return (
    <Part name="AdminNotice">
      <div className="gallery-wide">
        <AdminNotice>A notice: the price publish runs at 8:05 AM.</AdminNotice>
        <AdminNotice tone="warning">
          A warning: Contoso ERP is in maintenance.
        </AdminNotice>
        <AdminNotice tone="success">A success: settings saved.</AdminNotice>
        <AdminNotice tone="error">
          An error: Activity could not be read.
        </AdminNotice>
      </div>
    </Part>
  );
}

/** The gallery, in the page's own frame so the parts sit on the page's own styles. */
export function PartsGallery() {
  const now = useMemo(() => new Date(), []);
  const erpInfo = useMemo(() => {
    const erps = statusErps(false);
    return { colors: erpColors(erps), erps, several: true };
  }, []);
  return (
    <main className="erp-page parts-gallery">
      <Buttons />
      <Fields />
      <Statuses />
      <Refreshes />
      <Identities erpInfo={erpInfo} />
      <FilterBars />
      <Tables erpInfo={erpInfo} now={now} />
      <Sections />
      <Totals />
      <Configuration />
      <Notices />
    </main>
  );
}
