import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.rennur.petamp',
  appName: 'petamp',
  webDir: 'dist',
  // JS の console.log を常にネイティブ (Xcode) ログへ出す。
  // デフォルト 'debug' は Release ビルドでログが出ないため 'production' にする。
  loggingBehavior: 'production',
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
    FirebaseMessaging: {
      presentationOptions: ['alert', 'badge', 'sound'],
    },
  },
}

export default config
