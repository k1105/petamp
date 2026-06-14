import { Capacitor } from '@capacitor/core'
import {
  FirebaseAuthentication,
  type User as NativeUser,
} from '@capacitor-firebase/authentication'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User as WebUser,
} from 'firebase/auth'
import { auth } from './client'

export type AppUser = {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
}

function fromWeb(u: WebUser): AppUser {
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
  }
}

function fromNative(u: NativeUser): AppUser {
  return {
    uid: u.uid,
    email: u.email ?? null,
    displayName: u.displayName ?? null,
    photoURL: u.photoUrl ?? null,
  }
}

/**
 * 現在のサインイン UID。未サインインなら null。
 * (旧 runCloud / coRunCloud / friends / characterCloud に重複していた実装の共有版)
 */
export async function getUid(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    const { user } = await FirebaseAuthentication.getCurrentUser()
    return user?.uid ?? null
  }
  await auth.authStateReady()
  return auth.currentUser?.uid ?? null
}

/** 現在のユーザーの Firebase ID トークン。未サインインなら null。 */
export async function getIdToken(): Promise<string | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { token } = await FirebaseAuthentication.getIdToken()
      return token ?? null
    } catch {
      return null
    }
  }
  await auth.authStateReady()
  return (await auth.currentUser?.getIdToken()) ?? null
}

const provider = new GoogleAuthProvider()

export async function signInWithGoogle(): Promise<AppUser> {
  if (Capacitor.isNativePlatform()) {
    const result = await FirebaseAuthentication.signInWithGoogle()
    if (!result.user) throw new Error('Google sign-in did not return user')
    return fromNative(result.user)
  }
  const result = await signInWithPopup(auth, provider)
  return fromWeb(result.user)
}

export async function signOutUser(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseAuthentication.signOut()
    return
  }
  await signOut(auth)
}

export function subscribeAuth(cb: (user: AppUser | null) => void): () => void {
  if (Capacitor.isNativePlatform()) {
    let cancelled = false
    void FirebaseAuthentication.getCurrentUser().then(({ user }) => {
      if (cancelled) return
      cb(user ? fromNative(user) : null)
    })
    const handle = FirebaseAuthentication.addListener('authStateChange', change => {
      cb(change.user ? fromNative(change.user) : null)
    })
    return () => {
      cancelled = true
      void handle.then(h => h.remove())
    }
  }
  return onAuthStateChanged(auth, u => cb(u ? fromWeb(u) : null))
}
