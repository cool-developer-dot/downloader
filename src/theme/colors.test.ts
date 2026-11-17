import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { colors, designPalettes, type ThemeMode } from './colors';
import { resolveIntroColors } from './intro-palette';
import { resolveOnboardingSurfaces } from './onboarding-surfaces';
import { THEME_PREFERENCES } from './theme-preference';

/**
 * The colours of `VidoraX-6-Themes-65-Screens.pdf`, read from its vector data (page fill, card fill, row divider,
 * icon-tile fill, toggle-off fill, primary-button fill, title / secondary text colour, the blocked-count green).
 * A theme that drifts from its frames fails here.
 */
const MEASURED: Record<ThemeMode, { page: string; card: string; divider: string; tile: string; switchOff: string; accent: string; text: string; textSecondary: string; success: string }> = {
  light: { page: '#FAF9FB', card: '#FFFFFF', divider: '#EDEDF0', tile: '#FDECEA', switchOff: '#D6D5DB', accent: '#D92D20', text: '#16161A', textSecondary: '#6B6B76', success: '#12B76A' },
  dark: { page: '#121214', card: '#1D1D20', divider: '#2C2C31', tile: '#3B1D1B', switchOff: '#46464D', accent: '#E5382B', text: '#F4F4F6', textSecondary: '#9C9CA6', success: '#34D399' },
  red: { page: '#FDF1EF', card: '#FFF9F8', divider: '#F2D8D4', tile: '#FBE0DC', switchOff: '#D6D5DB', accent: '#D92D20', text: '#2A1210', textSecondary: '#8A5E59', success: '#12B76A' },
  cream: { page: '#FBF6EC', card: '#FFFDF8', divider: '#EEE3D0', tile: '#F8E3D6', switchOff: '#D6D5DB', accent: '#C8321F', text: '#2B2118', textSecondary: '#8A7B6A', success: '#12B76A' },
  midnight: { page: '#0D1424', card: '#151D31', divider: '#232D47', tile: '#3A1F2B', switchOff: '#3A4565', accent: '#FF4A3D', text: '#EAF0FF', textSecondary: '#8F9BB8', success: '#3DDC97' },
  blush: { page: '#FFF5F7', card: '#FFFFFF', divider: '#F8DDE3', tile: '#FFE1E7', switchOff: '#D6D5DB', accent: '#E0313F', text: '#3A1A22', textSecondary: '#94626D', success: '#12B76A' },
};

describe('design themes', () => {
  test('every preference has a theme and the themes are the six of the PDF', () => {
    assert.deepEqual(Object.keys(colors), [...THEME_PREFERENCES]);
    assert.deepEqual(Object.keys(designPalettes), [...THEME_PREFERENCES]);
  });

  for (const mode of THEME_PREFERENCES) {
    test(`${mode}: the measured colours of its frames`, () => {
      const c = colors[mode];
      const m = MEASURED[mode];
      assert.equal(c.background, m.page);
      assert.equal(c.card, m.card);
      assert.equal(c.divider, m.divider);
      assert.equal(c.track, m.divider);
      assert.equal(c.accentSoft, m.tile);
      assert.equal(c.switchOff, m.switchOff);
      assert.equal(c.primary, m.accent);
      assert.equal(c.textPrimary, m.text);
      assert.equal(c.textSecondary, m.textSecondary);
      assert.equal(c.success, m.success);
      assert.equal(c.textOnPrimary, '#FFFFFF');
    });
  }

  test('only Red paints the header and the bottom bar as an accent band with white text', () => {
    for (const mode of THEME_PREFERENCES) {
      const c = colors[mode];
      if (mode === 'red') {
        assert.equal(c.headerStyle, 'band');
        assert.equal(c.headerBackground, '#D92D20');
        assert.equal(c.headerText, '#FFFFFF');
        assert.equal(c.bottomNavBackground, '#D92D20');
        assert.equal(c.bottomNavActive, '#FFFFFF');
        assert.notEqual(c.bottomNavActivePill, 'transparent');
        assert.equal(c.statusBarStyle, 'light');
      } else {
        assert.equal(c.headerStyle, 'flat');
        assert.equal(c.headerBackground, c.background);
        assert.equal(c.headerText, c.textPrimary);
        assert.equal(c.bottomNavBackground, c.card);
        assert.equal(c.bottomNavActive, c.primary);
        assert.equal(c.bottomNavActivePill, 'transparent');
      }
    }
  });

  test('Dark and Midnight are the dark themes: light status-bar text; the rest dark text', () => {
    assert.equal(colors.dark.statusBarStyle, 'light');
    assert.equal(colors.midnight.statusBarStyle, 'light');
    for (const mode of ['light', 'cream', 'blush'] as const) {
      assert.equal(colors[mode].statusBarStyle, 'dark');
    }
  });

  test('intro and onboarding follow each theme', () => {
    for (const mode of THEME_PREFERENCES) {
      const intro = resolveIntroColors(mode);
      assert.equal(intro.background, colors[mode].background);
      assert.equal(intro.accent, colors[mode].primary);
      const surfaces = resolveOnboardingSurfaces(mode);
      assert.equal(surfaces.title, colors[mode].textPrimary);
      assert.equal(surfaces.titleAccent, colors[mode].primary);
    }
  });
});
