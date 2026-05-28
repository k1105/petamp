import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { deriveCodeChallenge, generateCodeVerifier, generateState } from './pkce'
import type { SpotifyAuth, SpotifyTokenResponse } from './types'

const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize'
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
const SCOPES = ['user-read-currently-playing', 'user-read-playback-state']

const VERIFIER_KEY = 'spotify.pkce.verifier'
const STATE_KEY = 'spotify.pkce.state'

// Custom URL scheme registered in ios/App/App/Info.plist (CFBundleURLSchemes).
// Spotify must have `com.rennur.petamp://spotify-callback` registered in its
// Developer Dashboard for the native flow to succeed.
const NATIVE_REDIRECT_URI = 'com.rennur.petamp://spotify-callback'

function clientId(): string {
  const id = import.meta.env.VITE_SPOTIFY_CLIENT_ID
  if (!id) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set')
  return id
}

// On Capacitor native, the WKWebView origin is capacitor://localhost which
// is unusable as a Spotify redirect URI. Use the custom URL scheme that the
// OS routes back into our app via `appUrlOpen` (handled in useSpotifyDeepLink).
export function redirectUri(): string {
  if (Capacitor.isNativePlatform()) return NATIVE_REDIRECT_URI
  return `${window.location.origin}/spotify-callback`
}

// Starts the OAuth flow. On web, navigates the current tab away to Spotify
// (returns via /spotify-callback route). On Capacitor native, opens the auth
// URL in the external Safari (so the in-app WKWebView isn't shown the
// accounts.spotify.com page) and waits for the deep link callback handled by
// useSpotifyDeepLink. The verifier+state survive across the bounce via
// localStorage (sessionStorage doesn't survive the WKWebView ↔ Safari ↔
// WKWebView round-trip on iOS).
export async function startLogin(): Promise<void> {
  const verifier = generateCodeVerifier()
  const challenge = await deriveCodeChallenge(verifier)
  const state = generateState()

  const storage = Capacitor.isNativePlatform() ? localStorage : sessionStorage
  storage.setItem(VERIFIER_KEY, verifier)
  storage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  })
  const url = `${AUTH_ENDPOINT}?${params.toString()}`
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url, presentationStyle: 'fullscreen' })
  } else {
    window.location.assign(url)
  }
}

// Handle the redirect back from Spotify. Returns the resolved auth tokens.
// Reads PKCE artifacts from both storages so it works regardless of which
// startLogin() variant stashed them.
export async function exchangeCodeForTokens(
  code: string,
  state: string,
): Promise<SpotifyAuth> {
  const expectedState =
    sessionStorage.getItem(STATE_KEY) ?? localStorage.getItem(STATE_KEY)
  const verifier =
    sessionStorage.getItem(VERIFIER_KEY) ?? localStorage.getItem(VERIFIER_KEY)
  sessionStorage.removeItem(STATE_KEY)
  sessionStorage.removeItem(VERIFIER_KEY)
  localStorage.removeItem(STATE_KEY)
  localStorage.removeItem(VERIFIER_KEY)

  if (!expectedState || expectedState !== state) {
    throw new Error('Spotify auth: state mismatch')
  }
  if (!verifier) {
    throw new Error('Spotify auth: missing code_verifier (session lost?)')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: clientId(),
    code_verifier: verifier,
  })

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Spotify token exchange failed (${res.status}): ${text}`)
  }
  const json = (await res.json()) as SpotifyTokenResponse
  if (!json.refresh_token) {
    throw new Error('Spotify token exchange: missing refresh_token')
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<SpotifyAuth> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId(),
  })
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Spotify token refresh failed (${res.status}): ${text}`)
  }
  const json = (await res.json()) as SpotifyTokenResponse
  return {
    accessToken: json.access_token,
    // Spotify may or may not rotate the refresh_token; keep old one when not returned.
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
}
