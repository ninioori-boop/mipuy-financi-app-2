import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider, getToken, type AppCheck } from "firebase/app-check";

const firebaseConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim()!,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim()!,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim()!,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim()!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim()!,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim()!,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// App Check — attests that requests come from the real app, so Firestore and the
// API routes can reject scripted/forged traffic even when it carries a valid auth
// token. No-op until NEXT_PUBLIC_RECAPTCHA_SITE_KEY is set (task 0.4 registers the
// key) and only runs in the browser. Enforcement is enabled separately in the
// Firebase console (tasks 1.3 / 1.9), so adding this now cannot break anything live.
let appCheck: AppCheck | null = null;

if (typeof window !== "undefined") {
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY?.trim();
  const w = window as unknown as { __appCheckStarted?: boolean };
  if (siteKey && !w.__appCheckStarted) {
    w.__appCheckStarted = true;
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
}

/**
 * Returns a fresh App Check token to attach to API requests, or null if App Check
 * isn't initialized (no reCAPTCHA site key) or token retrieval fails. Never throws.
 */
export async function getAppCheckToken(): Promise<string | null> {
  if (!appCheck) return null;
  try {
    const { token } = await getToken(appCheck, /* forceRefresh */ false);
    return token;
  } catch {
    return null;
  }
}

export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
