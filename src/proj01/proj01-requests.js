export function mountRequestList(container) {
  // 預製座標不預先保證道路可用性，路線載入狀態與接送狀態分開管理。
  const requests = [
    { id: "request-01", origin: [121.561, 25.0334], destination: [121.567, 25.034], color: "#175cd3", status: "pending" },
    { id: "request-02", origin: [121.543, 25.041], destination: [121.553, 25.045], color: "#15803d", status: "pending" },
    { id: "request-03", origin: [121.517, 25.047], destination: [121.532, 25.052], color: "#c2410c", status: "pending" },
  ];
  let selectedRequestId = null;
  const selectionListeners = new Set();
  const changeListeners = new Set();
  const statusLabels = { pending: "等待接送", assigned: "準備接送", pickingUp: "前往接人", onboard: "乘車中", completed: "已完成" };
  const routeStates = new Map();
  const routeLabels = { loading: "路線查詢中…", ready: "", unavailable: "路線不可用", error: "路線查詢失敗" };
  const render = () => {
    container.innerHTML = requests.map((request, index) => `
      <label class="proj01-request">
        <input type="radio" name="proj01-request" value="${request.id}" ${selectedRequestId === request.id ? "checked" : ""}>
        <span class="proj01-request-content">
          <span class="proj01-request-heading"><span class="proj01-request-color" style="background-color: ${request.color}" aria-hidden="true"></span><strong>需求 ${String(index + 1).padStart(2, "0")}</strong><span data-request-status="${request.id}" class="proj01-request-status" role="status">${statusLabels[request.status]}</span></span>
          <span class="proj01-request-coordinate">起點 ${request.origin.join(", ")}</span>
          <span class="proj01-request-coordinate">終點 ${request.destination.join(", ")}</span>
          <span data-request-route="${request.id}" class="proj01-request-route-status" role="status">${routeLabels[routeStates.get(request.id)?.status] ?? ""}</span>
        </span>
      </label>
    `).join("");
  };
  const selectById = (id) => {
    if (!requests.some((request) => request.id === id)) return;
    if (selectedRequestId === id) return;
    selectedRequestId = id;
    // 只更新 checked，不重建 radio 或移動鍵盤焦點。
    for (const request of requests) {
      const radio = container.querySelector(`input[value="${request.id}"]`);
      if (radio) radio.checked = request.id === id;
    }
    for (const listener of selectionListeners) listener(selectedRequestId);
  };
  const select = (event) => {
    const input = event.target;
    if (input.type !== "radio" || input.name !== "proj01-request" || !input.checked
      || !requests.some((request) => request.id === input.value)) return;
    selectById(input.value);
  };
  render();
  container.addEventListener("change", select);
  return {
    requests,
    selectById,
    get selectedRequestId() { return selectedRequestId; },
    getRouteState: (id) => routeStates.get(id),
    setStatus(id, status) {
      const request = requests.find((item) => item.id === id);
      if (!request || !Object.hasOwn(statusLabels, status)) throw new Error("需求狀態無效。");
      request.status = status;
      const element = container.querySelector(`[data-request-status="${id}"]`);
      if (element) element.textContent = statusLabels[status];
      for (const listener of changeListeners) listener({ type: "status", id });
    },
    setRouteState(id, state) {
      routeStates.set(id, state);
      // 只更新路線提示，不重建 radio，保留鍵盤操作中的焦點。
      const element = container.querySelector(`[data-request-route="${id}"]`);
      if (element) {
        element.textContent = routeLabels[state.status] ?? "";
        element.title = state.error ?? "";
      }
      for (const listener of changeListeners) listener({ type: "route", id });
    },
    subscribeSelection(listener) {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
    subscribeChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    render,
    dispose() {
      container.removeEventListener("change", select);
      selectionListeners.clear();
      changeListeners.clear();
    },
  };
}
