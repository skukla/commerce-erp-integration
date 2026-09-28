import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
import { Alert } from "#web/components/controls.jsx";
import {
  IntegrationPage,
  PageLoading,
} from "#web/components/integration-page.jsx";
import { readFirst } from "#web/first-read.js";

/**
 * The integration's page in the Commerce Admin: everything it shows first is read together, and
 * nothing is drawn until all of it is in (first-read.js). How it looks is IntegrationPage,
 * which the local preview renders against stand-in data.
 */
export function MainPage() {
  const { data: ims, error: imsError } = useIms();
  const api = useMemo(() => (ims ? makeApi(ims) : null), [ims]);
  const [initial, setInitial] = useState(null);
  const [error, setError] = useState(null);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    if (!api) {
      return;
    }
    readFirst(api)
      .then((read) => {
        setInitial(read.initial);
        setError(read.trouble);
      })
      .catch((e) => setFailed(e.message));
  }, [api]);

  const cannot = imsError?.message ?? failed;
  if (cannot) {
    return (
      <div className="erp-page">
        <Alert title="The integration’s page could not load">{cannot}</Alert>
      </div>
    );
  }
  if (!initial) {
    return <PageLoading />;
  }
  return (
    <IntegrationPage
      api={api}
      error={error}
      initial={initial}
      onError={setError}
    />
  );
}
