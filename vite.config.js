import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const { ACCESS_KEY: accessKey, ACCESS_TOKEN: accessToken } = env;

  if (!accessKey || !accessToken) {
    throw new Error("Set ACCESS_KEY and ACCESS_TOKEN in the .env file.");
  }

  return {
    define: {
      "import.meta.env.ACCESS_KEY": JSON.stringify(accessKey),
      "import.meta.env.ACCESS_TOKEN": JSON.stringify(accessToken),
    },
  };
});
