import { getUid } from './auth'
import { deleteDocument, getDocument, listDocuments, setDocument } from './firestoreAdapter'
import { pathFriend, pathFriends } from './paths'

export type FriendDoc = {
  members: [string, string]
  createdAt: number
}

/**
 * 相互フレンドの doc ID。UID を辞書順でソートし `${minUid}__${maxUid}` で正規化。
 * これにより A→B と B→A が同じ doc になり、書込み 1 回で整合性が保たれる。
 */
function friendDocId(uidA: string, uidB: string): string {
  const [lo, hi] = uidA < uidB ? [uidA, uidB] : [uidB, uidA]
  return `${lo}__${hi}`
}

export async function addFriend(otherUid: string): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  if (uid === otherUid) throw new Error('cannot add self as friend')
  const id = friendDocId(uid, otherUid)
  const [lo, hi] = uid < otherUid ? [uid, otherUid] : [otherUid, uid]
  const data: FriendDoc = {
    members: [lo, hi],
    createdAt: Date.now(),
  }
  await setDocument(pathFriend(id), data)
}

export async function removeFriend(otherUid: string): Promise<void> {
  const uid = await getUid()
  if (!uid) throw new Error('not signed in')
  await deleteDocument(pathFriend(friendDocId(uid, otherUid)))
}

export async function isFriendWith(otherUid: string): Promise<boolean> {
  const uid = await getUid()
  if (!uid) return false
  const data = await getDocument<FriendDoc>(pathFriend(friendDocId(uid, otherUid)))
  return data != null
}

export async function listMyFriends(): Promise<FriendDoc[]> {
  const uid = await getUid()
  if (!uid) return []
  const friends = await listDocuments<FriendDoc>(pathFriends(), [
    { fieldPath: 'members', opStr: 'array-contains', value: uid },
  ])
  return friends.filter(f => Array.isArray(f.members) && f.members.length === 2)
}

/**
 * 自分のフレンド UID 一覧 (自分自身を除く相手側 UID)。
 */
export async function listMyFriendUids(): Promise<string[]> {
  const uid = await getUid()
  if (!uid) return []
  const friends = await listMyFriends()
  return friends.map(f => (f.members[0] === uid ? f.members[1] : f.members[0]))
}
