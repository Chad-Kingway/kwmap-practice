const pending = new Map();

export function loadSdk(name) {
  if (!["mapPlus", "mapThree"].includes(name)) {
    return Promise.reject(new Error("不支援的地圖 SDK。"));
  }
  if (pending.has(name)) return pending.get(name);

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://kw3dmap.localking.com.tw/openapi/loader/${name}-1.4.3.loader.js`;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "origin";
    let poll;
    const finish = (error) => {
      clearTimeout(timeout);
      clearInterval(poll);
      script.onload = script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve();
      }
    };
    const timeout = setTimeout(() => finish(new Error(`${name} 1.4.3 載入逾時，請檢查官方服務與網路後重新整理。`)), 30000);
    script.onerror = () => finish(new Error(`無法載入官方 ${name} 1.4.3 SDK，請檢查 Network 的 loader 回應與網路連線。`));
    script.onload = () => {
      // loader 可能繼續載入相依檔案；等到建構函式可用才初始化範例。
      const check = () => {
        if (typeof window[name] === "function") finish();
      };
      poll = setInterval(check, 100);
      check();
    };
    document.head.append(script);
  });
  pending.set(name, promise);
  return promise;
}
