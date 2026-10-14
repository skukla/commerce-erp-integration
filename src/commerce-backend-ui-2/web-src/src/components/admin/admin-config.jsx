/*
 * Stores > Configuration's own layout, for the Settings tab (owner, 2026-10-14: settings look
 * like the Admin's settings). Read from its source (magento/magento2 2.4-develop, backend
 * Magento_Backend module/main/_collapsible-blocks.less, Magento_Config _module.less, forms/fields
 * _control-collapsible.less, 2026-10-14) and drawn in styles/admin-skin.css:
 *
 * - a group is a collapsible block: a 17 px semibold title over a #ccc rule, its arrow on the
 *   right, the rows inside;
 * - a row is four cells in the Configuration form's order (Magento\Config\Block\System\Config
 *   \Form\Field::render): the label, right-aligned in 14 px semibold at 33%; the field at 44%
 *   with its comment in 12 px under it; "Use Default Value"; and the scope it is set at, grey
 *   12 px, as "[website]".
 *
 * Spectrum 2's Disclosure is the group (its keyboard and expanded state), ContextualHelp a
 * row's longer text, where the Admin has its tooltip.
 */

import { Content } from "@react-spectrum/s2/Content";
import { ContextualHelp } from "@react-spectrum/s2/ContextualHelp";
import {
  Disclosure,
  DisclosurePanel,
  DisclosureTitle,
} from "@react-spectrum/s2/Disclosure";

/**
 * @param {object} props
 * @param {string} props.title
 * @param {React.ReactNode} [props.note] a line before the rows ("Set by Demo Builder.")
 * @param {boolean} [props.closed] start folded: a group kept for reference, not for editing
 */
export function AdminConfigGroup({ children, closed = false, note, title }) {
  return (
    <Disclosure
      defaultExpanded={!closed}
      isQuiet
      UNSAFE_className="adm-config-group">
      <DisclosureTitle>{title}</DisclosureTitle>
      <DisclosurePanel>
        {note && <p className="adm-config-note">{note}</p>}
        <div className="adm-config-rows">{children}</div>
      </DisclosurePanel>
    </Disclosure>
  );
}

/**
 * @param {object} props
 * @param {string} props.label
 * @param {React.ReactNode} props.children the field
 * @param {string} [props.comment] the short line under the field
 * @param {string} [props.more] the longer text, behind the field's help button
 * @param {React.ReactNode} [props.useDefault] the "Use Default Value" box, where there is one
 * @param {string} [props.scope] where it is set: "global" or "website"
 * @param {string} [props.problem] why it cannot be saved: in the Admin's error red under the
 *   field, in the comment's place, as its form validation shows one
 */
export function AdminConfigRow({
  children,
  comment,
  label,
  more,
  problem,
  scope,
  useDefault,
}) {
  return (
    <div className="adm-config-row">
      <div className="adm-config-label">{label}</div>
      <div className="adm-config-value">
        <div className="adm-config-field">
          {children}
          {/* Held open when empty, so every row's field is one width. */}
          <span className="adm-config-help">
            {more && (
              <ContextualHelp aria-label={`More about ${label.toLowerCase()}`}>
                <Content>{more}</Content>
              </ContextualHelp>
            )}
          </span>
        </div>
        {problem ? (
          <p className="adm-config-problem" role="alert">
            {problem}
          </p>
        ) : (
          comment && <p className="adm-config-comment">{comment}</p>
        )}
      </div>
      <div className="adm-config-default">{useDefault}</div>
      <div className="adm-config-scope">{scope && `[${scope}]`}</div>
    </div>
  );
}
