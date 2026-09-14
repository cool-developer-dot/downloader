export type StackAnimation =
  | 'default'
  | 'fade'
  | 'fade_from_bottom'
  | 'flip'
  | 'simple_push'
  | 'slide_from_bottom'
  | 'slide_from_right'
  | 'slide_from_left'
  | 'none';

export type StackPresentation =
  | 'card'
  | 'modal'
  | 'transparentModal'
  | 'containedModal'
  | 'containedTransparentModal'
  | 'fullScreenModal'
  | 'formSheet';

export type StackScreenOptions = {
  animation?: StackAnimation;
  gestureEnabled?: boolean;
  headerBackTitleVisible?: boolean;
  headerShadowVisible?: boolean;
  headerShown?: boolean;
  headerTransparent?: boolean;
  headerStyle?: {
    backgroundColor?: string;
  };
  headerTintColor?: string;
  headerTitle?: string;
  headerTitleStyle?: {
    color?: string;
  };
  presentation?: StackPresentation;
  title?: string;
  contentStyle?: {
    backgroundColor?: string;
  };
};

export type ModalScreenOptions = StackScreenOptions & {
  presentation: Extract<StackPresentation, 'modal' | 'transparentModal' | 'containedModal' | 'fullScreenModal' | 'formSheet'>;
};

export type TabScreenOptions = {
  title?: string;
  tabBarLabel?: string;
  tabBarActiveTintColor?: string;
  tabBarInactiveTintColor?: string;
  headerShown?: boolean;
};
