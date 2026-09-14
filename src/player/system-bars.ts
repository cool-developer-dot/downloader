/**
 * System bars lifecycle for immersive fullscreen.
 * Always restore on exit / error / unmount.
 */

export type SystemBarsAdapter = {
  hide: () => Promise<void> | void;
  show: () => Promise<void> | void;
};

let activeAdapter: SystemBarsAdapter | null = null;
let immersive = false;
let transitionGen = 0;

export function configureSystemBarsAdapter(
  adapter: SystemBarsAdapter | null,
): void {
  activeAdapter = adapter;
}

export function isSystemBarsImmersive(): boolean {
  return immersive;
}

export async function enterImmersiveSystemBars(): Promise<void> {
  const gen = ++transitionGen;
  const adapter = activeAdapter;
  if (!adapter) {
    immersive = true;
    return;
  }
  try {
    await adapter.hide();
  } catch {
    // ignore
  }
  if (gen === transitionGen) {
    immersive = true;
  }
}

export async function exitImmersiveSystemBars(): Promise<void> {
  const gen = ++transitionGen;
  const adapter = activeAdapter;
  if (!adapter) {
    immersive = false;
    return;
  }
  try {
    await adapter.show();
  } catch {
    // ignore
  }
  if (gen === transitionGen) {
    immersive = false;
  }
}

export async function restoreSystemBars(): Promise<void> {
  await exitImmersiveSystemBars();
}

export function resetSystemBarsControllerForTests(): void {
  activeAdapter = null;
  immersive = false;
  transitionGen = 0;
}
