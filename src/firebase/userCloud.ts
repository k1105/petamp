import { Capacitor } from '@capacitor/core'
import { FirebaseFirestore } from '@capacitor-firebase/firestore'
import {
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore'
import { db } from './client'
import type { AppUser } from './auth'

export type PublicUser = {
  uid: string
  displayName: string | null
  photoURL: string | null
  email: string | null
  createdAt: number
  updatedAt: number
}

function sanitize(value: unknown): unknown {
  if (value === undefined) return null
  return value
}

export async function ensureUserDoc(user: AppUser): Promise<void> {
  const ref = `users/${user.uid}`
  const now = Date.now()
  let createdAt = now

  if (Capacitor.isNativePlatform()) {
    const { snapshot } = await FirebaseFirestore.getDocument({ reference: ref })
    const existing = snapshot.data as Partial<PublicUser> | null | undefined
    if (existing && typeof existing.createdAt === 'number') createdAt = existing.createdAt
  } else {
    const snap = await getDoc(doc(db, 'users', user.uid))
    if (snap.exists()) {
      const existing = snap.data() as Partial<PublicUser>
      if (typeof existing.createdAt === 'number') createdAt = existing.createdAt
    }
  }

  const data: PublicUser = {
    uid: user.uid,
    displayName: (sanitize(user.displayName) as string | null) ?? null,
    photoURL: (sanitize(user.photoURL) as string | null) ?? null,
    email: (sanitize(user.email) as string | null) ?? null,
    createdAt,
    updatedAt: now,
  }

  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.setDocument({
      reference: ref,
      data: data as unknown as Record<string, unknown>,
    })
    return
  }
  await setDoc(doc(db, 'users', user.uid), data)
}

export async function getUserDoc(uid: string): Promise<PublicUser | null> {
  if (Capacitor.isNativePlatform()) {
    const { snapshot } = await FirebaseFirestore.getDocument({ reference: `users/${uid}` })
    return (snapshot.data as PublicUser | null | undefined) ?? null
  }
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? (snap.data() as PublicUser) : null
}
