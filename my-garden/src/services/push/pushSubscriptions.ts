// src/services/push/pushSubscriptions.ts
// Subscribes/unsubscribes this browser for background push notifications —
// "3 plants need water today" delivered even when the app isn't open. A
// Postgres cron job calls supabase/functions/send-due-notifications once a
// day, which reads every subscription in `push_subscriptions` and sends to
// each. Uses the service worker's own PushManager, so it only works once
// the SW has registered (same registration UpdatePrompt.tsx already
// drives via useRegisterSW) and its custom push/notificationclick handlers
// are in place (see src/sw.ts).

import { supabase } from '../../lib/supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    Boolean(VAPID_PUBLIC_KEY)
  );
}

/** Push subscriptions need the VAPID public key as a raw byte array, not
 *  the base64url string it's distributed as. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i);
  return bytes;
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

/** Requests permission (if needed), subscribes via the service worker, and
 *  saves the subscription so the daily send job can reach this browser.
 *  Throws with a message suitable for direct display on denial/failure. */
export async function subscribeToPush(userId: string): Promise<void> {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted.');
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
    });
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Subscription is missing required fields.');
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
    { onConflict: 'user_id,endpoint' },
  );
  if (error) throw error;
}

/** Unsubscribes this browser and removes its saved subscription. Silent
 *  no-op if push isn't supported or nothing was subscribed. */
export async function unsubscribeFromPush(userId: string): Promise<void> {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);
}
