import { useEffect, useState } from 'react';
import { Dimensions, Keyboard } from 'react-native';

/**
 * The on-screen keyboard's height while `active` (0 while it is hidden or `active` is false). A Modal window is not
 * resized for the keyboard, so overlays and sheets inside one lift themselves by this much. Measured from the
 * keyboard's top edge on screen: its reported height leaves out the navigation bar under it, which left fields
 * partly behind the keyboard. Tracked while mounted, so a sheet opened over an open keyboard knows its height.
 */
export function useKeyboardHeight(active = true): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      const fromTop = Dimensions.get('screen').height - event.endCoordinates.screenY;
      setHeight(Math.max(event.endCoordinates.height, fromTop));
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return active ? height : 0;
}
