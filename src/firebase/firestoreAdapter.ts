/**
 * Firestore 操作の Capacitor (native) / web SDK 両対応を一元化するアダプタ。
 *
 * ここ以外のファイルは Capacitor.isNativePlatform() で分岐しないこと。
 * パスは `users/${uid}/runs/${id}` 形式のスラッシュ区切り文字列 (paths.ts 参照)。
 * native プラグインが Record<string, unknown> を要求するための型キャストも
 * このファイル内に閉じ込める。
 */
import { Capacitor } from '@capacitor/core'
import { FirebaseFirestore } from '@capacitor-firebase/firestore'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import { db } from './client'

/** 現状アプリで使う演算子のみ。増やすときは native 側 compositeFilter の対応も確認する。 */
export interface WhereFilter {
  fieldPath: string
  opStr: '==' | 'array-contains'
  value: unknown
}

function docRef(path: string) {
  const parts = path.split('/')
  return doc(db, parts[0], ...parts.slice(1))
}

function colRef(path: string) {
  const parts = path.split('/')
  return collection(db, parts[0], ...parts.slice(1))
}

function nativeCompositeFilter(filters: WhereFilter[]) {
  return {
    type: 'and' as const,
    queryConstraints: filters.map(f => ({
      type: 'where' as const,
      fieldPath: f.fieldPath,
      opStr: f.opStr,
      value: f.value,
    })),
  }
}

export async function setDocument<T extends object>(path: string, data: T): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.setDocument({
      reference: path,
      data: data as unknown as Record<string, unknown>,
    })
    return
  }
  await setDoc(docRef(path), data)
}

/** dot-path フィールド更新 (`members.${uid}.state` など)。他フィールドを潰さない。 */
export async function updateDocument(path: string, fields: Record<string, unknown>): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.updateDocument({ reference: path, data: fields })
    return
  }
  await updateDoc(docRef(path), fields)
}

export async function deleteDocument(path: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await FirebaseFirestore.deleteDocument({ reference: path })
    return
  }
  await deleteDoc(docRef(path))
}

export async function getDocument<T>(path: string): Promise<T | null> {
  if (Capacitor.isNativePlatform()) {
    const { snapshot } = await FirebaseFirestore.getDocument({ reference: path })
    return (snapshot?.data ?? null) as T | null
  }
  const snap = await getDoc(docRef(path))
  return snap.exists() ? (snap.data() as T) : null
}

export async function listDocuments<T>(path: string, filters?: WhereFilter[]): Promise<T[]> {
  if (Capacitor.isNativePlatform()) {
    const { snapshots } = await FirebaseFirestore.getCollection({
      reference: path,
      ...(filters?.length ? { compositeFilter: nativeCompositeFilter(filters) } : {}),
    })
    return snapshots.map(s => s.data as unknown as T).filter((v): v is T => v != null)
  }
  const constraints: QueryConstraint[] = (filters ?? []).map(f =>
    where(f.fieldPath, f.opStr, f.value),
  )
  const snap = constraints.length
    ? await getDocs(query(colRef(path), ...constraints))
    : await getDocs(colRef(path))
  return snap.docs.map(d => d.data() as T).filter((v): v is T => v != null)
}

/**
 * 単一 doc のリアルタイム購読。戻り値で購読解除。
 * エラーは console.error にログして購読は継続する (従来挙動)。
 */
export function subscribeDocument<T>(
  path: string,
  cb: (data: T | null) => void,
  label = 'doc listener',
): () => void {
  if (Capacitor.isNativePlatform()) {
    let callbackId: string | null = null
    let removed = false
    void FirebaseFirestore.addDocumentSnapshotListener(
      { reference: path },
      (event, error) => {
        if (error) {
          console.error(`${label} error`, error)
          return
        }
        cb((event?.snapshot.data ?? null) as T | null)
      },
    ).then(cid => {
      callbackId = cid
      if (removed) void FirebaseFirestore.removeSnapshotListener({ callbackId: cid })
    })
    return () => {
      removed = true
      if (callbackId) void FirebaseFirestore.removeSnapshotListener({ callbackId })
    }
  }
  return onSnapshot(
    docRef(path),
    snap => cb(snap.exists() ? (snap.data() as T) : null),
    err => console.error(`${label} error`, err),
  )
}

/** コレクションのリアルタイム購読 (where フィルタ付き)。戻り値で購読解除。 */
export function subscribeCollection<T>(
  path: string,
  filters: WhereFilter[],
  cb: (items: T[]) => void,
  label = 'collection listener',
): () => void {
  if (Capacitor.isNativePlatform()) {
    let callbackId: string | null = null
    let removed = false
    void FirebaseFirestore.addCollectionSnapshotListener(
      {
        reference: path,
        ...(filters.length ? { compositeFilter: nativeCompositeFilter(filters) } : {}),
      },
      (event, error) => {
        if (error) {
          console.error(`${label} error`, error)
          return
        }
        const items = (event?.snapshots ?? [])
          .map(s => s.data as unknown as T)
          .filter((v): v is T => v != null)
        cb(items)
      },
    ).then(cid => {
      callbackId = cid
      if (removed) void FirebaseFirestore.removeSnapshotListener({ callbackId: cid })
    })
    return () => {
      removed = true
      if (callbackId) void FirebaseFirestore.removeSnapshotListener({ callbackId })
    }
  }
  const constraints = filters.map(f => where(f.fieldPath, f.opStr, f.value))
  const q = constraints.length ? query(colRef(path), ...constraints) : colRef(path)
  return onSnapshot(
    q,
    snap => cb(snap.docs.map(d => d.data() as T).filter((v): v is T => v != null)),
    err => console.error(`${label} error`, err),
  )
}
