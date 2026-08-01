"use client";

import { Icon } from "@iconify/react";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="error-page">
      <span>
        <Icon icon="solar:cloud-cross-bold-duotone" />
      </span>
      <h1>页面暂时没有准备好</h1>
      <p>实时服务可能正在短暂维护，你也可以稍后再试。</p>
      <button type="button" onClick={reset}>
        <Icon icon="solar:refresh-linear" />
        重新加载
      </button>
    </main>
  );
}
