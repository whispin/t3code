// @effect-diagnostics nodeBuiltinImport:off - runs inside Vite+ before project services start.
import { remoteCacheUrl } from "./remoteCache.ts";

export default function start({ root }: { readonly root: string }) {
  const url = remoteCacheUrl(root);
  if (!url) return;
  return {
    remoteCache: process.env.VP_REMOTE_CACHE || process.env.VP_T3_TASK_CACHE_MODE || "read-write",
  };
}
