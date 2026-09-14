import { spacing, type SpacingToken } from '@/theme/spacing';

import type { BoxSpacingProps, SpacingValue } from './types';

function resolveSpacing(value: SpacingValue | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  return spacing[value as SpacingToken];
}

export function resolveBoxSpacing({
  p,
  px,
  py,
  pt,
  pr,
  pb,
  pl,
  m,
  mx,
  my,
  mt,
  mr,
  mb,
  ml,
  gap,
}: BoxSpacingProps) {
  const padding = resolveSpacing(p);
  const paddingHorizontal = resolveSpacing(px);
  const paddingVertical = resolveSpacing(py);

  return {
    padding,
    paddingHorizontal: paddingHorizontal ?? padding,
    paddingVertical: paddingVertical ?? padding,
    paddingTop: resolveSpacing(pt) ?? paddingVertical ?? padding,
    paddingRight: resolveSpacing(pr) ?? paddingHorizontal ?? padding,
    paddingBottom: resolveSpacing(pb) ?? paddingVertical ?? padding,
    paddingLeft: resolveSpacing(pl) ?? paddingHorizontal ?? padding,
    margin: resolveSpacing(m),
    marginHorizontal: resolveSpacing(mx) ?? resolveSpacing(m),
    marginVertical: resolveSpacing(my) ?? resolveSpacing(m),
    marginTop: resolveSpacing(mt) ?? resolveSpacing(my) ?? resolveSpacing(m),
    marginRight: resolveSpacing(mr) ?? resolveSpacing(mx) ?? resolveSpacing(m),
    marginBottom: resolveSpacing(mb) ?? resolveSpacing(my) ?? resolveSpacing(m),
    marginLeft: resolveSpacing(ml) ?? resolveSpacing(mx) ?? resolveSpacing(m),
    gap: resolveSpacing(gap),
  };
}
