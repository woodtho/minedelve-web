import { mkdir, writeFile } from "node:fs/promises";

const projectId = "appgprj_6a5ae4aeb0488191bd4780078112a76b";

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });

await writeFile(
  "dist/server/index.js",
  `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) {
      return response;
    }

    const url = new URL(request.url);
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url, request));
  },
};
`,
);

await writeFile(
  "dist/.openai/hosting.json",
  `${JSON.stringify({ project_id: projectId }, null, 2)}
`,
);
