import type { Character, CharacterId } from '../domain/character'
import { petampCharacter } from './petamp'

export { petampCharacter } from './petamp'

const registry = new Map<CharacterId, Character>([
  [petampCharacter.id, petampCharacter],
])

export function resolveCharacter(id: CharacterId): Character {
  const c = registry.get(id)
  if (!c) throw new Error(`Unknown character: ${id}`)
  return c
}
