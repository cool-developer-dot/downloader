import { memo } from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import type { PlatformBrandIconProps } from './types';

const S = 24;

export const YouTubeBrandIcon = memo(function YouTubeBrandIcon({ size = S }: PlatformBrandIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M23.5 7.2a3.02 3.02 0 0 0-2.12-2.14C19.4 4.5 12 4.5 12 4.5s-7.4 0-9.38.56A3.02 3.02 0 0 0 .5 7.2 31.8 31.8 0 0 0 0 12a31.8 31.8 0 0 0 .5 4.8 3.02 3.02 0 0 0 2.12 2.14c1.98.56 9.38.56 9.38.56s7.4 0 9.38-.56a3.02 3.02 0 0 0 2.12-2.14A31.8 31.8 0 0 0 24 12a31.8 31.8 0 0 0-.5-4.8z"
        fill="#FF0000"
      />
      <Path d="M9.75 8.85v6.3L15.9 12 9.75 8.85z" fill="#FFFFFF" />
    </Svg>
  );
});

export const InstagramBrandIcon = memo(function InstagramBrandIcon({ size = S }: PlatformBrandIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="platformHubIg" x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#F58529" />
          <Stop offset="0.35" stopColor="#DD2A7B" />
          <Stop offset="0.7" stopColor="#8134AF" />
          <Stop offset="1" stopColor="#515BD4" />
        </LinearGradient>
      </Defs>
      <Path
        d="M7.2 2.75h9.6A4.45 4.45 0 0 1 21.25 7.2v9.6a4.45 4.45 0 0 1-4.45 4.45H7.2A4.45 4.45 0 0 1 2.75 16.8V7.2A4.45 4.45 0 0 1 7.2 2.75z"
        fill="url(#platformHubIg)"
      />
      <Circle cx="12" cy="12" r="4.15" stroke="#FFFFFF" strokeWidth="1.75" fill="none" />
      <Circle cx="16.85" cy="7.15" r="1.2" fill="#FFFFFF" />
    </Svg>
  );
});

export const TikTokBrandIcon = memo(function TikTokBrandIcon({ size = S }: PlatformBrandIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M16.2 3.4v9.35a4.55 4.55 0 1 1-3.15-4.35V6.35c.95-.2 1.9-.25 2.85-.15.1 1.85.95 3.45 2.4 4.4.45.3.95.5 1.45.6V8.7c-.55-.15-1.05-.4-1.45-.7A5.2 5.2 0 0 1 16.2 3.4z"
        fill="#25F4EE"
        opacity={0.55}
      />
      <Path
        d="M15.35 4.05v9.35a4.55 4.55 0 1 1-3.15-4.35V7c.95-.2 1.9-.25 2.85-.15.1 1.85.95 3.45 2.4 4.4.45.3.95.5 1.45.6V9.35c-.55-.15-1.05-.4-1.45-.7a5.2 5.2 0 0 1-2.1-4.6z"
        fill="#FE2C55"
        opacity={0.55}
      />
      <Path
        d="M15.75 3.7v9.35a4.55 4.55 0 1 1-3.15-4.35V6.65c.95-.2 1.9-.25 2.85-.15.1 1.85.95 3.45 2.4 4.4.45.3.95.5 1.45.6V9c-.55-.15-1.05-.4-1.45-.7A5.2 5.2 0 0 1 15.75 3.7z"
        fill="#F8FAFC"
      />
    </Svg>
  );
});

export const FacebookBrandIcon = memo(function FacebookBrandIcon({ size = S }: PlatformBrandIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" fill="#1877F2" />
      <Path
        d="M14.05 8.1h2.5V5.3h-2.55c-2.5 0-4.15 1.5-4.15 4.25v1.9H7.55v2.8h2.3V20.7h3v-6.45h2.55l.5-2.8h-3.05v-1.8c0-.9.35-1.55 1.2-1.55z"
        fill="#FFFFFF"
      />
    </Svg>
  );
});

export const VimeoBrandIcon = memo(function VimeoBrandIcon({ size = S }: PlatformBrandIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M21.15 8.2c-.08 1.95-1.45 4.65-4.1 8.1-2.75 3.55-5.1 5.35-7.05 5.35-1.2 0-2.2-1.1-3.05-3.35L5.5 14.7c.6 1.35 1.15 2.05 1.75 2.05.55 0 1.3-.8 2.25-2.4.95-1.55 2.55-6.85 3.05-8.55.2-.7 0-1-.55-.55 1.15-1.3 2.15-1.95 3-.1.95 0 1.4.75 1.35 2.25 0 .55-.05 1.15-.15 1.75.85-.25 1.4-.75 1.65-1.45.2-.55.1-1.05-.3-1.45.8.05 1.3.4 1.5 1.1.15.5.15 1.05.05 1.55z"
        fill="#1AB7EA"
      />
    </Svg>
  );
});

/** Dailymotion — blue tile + white play mark */
export const DailymotionBrandIcon = memo(function DailymotionBrandIcon({
  size = S,
}: PlatformBrandIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="2.5" y="4" width="19" height="16" rx="3.2" fill="#0066DC" />
      <Path d="M10.2 8.4v7.2L16.8 12 10.2 8.4z" fill="#FFFFFF" />
    </Svg>
  );
});

/** Reddit — orange disc + alien mark (promotional hub only). */
export const RedditBrandIcon = memo(function RedditBrandIcon({ size = S }: PlatformBrandIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" fill="#FF4500" />
      <Circle cx="9.2" cy="12.2" r="1.35" fill="#FFFFFF" />
      <Circle cx="14.8" cy="12.2" r="1.35" fill="#FFFFFF" />
      <Path
        d="M8.4 14.6c1.1 1.15 2.3 1.7 3.6 1.7s2.5-.55 3.6-1.7"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx="16.6" cy="8.2" r="1.1" fill="#FFFFFF" />
      <Path d="M14.8 9.1l1.2-2.2" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  );
});
