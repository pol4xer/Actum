import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

function canUseHaptics() {
  return Platform.OS !== 'web' && Device.isDevice;
}

export async function impact(style: Haptics.ImpactFeedbackStyle) {
  if (!canUseHaptics()) return;
  await Haptics.impactAsync(style).catch(() => undefined);
}

export async function notify(type: Haptics.NotificationFeedbackType) {
  if (!canUseHaptics()) return;
  await Haptics.notificationAsync(type).catch(() => undefined);
}

export { ImpactFeedbackStyle, NotificationFeedbackType } from 'expo-haptics';
