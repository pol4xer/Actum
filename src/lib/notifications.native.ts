import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ID = 'daily-quest';

export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function enableDailyReminder(hour: number, minute: number, missionTitle?: string) {
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.granted ? existing.status : (await Notifications.requestPermissionsAsync()).status;

  if (status !== 'granted') {
    return false;
  }

  await Notifications.cancelAllScheduledNotificationsAsync();

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Миссия дня',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Миссия ждёт, путник',
      body: missionTitle ?? 'Открой Actum и сделай один честный шаг.',
      data: { route: '/' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
    },
  });

  return true;
}

export async function disableDailyReminder() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
