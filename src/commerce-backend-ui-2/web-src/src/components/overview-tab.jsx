/*
 * The Overview: is it working, and does anything need me? One search box that opens an order's
 * trace, a product or a company in the side panel; today's counts from Activity; one card per
 * ERP; and Needs attention, each with Retry. Filling and resetting the ERPs are Demo Builder's,
 * so this page has no Sync or Reset buttons.
 */
import { useCallback, useState } from "react";

import { Badge, erpStyle, RowErpChips } from "#web/components/controls.jsx";
import { SearchBox } from "#web/components/search-box.jsx";
import { needsAttention } from "#web/history-view.js";
import { erpCard, erpStatusLine, todayCounts } from "#web/overview-view.js";
import { publishLine } from "#web/scheduled-view.js";
import { clockTime, whenText } from "#web/time-view.js";

function Today({ counts, onOpen, publish }) {
  const openScheduled = useCallback(
    () => onOpen({ kind: "scheduled" }),
    [onOpen],
  );
  const tiles = [
    [counts.ordersSent, "Orders sent"],
    [counts.erpApplied, "ERP updates applied"],
    [counts.commerceSent, "Commerce changes sent"],
    [counts.notThrough, "Did not get through"],
  ];
  return (
    <section aria-labelledby="today-title" className="today">
      <h2 id="today-title">
        Today <span className="h-note">counted from Activity</span>
      </h2>
      <div className="tiles">
        {tiles.map(([n, label], index) => (
          <div className="tile" key={label}>
            <div className={index === 3 && n > 0 ? "n is-bad" : "n"}>{n}</div>
            <div className="l">{label}</div>
          </div>
        ))}
      </div>
      <div className="today-foot">
        <button className="band-link" onClick={openScheduled} type="button">
          Next price publish <strong>{publish.next}</strong> · {publish.last}
        </button>
      </div>
    </section>
  );
}

function ErpCardView({ card, erp, erpInfo, onShow }) {
  const line = erpStatusLine(erp);
  const showSettings = useCallback(
    () => onShow("settings", erp.id),
    [erp.id, onShow],
  );
  const showActivity = useCallback(
    () => onShow("activity", erp.id),
    [erp.id, onShow],
  );
  return (
    <article className="erp-card" style={erpStyle(erpInfo.colors, erp.id)}>
      <div>
        <h3>{erp.name}</h3>
        <div className={line.reachable ? "conn" : "conn warn"}>
          <span className={line.reachable ? "dot" : "dot warn"} />
          {line.card}
        </div>
      </div>
      <div className="links">
        <button className="btn btn-link" onClick={showSettings} type="button">
          Settings
        </button>
        <button className="btn btn-link" onClick={showActivity} type="button">
          Activity
        </button>
      </div>
      <dl className="erp-facts">
        <div>
          <dt>In the ERP</dt>
          <dd>{card.inErp}</dd>
        </div>
        <div>
          <dt>Last update from it</dt>
          <dd>{card.lastUpdate}</dd>
        </div>
        <div>
          <dt>Updates waiting to send</dt>
          <dd>{card.waiting}</dd>
        </div>
      </dl>
      <p className="erp-foot">{card.foot}</p>
    </article>
  );
}

function AttentionRow({ erpInfo, now, onOpen, onRetry, retrying, row }) {
  const retryThis = useCallback(() => onRetry(row), [onRetry, row]);
  const openThis = useCallback(
    () => onOpen({ ...row.open, row }),
    [onOpen, row],
  );
  return (
    <tr>
      <td className="what">
        <strong>{row.sentence}</strong>
        {row.detail && <span>{row.detail}</span>}
      </td>
      <td>
        <RowErpChips erpInfo={erpInfo} row={row} />
      </td>
      <td>
        <Badge tone={row.tone}>{row.result}</Badge>
      </td>
      <td className="when">{whenText(row.at, now)}</td>
      <td className="act">
        {row.retriable && (
          <button
            className="btn btn-secondary btn-small"
            disabled={retrying !== null}
            onClick={retryThis}
            type="button">
            {retrying === row.key ? "Retrying" : "Retry"}
          </button>
        )}
        <button className="btn btn-link" onClick={openThis} type="button">
          View
        </button>
      </td>
    </tr>
  );
}

function NeedsAttention({ erpInfo, now, onOpen, onRetry, retrying, rows }) {
  return (
    <section aria-labelledby="attn-title" className="attention">
      <div className="section-head">
        <h2 id="attn-title">Needs attention</h2>
        {rows.length > 0 && (
          <span className="meta">
            {rows.length} {rows.length === 1 ? "item" : "items"} · each is sent
            again by itself for up to a day, except what Commerce refused
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="all-clear">
          <div aria-hidden="true" className="tick">
            ✓
          </div>
          <div>
            <strong>Nothing needs attention</strong>
            <span>
              Every order reached its ERP, and every ERP update was applied.
            </span>
          </div>
        </div>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>What</th>
              <th>ERP</th>
              <th>Result</th>
              <th>Since</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AttentionRow
                erpInfo={erpInfo}
                key={row.key}
                now={now}
                onOpen={onOpen}
                onRetry={onRetry}
                retrying={retrying}
                row={row}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/**
 * @param {object} props
 * @param {object[]} props.history the Activity records (erp/history, every ERP's)
 * @param {object[]} props.runs the scheduled runs
 * @param {(target: object) => void} props.onOpen open the side panel
 * @param {(tab: string, erpId: string) => void} props.onShow a card's Settings and Activity
 */
export function OverviewTab({
  api,
  erpInfo,
  history,
  now,
  onChanged,
  onError,
  onOpen,
  onShow,
  runs,
}) {
  const [retrying, setRetrying] = useState(null);
  const retry = useCallback(
    async (row) => {
      setRetrying(row.key);
      try {
        await api.retry(row.retry);
        await onChanged();
      } catch (e) {
        onError(`Retry failed: ${e.message}`);
      }
      setRetrying(null);
    },
    [api, onChanged, onError],
  );
  const context = { erps: erpInfo.erps, now };
  const rows = needsAttention(history, context);
  return (
    <>
      <div className="ov-top">
        <SearchBox
          api={api}
          erpInfo={erpInfo}
          history={history}
          onOpen={onOpen}
        />
        <Today
          counts={todayCounts(history, now)}
          onOpen={onOpen}
          publish={publishLine(runs, now, (iso) => clockTime(iso))}
        />
      </div>
      <div className="erp-cards">
        {erpInfo.erps.map((erp) => (
          <ErpCardView
            card={erpCard(erp, history, now, undefined, {
              onlyErp: !erpInfo.several,
            })}
            erp={erp}
            erpInfo={erpInfo}
            key={erp.id}
            onShow={onShow}
          />
        ))}
      </div>
      <NeedsAttention
        erpInfo={erpInfo}
        now={now}
        onOpen={onOpen}
        onRetry={retry}
        retrying={retrying}
        rows={rows}
      />
      <section aria-labelledby="tools-title" className="tools">
        <h2 id="tools-title">Also in the integration</h2>
        <p>
          <strong>Move stock between warehouses</strong> starts from Catalog ›
          Products › Actions. It moves stock in Commerce and tells each
          product’s ERP at once.
        </p>
      </section>
    </>
  );
}
