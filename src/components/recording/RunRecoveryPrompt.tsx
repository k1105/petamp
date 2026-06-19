import {useEffect, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {loadInProgressRun, clearInProgressRun, type InProgressRun} from "../../db/inProgressRun";
import {useResumeRunStore} from "../../store/useResumeRunStore";
import {useRunStore} from "../../store/useRunStore";
import {buildRunFromPoints} from "../../utils/run/finalizeRun";
import {totalDistance} from "../../utils/geo/geoUtils";
import {formatDate} from "../../utils/ui/formatters";
import {useBootReady} from "../../store/useBootStore";
import {AppModal} from "../ui/AppModal";

/**
 * 起動時に中断ラン (強制終了/クラッシュで途中終了した下書き) を検出し、
 * 「再開 / 保存して終了 / 破棄」を選ばせる。ホーム ('/') でのみ表示する。
 */
export function RunRecoveryPrompt() {
  const navigate = useNavigate();
  const location = useLocation();
  const bootReady = useBootReady();
  const addRun = useRunStore(s => s.addRun);
  const [draft, setDraft] = useState<InProgressRun | null>(null);
  const [busy, setBusy] = useState(false);

  // 起動完了後に 1 回だけ下書きを読み込む。
  useEffect(() => {
    if (!bootReady) return;
    let cancelled = false;
    void loadInProgressRun().then(d => {
      if (cancelled) return;
      if (d && d.trackPoints.length > 0) setDraft(d);
    });
    return () => {
      cancelled = true;
    };
  }, [bootReady]);

  // ホーム以外 (記録中・オンボーディング等) では出さない。
  if (!draft || location.pathname !== "/") return null;

  const distanceM = Math.round(totalDistance(draft.trackPoints));

  const handleResume = () => {
    useResumeRunStore.getState().setDraft(draft);
    setDraft(null);
    navigate("/record");
  };

  const handleSaveAndFinish = async () => {
    setBusy(true);
    try {
      const run = await buildRunFromPoints({
        id: draft.id,
        points: draft.trackPoints,
        movementType: draft.movementType,
      });
      await addRun(run);
      await clearInProgressRun();
      setDraft(null);
      navigate(`/run/${run.id}/result`);
    } catch (e) {
      console.error("recover save failed", e);
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    await clearInProgressRun();
    setDraft(null);
  };

  return (
    <AppModal
      title="中断したランがあります"
      stackedActions
      actions={[
        {label: "記録を再開", variant: "primary", onClick: handleResume, disabled: busy},
        {
          label: busy ? "保存中…" : "保存して終了",
          variant: "secondary",
          onClick: () => void handleSaveAndFinish(),
          disabled: busy,
        },
        {label: "破棄する", variant: "danger", onClick: () => void handleDiscard(), disabled: busy},
      ]}
    >
      {formatDate(draft.startedAt)} のラン（約 {distanceM} m）が途中で終了しています。どうしますか？
    </AppModal>
  );
}
