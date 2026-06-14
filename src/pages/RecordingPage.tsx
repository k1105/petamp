import {useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {Capacitor} from "@capacitor/core";
import {useGeolocationPermission} from "../hooks/useGeolocationPermission";
import {Icon} from "@iconify/react";
import {BaseMap} from "../components/map/BaseMap";
import {AreaLabel} from "../components/map/AreaLabel";
import {NowPlayingLabel} from "../components/map/NowPlayingLabel";
import {LiveStats} from "../components/recording/LiveStats";
import {BoundsFitter} from "../components/recording/BoundsFitter";
import {FollowUpdater} from "../components/recording/FollowUpdater";
import {RecordingLayers} from "../components/recording/RecordingLayers";
import {AnchorLayer} from "../components/recording/AnchorLayer";
import {AnchorPickerView} from "../components/recording/AnchorPickerView";
import {INITIAL_ZOOM} from "../components/recording/recordingMapConstants";
import {useGpsRecorder} from "../hooks/useGpsRecorder";
import {useCurrentPosition} from "../hooks/useCurrentPosition";
import {useActivePalette} from "../hooks/useActivePalette";
import {useRunStore} from "../store/useRunStore";
import {useSettingsStore} from "../store/useSettingsStore";
import {useTransitionStore} from "../store/useTransitionStore";
import {usePostRunLoadingStore} from "../store/usePostRunLoadingStore";
import {acceptedPoints, accuracyGate, warmupGate, minDistanceGate, maxSpeedGate} from "../utils/geo/recordingFilters";
import {fetchAreaName} from "../hooks/useReverseGeocode";
import {formatDate} from "../utils/ui/formatters";
import {fetchWeatherForCoords} from "../utils/fetchWeather";
import {RecordingDebugPanel} from "../components/recording/RecordingDebugPanel";
import {CoRunBanner} from "../components/corun/CoRunBanner";
import {CoRunWaitOverlay} from "../components/corun/CoRunWaitOverlay";
import {useCoRunStore} from "../store/useCoRunStore";
import {cloudSaveRunEnsured} from "../firebase/runCloud";
import {totalDistance, haversineDistance} from "../utils/geo/geoUtils";
import {useAnchorAudio} from "../hooks/useAnchorAudio";
import {isArrived} from "../utils/anchor/anchorAudio";
import {startLiveActivity, updateLiveActivity, endLiveActivity} from "../utils/liveActivity";
import {useResumeRunStore} from "../store/useResumeRunStore";
import {saveInProgressRun, clearInProgressRun} from "../db/inProgressRun";
import type {Run, TrackPoint} from "../types";

type ViewMode = "follow" | "overview";

export function RecordingPage() {
  const navigate = useNavigate();
  const radii = useSettingsStore(s => s.radii);
  const setRadii = useSettingsStore(s => s.setRadii);
  const resetRadii = useSettingsStore(s => s.resetRadii);
  const filterSettings = useSettingsStore(s => s.filterSettings);
  const setFilterSettings = useSettingsStore(s => s.setFilterSettings);
  const resetFilterSettings = useSettingsStore(s => s.resetFilterSettings);
  const filters = useMemo(
    () => [
      accuracyGate(15),
      warmupGate(3000),
      minDistanceGate(5),
      maxSpeedGate(filterSettings.maxSpeed),
    ],
    [filterSettings.maxSpeed],
  );
  const kalmanConfig = useMemo(
    () => ({
      sigmaA: filterSettings.kalmanSigmaA,
      gateChi2: filterSettings.kalmanGateChi2,
      fallbackVarianceM2: 400,
      initialVelVariance: 100,
    }),
    [filterSettings.kalmanSigmaA, filterSettings.kalmanGateChi2],
  );
  // 中断ランの再開: マウント時に下書きを snapshot し、即クリアする。
  const [resumeDraft] = useState(() => useResumeRunStore.getState().draft);
  useEffect(() => {
    useResumeRunStore.getState().setDraft(null);
  }, []);
  const {isRecording, trackPoints, error, consecutiveRejections, lastMahalanobis2, start, stop} = useGpsRecorder(
    filters,
    kalmanConfig,
    resumeDraft?.trackPoints ?? [],
  );
  // ラン ID。再開時は下書きの ID を引き継ぎ、新規は採番する。下書き保存と FINSH 両方で使う。
  const runIdRef = useRef(resumeDraft?.id ?? crypto.randomUUID());
  // 下書き保存のスロットル用。
  const lastDraftSaveRef = useRef(0);
  const {palette: livePalette} = useActivePalette();
  const {addRun} = useRunStore();
  const finishBtnRef = useRef<HTMLButtonElement>(null);
  const startPostRunLoading = usePostRunLoadingStore(s => s.start);
  const resetPostRunLoading = usePostRunLoadingStore(s => s.reset);
  const [recordingDebugOpen, setRecordingDebugOpen] = useState(false);
  const [showRawTube, setShowRawTube] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("follow");
  // 記録の移動種別。ラン開始前 (Gallery の armed 状態) で選んだ値を transition store
  // 経由で受け取り、FINISH 時に保存する。reset() で失われる前に snapshot する。
  // 再開時は下書きの種別を引き継ぐ。
  const [movementType] = useState(() => resumeDraft?.movementType ?? useTransitionStore.getState().movementType);
  const [warningOpen, setWarningOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const warningShownRef = useRef(false);
  const transitionPhase = useTransitionStore(s => s.phase);
  // マウント時点で flag を snapshot。reset() 後では失われるため。
  const [fromOnboarding] = useState(() => useTransitionStore.getState().fromOnboarding);
  // 「一緒に走る」セッション経由か。reset() で失われる前に snapshot する。
  const [coRunSessionId] = useState(() => useTransitionStore.getState().sessionId);
  const isCoRun = coRunSessionId !== null;
  const markRunning = useCoRunStore(s => s.markRunning);
  const markFinished = useCoRunStore(s => s.markFinished);
  const leaveCoRun = useCoRunStore(s => s.leave);
  // FINISH 後の終了ゲート待機。null でない間 CoRunWaitOverlay を出す。
  const [endGate, setEndGate] = useState<{origin: {x: number; y: number}; runId: string} | null>(null);
  // co-run でクラウド保存を保証できなかったとき (相手に軌跡を出せない) のエラー表示。
  const [coRunSaveError, setCoRunSaveError] = useState(false);

  // 録画開始時に自分の状態を 'running' にして、相手のバナー/待機画面に反映する。
  useEffect(() => {
    if (isCoRun) void markRunning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoRun]);

  // Web (非 native) で geolocation が拒否されているとランは始められない。
  // Permissions API の状態 変化を購読し、拒否時はモーダルで案内する。
  const permissionState = useGeolocationPermission();
  const isNative = Capacitor.isNativePlatform();
  const isPermissionDenied = !isNative && permissionState === "denied";

  // 入場時の円アニメーション（iris系phase）が終わって idle に戻ったタイミングで
  // popup を出す。onboarding 経由のときは初回チュートリアルを、それ以外は
  // 既存の「注意！」を表示する (2連打を避けるため排他)。注意モーダルは
  // バックグラウンド継続できる native アプリでは出さない (web のみ)。
  // 位置情報拒否時は許可案内モーダルが排他的に出るので、ここでは何も出さない。
  useEffect(() => {
    if (warningShownRef.current) return;
    if (transitionPhase !== "idle") return;
    if (permissionState === "unknown") return; // 権限状態の確定待ち
    if (isPermissionDenied) return;
    warningShownRef.current = true;
    // iris アニメ完了 (transitionPhase==='idle') の1ショットでのみ発火する。
    if (fromOnboarding) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIntroOpen(true);
    } else if (!isNative) {
      setWarningOpen(true);
    }
  }, [transitionPhase, fromOnboarding, permissionState, isPermissionDenied, isNative]);
  const initialCenter = useCurrentPosition();
  const acceptedTrackPoints = useMemo(() => acceptedPoints(trackPoints), [trackPoints]);

  // 目標アンカー (専用ビューで設置)。ライブのナビ機能なので永続化はしない。
  const [anchor, setAnchor] = useState<{lng: number; lat: number} | null>(null);
  // 設置ビュー (フルマップ) の開閉。
  const [pickerOpen, setPickerOpen] = useState(false);
  // ナビ用の現在地。フィルタ通過した採用点が無くても鳴らせるよう、
  // 採用点 → 生の最新点 → 初期位置 の順でフォールバックする。
  // (デスクトップ等で GPS 精度が悪いと採用点が 0 になり距離が出ないため)
  const anchorCurrentPos = useMemo<{lat: number; lng: number} | null>(() => {
    const accepted = acceptedTrackPoints.at(-1);
    if (accepted) return {lat: accepted.lat, lng: accepted.lng};
    const raw = trackPoints.at(-1);
    if (raw) return {lat: raw.lat, lng: raw.lng};
    if (initialCenter) return {lat: initialCenter[1], lng: initialCenter[0]};
    return null;
  }, [acceptedTrackPoints, trackPoints, initialCenter]);
  // 現在地 → アンカーの距離 (m)。現在地不明 / 未設置なら null。
  const anchorDistance = useMemo(() => {
    if (!anchor || !anchorCurrentPos) return null;
    return haversineDistance(
      anchorCurrentPos as TrackPoint,
      {lat: anchor.lat, lng: anchor.lng} as TrackPoint,
    );
  }, [anchor, anchorCurrentPos]);
  const anchorArrived = anchorDistance != null && isArrived(anchorDistance);
  const {resume: resumeAnchorAudio} = useAnchorAudio(anchorDistance);

  // 設置ビューの初期中心: 現在地 → 既存アンカー → 地図初期中心 の順で採用。
  const pickerCenter = useMemo<[number, number]>(() => {
    const last = acceptedTrackPoints.at(-1);
    if (last) return [last.lng, last.lat];
    if (anchor) return [anchor.lng, anchor.lat];
    return initialCenter ?? [139.6503, 35.6762];
  }, [acceptedTrackPoints, anchor, initialCenter]);

  // 設置ボタン: AudioContext/ネイティブセッションの解除はジェスチャ内で起動するが、
  // 失敗・遅延しても設置ビューの表示を妨げないよう fire-and-forget にする。
  // (await すると resume が reject/ハングしたとき picker が開かず「ボタンが押せない」状態になる)
  const handleAnchorButton = () => {
    void resumeAnchorAudio().catch(() => {});
    setPickerOpen(true);
  };
  const handleAnchorConfirm = (lng: number, lat: number) => {
    setAnchor({lng, lat});
    setPickerOpen(false);
  };
  const clearAnchor = () => {
    setAnchor(null);
  };
  // ライブアクティビティ用の安定したラン ID。マウント中ずっと同じ値を使う。
  const liveActivityRunIdRef = useRef(crypto.randomUUID());
  // ライブアクティビティの直近更新時刻 (OS の更新バジェット枯渇を避けてスロットルする)。
  const lastLiveActivityUpdateRef = useRef(0);
  // 背景に使うテーマカラー。effect 内で最新値を参照するため ref に同期する。
  const liveActivityBgRef = useRef(livePalette.bg);
  // eslint-disable-next-line react-hooks/refs
  liveActivityBgRef.current = livePalette.bg;

  // 位置情報が拒否されていない場合だけ記録を開始する。
  // 途中で拒否に切り替わったら cleanup の stop() で停止する。
  useEffect(() => {
    if (isPermissionDenied) return;
    start();
    void startLiveActivity(liveActivityRunIdRef.current, [], 0, liveActivityBgRef.current);
    return () => {
      stop();
      void endLiveActivity();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPermissionDenied]);

  // 軌跡が伸びるたびにライブアクティビティを更新する。約 5 秒に 1 回へスロットル。
  useEffect(() => {
    if (!isRecording) return;
    const now = Date.now();
    if (now - lastLiveActivityUpdateRef.current < 5000) return;
    lastLiveActivityUpdateRef.current = now;
    void updateLiveActivity(acceptedTrackPoints, totalDistance(acceptedTrackPoints), liveActivityBgRef.current);
  }, [acceptedTrackPoints, isRecording]);

  // 走行中の軌跡を逐次ローカル保存する (ソロのみ)。アプリ強制終了/クラッシュ時に
  // 次回起動で復元できるようにする。約 4 秒に 1 回へスロットル。co-run は対象外。
  useEffect(() => {
    if (!isRecording || isCoRun) return;
    if (acceptedTrackPoints.length === 0) return;
    const now = Date.now();
    if (now - lastDraftSaveRef.current < 4000) return;
    lastDraftSaveRef.current = now;
    void saveInProgressRun({
      id: runIdRef.current,
      startedAt: acceptedTrackPoints[0].timestamp,
      updatedAt: now,
      trackPoints: acceptedTrackPoints,
      movementType,
    });
  }, [acceptedTrackPoints, isRecording, isCoRun, movementType]);

  const handleFinish = async () => {
    // FINISH を起点に iris-out → ローディング画面で覆い、対話準備完了で iris-in で抜ける。
    // origin は FINISH ボタン中心。取得できなければ画面下端中央にフォールバック。
    const rect = finishBtnRef.current?.getBoundingClientRect();
    const origin = rect
      ? {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}
      : {x: window.innerWidth / 2, y: window.innerHeight - 80};
    // 一緒に走るモードでは「全員のゴール待ち」を先に挟むので、緑のローディングは
    // ゲートが開いてから出す。ソロは従来どおり即座に覆う。
    if (!isCoRun) startPostRunLoading(origin);

    let points = trackPoints;
    if (isRecording) {
      points = await stop();
    }
    void endLiveActivity();
    // FINISH したので中断ラン下書きは破棄する (空・通常どちらの経路でも)。
    void clearInProgressRun();
    if (points.length === 0) {
      // 記録が空のときは対話画面に進まないので loading を解除して戻す。
      if (isCoRun) void leaveCoRun();
      else resetPostRunLoading();
      navigate("/");
      return;
    }
    const lats = points.map(p => p.lat);
    const lngs = points.map(p => p.lng);
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const [areaNameRaw, weatherRaw] = await Promise.all([
      fetchAreaName(centerLng, centerLat),
      fetchWeatherForCoords(centerLat, centerLng),
    ]);
    const areaName = areaNameRaw ?? undefined;
    const weather = weatherRaw ?? "sunny";
    const run: Run = {
      id: runIdRef.current,
      name: `ラン ${formatDate(Date.now())}`,
      startedAt: points[0].timestamp,
      finishedAt: points.at(-1)!.timestamp,
      trackPoints: points,
      notes: [],
      areaName,
      weather,
      movementType,
    };
    if (isCoRun && coRunSessionId) {
      // この session のランだと印を付ける。一覧で 1 タイルに統合し、合成リプレイで参照する。
      run.coRunSessionId = coRunSessionId;
      const s = useCoRunStore.getState().session;
      if (s) {
        run.coRunParticipants = s.memberUids.map(uid => ({
          uid,
          displayName: s.members[uid]?.displayName ?? null,
        }));
      }
    }
    await addRun(run);
    if (isCoRun && coRunSessionId) {
      // 終了ゲート前に、自分のランをクラウドへ「確実に」保存する。
      // co-run では相手の端末が users/{uid}/runs/{runId} を読んで軌跡を再生するので、
      // ここで保存を保証してから runId を公開しないと、相手側で軌跡が出ない
      // (best-effort の addRun は失敗を握りつぶすため別経路で担保する)。
      try {
        await cloudSaveRunEnsured(run);
      } catch (e) {
        console.error("co-run cloud save failed", e);
        if (isRecording) void stop();
        resetPostRunLoading();
        setCoRunSaveError(true);
        return;
      }
      // 自分のゴールを記録し、全員ゴールするまで待機オーバーレイで待つ。
      await markFinished(run.id);
      setEndGate({origin, runId: run.id});
      return;
    }
    navigate(`/run/${run.id}/result`);
  };

  return (
    <div className="page">
      {isCoRun && <CoRunBanner />}
      <div className="map-container">
        {initialCenter !== undefined && (
          <BaseMap
            initialCenter={initialCenter ?? undefined}
            initialZoom={INITIAL_ZOOM}
            interactive={false}
          >
            <BoundsFitter
              trackPoints={acceptedTrackPoints}
              enabled={viewMode === "overview"}
            />
            <FollowUpdater
              trackPoints={acceptedTrackPoints}
              enabled={viewMode === "follow"}
            />
            <RecordingLayers
              trackPoints={trackPoints}
              acceptedTrackPoints={acceptedTrackPoints}
              fallbackPosition={initialCenter ?? null}
              radii={radii}
              showRawTube={showRawTube}
            />
            <AnchorLayer anchor={anchor} arrived={anchorArrived} />
            <AreaLabel />
            <NowPlayingLabel />
          </BaseMap>
        )}
      </div>

      <button
        className="back-btn"
        onClick={() => {
          // X は記録を破棄して戻る操作なので、中断ラン下書きも消す。
          void clearInProgressRun();
          navigate("/");
        }}
        aria-label="閉じる"
      >
        <Icon icon="lucide:x" />
      </button>

      <button
        className="debug-btn"
        onClick={() => setRecordingDebugOpen(true)}
        title="記録デバッグ"
        aria-label="記録デバッグ"
      >
        <Icon icon="lucide:braces" />
      </button>

      <div className="bottom-bar">
        {error && <div className="error-banner">{error}</div>}
        <button
          className="view-mode-toggle"
          onClick={() => setViewMode(m => (m === "follow" ? "overview" : "follow"))}
          title={viewMode === "follow" ? "全体表示" : "現在位置"}
          aria-label={viewMode === "follow" ? "全体表示に切り替え" : "現在位置に切り替え"}
        >
          <Icon icon={viewMode === "follow" ? "lucide:maximize" : "lucide:locate-fixed"} />
        </button>

        <div className="anchor-control">
          <button
            className={`anchor-toggle${anchor ? " is-set" : ""}`}
            onClick={handleAnchorButton}
            title="目標アンカーを設置"
            aria-label="目標アンカーを設置"
          >
            <Icon icon="lucide:target" />
          </button>
          {anchor && (
            <div className={`anchor-status${anchorArrived ? " is-arrived" : ""}`}>
              <span className="anchor-distance">
                {anchorArrived
                  ? "到達！"
                  : anchorDistance != null
                    ? `${Math.round(anchorDistance)} m`
                    : "計測中…"}
              </span>
              <button
                className="anchor-clear"
                onClick={clearAnchor}
                title="アンカーを解除"
                aria-label="アンカーを解除"
              >
                <Icon icon="lucide:trash-2" />
              </button>
            </div>
          )}
        </div>

        <LiveStats trackPoints={acceptedTrackPoints} />
        <div className="bottom-bar-actions">
          <button
            className="toggle-btn"
            onClick={isRecording ? stop : start}
            aria-label={isRecording ? "停止" : "再開"}
          >
            <Icon icon={isRecording ? "lucide:pause" : "lucide:play"} />
          </button>
          <button ref={finishBtnRef} className="finish-btn" onClick={handleFinish}>
            <span>FINISH</span>
          </button>
        </div>
      </div>

      {isPermissionDenied && (
        <div className="chat-modal-backdrop" role="dialog" aria-modal="true">
          <div className="chat-modal recording-warning">
            <p className="recording-warning-title">位置情報の許可が必要です</p>
            <p className="chat-modal-text">
              ペタンプはランの軌跡を記録するために位置情報を使用します。
              現在ブラウザ側でブロックされているため、記録を開始できません。
            </p>
            <p className="chat-modal-text">
              アドレスバー左の鍵 / 情報アイコンから「位置情報」を「許可」に変更し、ページを再読み込みしてください。
            </p>
            <div className="chat-modal-actions">
              <button
                className="chat-modal-btn chat-modal-btn-primary"
                onClick={() => navigate("/")}
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {warningOpen && !isPermissionDenied && (
        <div className="chat-modal-backdrop" role="dialog" aria-modal="true">
          <div className="chat-modal recording-warning">
            <p className="recording-warning-title">注意！</p>
            <p className="chat-modal-text">
              ブラウザ版では、記録中に画面をオフにしたりアプリを切り替えると、レコーディングが停止してしまいます。
            </p>
            <div className="chat-modal-actions">
              <button
                className="chat-modal-btn chat-modal-btn-primary"
                onClick={() => setWarningOpen(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {introOpen && (
        <div className="chat-modal-backdrop" role="dialog" aria-modal="true">
          <div className="chat-modal recording-intro">
            <p className="chat-modal-text">
              このアプリは、速く走るためのものではありません。
            </p>
            <p className="chat-modal-text">
              歩いても、走っても、休んでも大丈夫です。あなたのペースで進んでください。
            </p>
            <p className="chat-modal-text">
              動いたぶんだけ、ペタンプのセカイが広がっていきます。
            </p>
            <p className="chat-modal-text">
              終わるときは、下の "FINISH" を押してください。
            </p>
            <div className="chat-modal-actions">
              <button
                className="chat-modal-btn chat-modal-btn-primary"
                onClick={() => {
                  setIntroOpen(false);
                  // intro を閉じた直後に通常の注意モーダルへ繋ぐ。
                  setWarningOpen(true);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {recordingDebugOpen && (
        <RecordingDebugPanel
          trackPoints={trackPoints}
          consecutiveRejections={consecutiveRejections}
          lastMahalanobis2={lastMahalanobis2}
          radii={radii}
          onChangeRadii={setRadii}
          onResetRadii={resetRadii}
          filterSettings={filterSettings}
          onChangeFilterSettings={setFilterSettings}
          onResetFilterSettings={resetFilterSettings}
          showRawTube={showRawTube}
          onToggleRawTube={setShowRawTube}
          onClose={() => setRecordingDebugOpen(false)}
        />
      )}

      {coRunSaveError && (
        <div className="chat-modal-backdrop" role="dialog" aria-modal="true">
          <div className="chat-modal recording-warning">
            <p className="recording-warning-title">保存に失敗しました</p>
            <p className="chat-modal-text">
              通信が不安定で、一緒に走った記録をクラウドに保存できませんでした。
              電波の良い場所でもう一度お試しください。
            </p>
            <div className="chat-modal-actions">
              <button
                className="chat-modal-btn chat-modal-btn-primary"
                onClick={() => {
                  setCoRunSaveError(false);
                  void leaveCoRun();
                  navigate("/");
                }}
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {pickerOpen && (
        <AnchorPickerView
          initialCenter={pickerCenter}
          onCancel={() => setPickerOpen(false)}
          onConfirm={handleAnchorConfirm}
        />
      )}

      {endGate && (
        <CoRunWaitOverlay
          onProceed={() => {
            // 全員ゴール (or 自己タイムアウト) → 個別ラン画面で N 人分の軌跡を合成再生する。
            // co-run セッションはここではクリアしない (合成再生が members を使う)。
            // 専用画面は廃止し、RunDetailPage をライブモード (coRunLive) で開く。
            navigate(`/run/${endGate.runId}`, {
              state: { coRunLive: true, myRunId: endGate.runId },
            });
          }}
        />
      )}
    </div>
  );
}
