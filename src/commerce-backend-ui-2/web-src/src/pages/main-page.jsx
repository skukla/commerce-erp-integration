import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { use } from "react";

import { makeApi } from "#web/api.js";
import { Alert } from "#web/components/controls.jsx";
import { IntegrationPage } from "#web/components/integration-page.jsx";
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

/**
 * The integration's page in the Commerce Admin. Its first read SUSPENDS rather than drawing a
 * spinner of its own, so the Admin SDK's own loading boundary keeps ITS spinner up until the
 * page's data is in — one spinner for the whole load, no handoff. How the page looks is
 * IntegrationPage, which the local preview renders against stand-in data.
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
