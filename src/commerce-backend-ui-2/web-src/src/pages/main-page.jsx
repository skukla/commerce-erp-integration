import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { Heading, InlineAlert, Text } from "@react-spectrum/s2";
import { useEffect, useMemo, useState } from "react";

import { makeApi } from "#web/api.js";
import {
  IntegrationPage,
  PageLoading,
} from "#web/components/integration-page.jsx";

/**
 * The integration's page in the Commerce Admin: the sign-in, the status and the settings,
 * read together, and nothing drawn until all of them are in (owner, 2026-09-27: a half-loaded
 * page showed "the ERP" and "Reading the settings…"). The website list is read from Commerce
 * again on every open (owner, 2026-09-26), so there is no Refresh button. How it looks is
 * IntegrationPage, which the local preview renders against stand-in data.
 */
export function MainPage() {
  const { data: ims, error: imsError } = useIms();
  const api = useMemo(() => (ims ? makeApi(ims) : null), [ims]);
  const [status, setStatus] = useState(null);
  const [settingsPage, setSettingsPage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!api) {
      return;
    }
    Promise.all([api.status(), api.settings(undefined, { refresh: true })])
      .then(([statusAnswer, page]) => {
        setStatus(statusAnswer);
        setSettingsPage(page);
      })
      .catch((e) => setError(e.message));
  }, [api]);

  const failed = imsError?.message ?? (status && settingsPage ? null : error);
  if (failed) {
    return (
      <InlineAlert variant="negative">
        <Heading>The integration's page could not load</Heading>
        <Text>{failed}</Text>
      </InlineAlert>
    );
  }
  if (!(status && settingsPage)) {
    return <PageLoading />;
  }
  return (
    <IntegrationPage
      api={api}
      error={error}
      onError={setError}
      scopes={settingsPage.scopes}
      scopesNote={settingsPage.scopesNote ?? null}
      settingsPage={settingsPage}
      status={status}
    />
  );
}
