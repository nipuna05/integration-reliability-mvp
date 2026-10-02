// Asks Android for notification permission and returns this phone's Expo push token.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function registerForPush() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw new Error('Phone alerts only work in the installed phone app, not in a web browser.');
  if (!Device.isDevice) throw new Error('Push notifications only work on a real phone, not in an emulator.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Check alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') throw new Error('Notification permission was refused. Allow notifications for this app in your phone settings.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('This build has no Expo project id, so it cannot register for push.');
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return { token: data, label: `${Device.manufacturer ?? ''} ${Device.modelName ?? 'phone'}`.trim() };
}
