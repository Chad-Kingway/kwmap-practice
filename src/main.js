import "./style.css";

// 新增範例時，在此登記明確的 module 路徑。
const examples = {
  "message-box": () => import("./examples/message-box.js"),
  satellite: () => import("./examples/satellite.js"),
};

const exampleName = new URLSearchParams(window.location.search).get("example") ?? "message-box";

async function loadExample() {
  try {
    if (!Object.hasOwn(examples, exampleName)) {
      throw new Error(`找不到範例「${exampleName}」。可用範例：${Object.keys(examples).join("、")}`);
    }

    const example = await examples[exampleName]();
    await example.init();
  } catch (error) {
    const message = document.createElement("p");
    message.className = "example-error";
    message.setAttribute("role", "alert");
    message.textContent = error.message;
    document.getElementById("app").replaceChildren(message);
    console.error("範例載入失敗：", error);
  }
}

loadExample();
