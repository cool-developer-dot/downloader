export function formatResolution(
  width: number | null | undefined,
  height: number | null | undefined,
): string | null {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return `${Math.round(width)}x${Math.round(height)}`;
}

export function computeAspectRatio(
  width: number | null | undefined,
  height: number | null | undefined,
): number | null {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return Number((width / height).toFixed(4));
}

export function sanitizeFiniteNumber(
  value: unknown,
  options?: { min?: number; max?: number },
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  if (options?.min != null && value < options.min) {
    return null;
  }

  if (options?.max != null && value > options.max) {
    return null;
  }

  return value;
}
