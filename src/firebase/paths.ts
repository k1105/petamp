/**
 * Firestore パスビルダー。パス構造の定義はこのファイルに集約する
 * (firestore.rules / セキュリティルールと対応)。
 */
import type { CharacterId } from '../character/domain/character'

export const pathUser = (uid: string) => `users/${uid}`

export const pathUserRuns = (uid: string) => `users/${uid}/runs`
export const pathUserRun = (uid: string, runId: string) => `users/${uid}/runs/${runId}`

export const pathUserFcmTokens = (uid: string) => `users/${uid}/fcmTokens`
export const pathUserFcmToken = (uid: string, token: string) => `users/${uid}/fcmTokens/${token}`

export const pathFriends = () => 'friends'
export const pathFriend = (docId: string) => `friends/${docId}`

export const pathCoRuns = () => 'coRuns'
export const pathCoRun = (sessionId: string) => `coRuns/${sessionId}`

export const pathReport = (reportId: string) => `reports/${reportId}`

/** キャラ記憶のベース。kind = episodic | semantic | namedPlace、relational は単一 doc。 */
const pathCharacter = (uid: string, characterId: CharacterId) =>
  `users/${uid}/characters/${characterId}`
export const pathCharacterEpisodic = (uid: string, characterId: CharacterId, id: string) =>
  `${pathCharacter(uid, characterId)}/episodic/${id}`
export const pathCharacterEpisodicCol = (uid: string, characterId: CharacterId) =>
  `${pathCharacter(uid, characterId)}/episodic`
export const pathCharacterSemantic = (uid: string, characterId: CharacterId, id: string) =>
  `${pathCharacter(uid, characterId)}/semantic/${id}`
export const pathCharacterSemanticCol = (uid: string, characterId: CharacterId) =>
  `${pathCharacter(uid, characterId)}/semantic`
export const pathCharacterRelational = (uid: string, characterId: CharacterId) =>
  `${pathCharacter(uid, characterId)}/relational/state`
export const pathCharacterNamedPlace = (uid: string, characterId: CharacterId, id: string) =>
  `${pathCharacter(uid, characterId)}/namedPlace/${id}`
export const pathCharacterNamedPlaceCol = (uid: string, characterId: CharacterId) =>
  `${pathCharacter(uid, characterId)}/namedPlace`
