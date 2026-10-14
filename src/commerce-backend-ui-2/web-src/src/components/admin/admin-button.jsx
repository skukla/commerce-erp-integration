/*
 * The page's one button: Spectrum 2's ActionButton (its keyboard, focus and press behaviour)
 * dressed as a Commerce Admin button (styles/admin-skin.css), by the Admin's own names
 * (Magento backend web/css/source/_actions.less, read 2026-10-14):
 *
 *   default    grey (.action-default): Filters, Refresh, Retry
 *   primary    orange (.action-primary): the one main action of a screen (Save Config)
 *   secondary  dark brown (.action-secondary): Apply Filters
 *   tertiary   a link (.action-tertiary): Cancel, Clear all
 */
import { ActionButton } from "@react-spectrum/s2/ActionButton";

/**
 * @param {object} props
 * @param {"default"|"primary"|"secondary"|"tertiary"} [props.variant]
 * @param {() => void} props.onPress
 * @param {boolean} [props.isDisabled]
 * @param {string} [props.label] its name for a screen reader, when its text is not enough
 */
export function AdminButton({
  children,
  isDisabled = false,
  label,
  onPress,
  variant = "default",
  ...aria
}) {
  return (
    <ActionButton
      {...aria}
      aria-label={label}
      isDisabled={isDisabled}
      isQuiet={variant === "tertiary"}
      onPress={onPress}
      UNSAFE_className={`adm-btn adm-btn-${variant}`}>
      {children}
    </ActionButton>
  );
}
