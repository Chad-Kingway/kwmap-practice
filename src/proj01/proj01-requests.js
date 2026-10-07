export function mountRequestList(container) {
  // 預製座標僅作需求資料，尚未向道路服務確認可用路線。
  const requests = [
    { id: "request-01", origin: [121.561, 25.0334], destination: [121.567, 25.034], color: "#175cd3", status: "pending" },
    { id: "request-02", origin: [121.543, 25.041], destination: [121.553, 25.045], color: "#15803d", status: "pending" },
    { id: "request-03", origin: [121.517, 25.047], destination: [121.532, 25.052], color: "#c2410c", status: "pending" },
  ];
  let selectedRequestId = null;
  const render = () => {
    container.innerHTML = requests.map((request, index) => `
      <label class="proj01-request">
        <input type="radio" name="proj01-request" value="${request.id}" ${selectedRequestId === request.id ? "checked" : ""}>
        <span class="proj01-request-content">
          <span class="proj01-request-heading"><span class="proj01-request-color" style="background-color: ${request.color}" aria-hidden="true"></span><strong>需求 ${String(index + 1).padStart(2, "0")}</strong><span class="proj01-request-status">${request.status === "pending" ? "等待接送" : ""}</span></span>
          <span class="proj01-request-coordinate">起點 ${request.origin.join(", ")}</span>
          <span class="proj01-request-coordinate">終點 ${request.destination.join(", ")}</span>
        </span>
      </label>
    `).join("");
  };
  const select = (event) => {
    const input = event.target;
    if (input.type !== "radio" || input.name !== "proj01-request" || !input.checked
      || !requests.some((request) => request.id === input.value)) return;
    selectedRequestId = input.value;
  };
  render();
  container.addEventListener("change", select);
  return {
    get selectedRequestId() { return selectedRequestId; },
    render,
    dispose: () => container.removeEventListener("change", select),
  };
}
