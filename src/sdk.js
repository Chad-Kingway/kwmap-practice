const pending = new Map();
// 官方 loader 的全域詞法綁定不一定是 window 屬性，須直接讀取 SDK 名稱。
const constructors = {
  mapPlus: () => typeof mapPlus === "function" ? mapPlus : undefined,
  mapThree: () => typeof mapThree === "function" ? mapThree : undefined,
};

export function loadSdk(name) {
  if (!Object.hasOwn(constructors, name)) {
    return Promise.reject(new Error("不支援的地圖 SDK。"));
  }
  if (pending.has(name)) return pending.get(name);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://kw3dmap.localking.com.tw/openapi/loader/${name}-1.4.3.loader.js`;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "origin";
    let poll;
    let finished = false;
    const finish = (error, constructor) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      clearInterval(poll);
      script.onload = script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve(constructor);
      }
    };
    const timeout = setTimeout(() => finish(new Error(`${name} 1.4.3 載入逾時，請檢查官方服務與網路後重新整理。`)), 30000);
    script.onerror = () => finish(new Error(`無法載入官方 ${name} 1.4.3 SDK，請檢查 Network 的 loader 回應與網路連線。`));
    script.onload = () => {
      if (finished || poll) return;
      // loader 可能繼續載入相依檔案；等到建構函式可用才初始化範例。
      const check = () => {
        const constructor = constructors[name]();
        if (constructor) finish(null, constructor);
      };
      poll = setInterval(check, 100);
      check();
    };
    try {
      document.head.append(script);
    } catch (error) {
      finish(error);
    }
  }).catch((error) => {
    // 失敗後允許重新呼叫載入，不永久保留 rejected Promise。
    pending.delete(name);
    throw error;
  });
  pending.set(name, promise);
  return promise;
}
