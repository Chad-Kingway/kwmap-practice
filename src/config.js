// Vite 將這些值注入前端；瀏覽器仍可讀取，不能視為伺服器端秘密。
export const accessKey = import.meta.env.ACCESS_KEY;
export const accessToken = import.meta.env.ACCESS_TOKEN;

if (!accessKey || !accessToken) {
  throw new Error("請在 .env 設定 ACCESS_KEY 與 ACCESS_TOKEN。");
}
