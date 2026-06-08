import { EyesIcon } from './gallery/EyesIcon'

/** petamp の目と、その下の吹き出しで喋っているローディング表現。
 *  起動時 / ラン後 / island 待機 の各ローディング画面で共通利用する。 */
export function LoadingEyesBubble({ text }: { text: string }) {
  return (
    <div className="loading-eyes-bubble">
      <div className="loading-eyes-bubble-text">{text}</div>
      <div className="loading-eyes-bubble-eyes">
        <EyesIcon />
      </div>
    </div>
  )
}
