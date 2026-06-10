import type { AppUser } from './auth'
import { getDocument, setDocument } from './firestoreAdapter'
import { pathUser } from './paths'

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
  const now = Date.now()
  const existing = await getDocument<Partial<PublicUser>>(pathUser(user.uid))
  const createdAt =
    existing && typeof existing.createdAt === 'number' ? existing.createdAt : now

  const data: PublicUser = {
    uid: user.uid,
    displayName: (sanitize(user.displayName) as string | null) ?? null,
    photoURL: (sanitize(user.photoURL) as string | null) ?? null,
    email: (sanitize(user.email) as string | null) ?? null,
    createdAt,
    updatedAt: now,
  }

  await setDocument(pathUser(user.uid), data)
}

export async function getUserDoc(uid: string): Promise<PublicUser | null> {
  return getDocument<PublicUser>(pathUser(uid))
}
