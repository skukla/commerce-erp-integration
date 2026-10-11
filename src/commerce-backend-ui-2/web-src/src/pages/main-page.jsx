import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { Suspense, use } from "react";

import { makeApi } from "#web/api.js";
import { Alert } from "#web/components/controls.jsx";
import {
  IntegrationPage,
  PageLoading,
} from "#web/components/integration-page.jsx";
import { readFirst } from "#web/first-read.js";

/*
 * use() needs the SAME promise across a component's render attempts, so the first read is cached
 * by the IMS credentials it was built from. It never rejects: a hard failure resolves to
 * { failed } and MainPage draws the Alert, which keeps the error out of the SDK's error boundary.
 */
let cache = { ims: null, promise: null };
function firstRead(ims) {
  if (cache.ims !== ims) {
    const api = makeApi(ims);
    cache = {
      ims,
      promise: readFirst(api).then(
        (read) => ({ api, error: read.trouble, initial: read.initial }),
        (e) => ({ failed: e.message }),
      ),
    };
  }
  return cache.promise;
}

/** The page once its first read is in; it suspends until then. */
function LoadedPage({ ims }) {
  const outcome = use(firstRead(ims));
  if (outcome.failed) {
    return (
      <div className="erp-page">
        <Alert title="The integration’s page could not load">
          {outcome.failed}
        </Alert>
      </div>
    );
  }
  return (
    <IntegrationPage
      api={outcome.api}
      initial={outcome.initial}
      initialError={outcome.error}
    />
  );
}

/**
 * The integration's page in the Commerce Admin. Its first read suspends under a boundary of the
 * page's OWN, which draws the same centered Spectrum spinner the Admin SDK draws while it
 * connects, in the same place: one spinner for the whole load.
 *
 * The boundary has to be here. The SDK draws the page through a TanStack router Outlet, and the
 * root route's Outlet wraps the page in a Suspense whose fallback is the router's pending
 * component (@tanstack/react-router Match.js, `fallback: renderPending(router)`). The SDK sets
 * none, so that fallback is null: a page that suspended straight into it showed a blank white
 * frame for the whole first read, after the SDK's spinner (measured 2026-10-11, SDK 1.1.0).
 * How the page looks is IntegrationPage, which the local preview renders against stand-in data.
 */
export function MainPage() {
  const { data: ims, error: imsError } = useIms();
  if (imsError) {
    return (
      <div className="erp-page">
        <Alert title="The integration’s page could not load">
          {imsError.message}
        </Alert>
      </div>
    );
  }
  return (
    <Suspense fallback={<PageLoading />}>
      <LoadedPage ims={ims} />
    </Suspense>
  );
}
