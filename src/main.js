import "./style.css";
import { loadSdk } from "./sdk.js";

// 範例名稱、選單文字與明確的 module 路徑統一在此登記。
const examples = {
  "basic-map": {
    label: "基本地圖",
    load: () => import("./examples/basic-map.js"),
  },
  "message-box": {
    label: "訊息視窗",
    load: () => import("./examples/message-box.js"),
  },
  satellite: {
    label: "衛星影像",
    load: () => import("./examples/satellite.js"),
  },
  proj01: {
    label: "proj01：3D 模型實驗室",
    load: () => import("./proj01/proj01.js"),
  },
};

const exampleName = new URLSearchParams(window.location.search).get("example");
const app = document.getElementById("app");

function showHome() {
  document.title = "3D Map 範例選單";
  app.innerHTML = `
    <main class="example-menu">
      <h1>3D Map 範例選單</h1>
      <p>請選擇要練習的範例。</p>
      <nav class="example-menu-links" aria-label="範例選單"></nav>
    </main>
  `;
  const menu = app.querySelector("nav");
  for (const [name, { label }] of Object.entries(examples)) {
    const link = document.createElement("a");
    link.href = `/?example=${encodeURIComponent(name)}`;
    link.className = "example-menu-button";
    link.textContent = label;
    menu.append(link);
  }
}

async function loadExample() {
  try {
    if (!Object.hasOwn(examples, exampleName)) {
      throw new Error(`找不到範例「${exampleName}」。可用範例：${Object.keys(examples).join("、")}`);
    }

    app.innerHTML = '<main class="example-error" role="status">正在載入地圖 SDK…</main>';
    // 每次連結切換都重新載入頁面，只載入該範例需要的 SDK，避免全域依賴互相覆蓋。
    const example = await examples[exampleName].load();
    if (exampleName !== "proj01") await loadSdk("mapPlus");
    await example.init();
  } catch (error) {
    document.title = "範例載入失敗";
    const panel = document.createElement("main");
    panel.className = "example-error";
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.textContent = error.message;
    const homeLink = document.createElement("a");
    homeLink.href = "/";
    homeLink.textContent = "返回首頁";
    panel.append(message, homeLink);
    app.replaceChildren(panel);
    console.error("範例載入失敗：", error);
  }
}

if (!exampleName) {
  showHome();
} else {
  loadExample();
}
