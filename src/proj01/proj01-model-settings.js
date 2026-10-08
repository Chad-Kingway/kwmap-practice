// 共用已套用比例；輸入草稿留在介面，不直接修改此狀態。
export function createModelSettings({ initialScale, redraw }) {
  let appliedScale = initialScale;
  const models = new Set();
  const canApply = () => models.size > 0 && [...models].every(({ isBusy }) => !isBusy());
  return {
    get appliedScale() { return appliedScale; },
    canApply,
    register({ id, model, initialScale: baseScale, isBusy }) {
      // 後續模型依自己的建立基準，沿用最後一次全部成功的全域設定。
      if (appliedScale !== baseScale) {
        model.setScale(appliedScale / baseScale);
        redraw();
      }
      const entry = { id, model, baseScale, isBusy };
      models.add(entry);
      return () => models.delete(entry);
    },
    apply(scale) {
      if (!Number.isFinite(scale) || scale < 0.1 || scale > 1000) throw new Error("請輸入有效模型比例（0.1～1000）。");
      if (!canApply()) throw new Error("模型尚未就緒或接送中，無法套用比例。");
      const errors = [];
      for (const { id, model, baseScale } of models) {
        try { model.setScale(scale / baseScale); }
        catch (error) { errors.push(`${id}：${error.message || String(error)}`); }
      }
      // 即使部分失敗，也呈現已修改的模型；不宣稱全部成功或更新全域已套用值。
      redraw();
      if (errors.length) throw new Error(`模型比例未全部套用：${errors.join("；")}`);
      appliedScale = scale;
    },
    clear() { models.clear(); },
  };
}
