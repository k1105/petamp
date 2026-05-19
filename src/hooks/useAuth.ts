import { useEffect, useState } from 'react'
import { subscribeAuth, type AppUser } from '../firebase/auth'

export function useAuth(): { user: AppUser | null; loading: boolean } {
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    return subscribeAuth(u => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  return { user, loading }
}
