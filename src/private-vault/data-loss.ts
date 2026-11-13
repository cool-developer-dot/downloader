/**
 * The data-loss warning of Private (#459). Pure. Private videos live only on this phone, encrypted with a key that
 * never leaves it: uninstalling VidoraX or clearing its data loses them for good — there is no backup and no
 * recovery. Every move says so; the very first move cannot go ahead until the user ticks "I understand", the same
 * pattern as the App Lock recovery code.
 */

export type MoveConfirmGate = {
  /** Show the "I understand" box (only until it was ticked once). */
  showAcknowledgement: boolean;
  /** Whether "Move to Private" may be pressed now. */
  canConfirm: boolean;
};

export function moveConfirmGate(input: { acknowledged: boolean; ticked: boolean; busy: boolean }): MoveConfirmGate {
  return {
    showAcknowledgement: !input.acknowledged,
    canConfirm: !input.busy && (input.acknowledged || input.ticked),
  };
}

/** Which notice the Private screen shows: the full warning until the first move was acknowledged, then a reminder. */
export function dataLossNotice(acknowledged: boolean): 'full' | 'compact' {
  return acknowledged ? 'compact' : 'full';
}
