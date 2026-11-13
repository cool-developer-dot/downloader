/** B4 settings values (pure, shared by the settings store, Backup and the UI). */

export type AddressBarPosition = 'top' | 'bottom';
export const ADDRESS_BAR_POSITIONS: readonly AddressBarPosition[] = ['top', 'bottom'];
export const DEFAULT_ADDRESS_BAR_POSITION: AddressBarPosition = 'top';

export function normalizeAddressBarPosition(value: unknown): AddressBarPosition {
  return value === 'bottom' ? 'bottom' : 'top';
}
