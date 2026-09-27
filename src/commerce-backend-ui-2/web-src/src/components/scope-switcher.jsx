/*
 * The scope the Settings section edits, the way Commerce's own configuration pages show it:
 * "Scope:" beside a list of Default Config and the websites, and, when the merchant has
 * changes not yet saved, Commerce's own question before switching ("All data that hasn't
 * been saved will be lost"). Store views are not offered (settings-view.js, websiteChoices).
 */
import {
  AlertDialog,
  DialogContainer,
  Picker,
  PickerItem,
} from "@react-spectrum/s2";
import { useCallback, useState } from "react";

import { websiteChoices } from "#web/settings-view.js";

export function ScopeSwitcher({
  hasUnsavedChanges,
  onChange,
  scopeId,
  scopes,
}) {
  const [asked, setAsked] = useState(null);
  const choices = websiteChoices(scopes);

  const pick = useCallback(
    (key) => {
      const next = String(key);
      if (next === scopeId) {
        return;
      }
      if (hasUnsavedChanges) {
        setAsked(next);
        return;
      }
      onChange(next);
    },
    [hasUnsavedChanges, onChange, scopeId],
  );
  const confirm = useCallback(() => {
    onChange(asked);
    setAsked(null);
  }, [asked, onChange]);
  const cancel = useCallback(() => setAsked(null), []);

  return (
    <>
      <Picker
        items={choices}
        label="Scope"
        labelPosition="side"
        onSelectionChange={pick}
        selectedKey={scopeId}>
        {(choice) => <PickerItem id={choice.id}>{choice.label}</PickerItem>}
      </Picker>
      <DialogContainer onDismiss={cancel}>
        {asked !== null && (
          <AlertDialog
            cancelLabel="Cancel"
            onCancel={cancel}
            onPrimaryAction={confirm}
            primaryActionLabel="OK"
            title="Scope switcher"
            variant="confirmation">
            Please confirm scope switching. All data that hasn't been saved will
            be lost.
          </AlertDialog>
        )}
      </DialogContainer>
    </>
  );
}
