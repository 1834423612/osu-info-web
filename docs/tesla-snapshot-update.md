# Tesla 价格快照更新

Tesla 的两个官方 GET 接口可能拒绝服务器出口。项目因此把 West 3rd 站点的每周手动快照固定放在：

```text
data/tesla-snapshots/18647/
  get-charger-details.json
  get-location-details.json
```

程序直接读取这两个文件，并从顶层 `_snapshot.capturedAt` 显示快照时间。不要把浏览器 Cookie、请求头、HAR、指纹或完整网页保存到项目。

## 浏览器控制台导出

1. 使用 Chrome 正常打开 `https://www.tesla.com/findus/location/supercharger/18647`，确认页面已经显示站点详情。
2. 打开 DevTools → Console，粘贴并执行下面整段命令。
3. 点击页面右下角出现的“导出本站价格快照”按钮。
4. 在 Chrome 目录选择器中只选择项目里的叶子目录 `data/tesla-snapshots/18647`。不要选择项目根目录或 `data/tesla-snapshots` 父目录；脚本会拒绝目录名不是 `18647` 的位置。

```js
(() => {
  const match = location.pathname.match(/\/findus\/location\/superchargers?\/([^/?#]+)/);
  if (!match) throw new Error("请先打开 Tesla Supercharger 站点详情页");

  const locationSlug = decodeURIComponent(match[1]);
  if (locationSlug !== "18647") {
    throw new Error("本项目命令只允许导出 West 3rd 站点 18647");
  }
  const endpoints = {
    "get-charger-details.json":
      `/api/findus/get-charger-details?locationSlug=${encodeURIComponent(locationSlug)}` +
      "&programType=supercharger&locale=en-US&isInHkMoTw=false",
    "get-location-details.json":
      `/api/findus/get-location-details?locationSlug=${encodeURIComponent(locationSlug)}` +
      "&functionTypes=nacs&locale=en_US&isInHkMoTw=false",
  };

  document.getElementById("osu-tesla-snapshot-export")?.remove();
  const button = document.createElement("button");
  button.id = "osu-tesla-snapshot-export";
  button.textContent = "导出本站价格快照";
  Object.assign(button.style, {
    position: "fixed",
    right: "24px",
    bottom: "24px",
    zIndex: "2147483647",
    border: "0",
    borderRadius: "999px",
    background: "#e82127",
    color: "white",
    padding: "13px 18px",
    font: "700 14px system-ui",
    boxShadow: "0 10px 28px rgba(0,0,0,.24)",
    cursor: "pointer",
  });

  button.onclick = async () => {
    button.disabled = true;
    button.textContent = "正在读取两个官方 GET…";
    try {
      const directory = window.showDirectoryPicker
        ? await window.showDirectoryPicker({
            id: "osu-tesla-snapshot",
            mode: "readwrite",
          })
        : null;
      if (directory && directory.name !== "18647") {
        throw new Error("请选择 data/tesla-snapshots/18647 叶子目录");
      }
      const capturedAt = new Date().toISOString();
      const files = await Promise.all(
        Object.entries(endpoints).map(async ([fileName, sourceUrl]) => {
          const response = await fetch(sourceUrl, {
            method: "GET",
            cache: "no-store",
            credentials: "same-origin",
          });
          const contentType = response.headers.get("content-type") ?? "";
          if (!response.ok || !contentType.includes("application/json")) {
            throw new Error(
              `${fileName}: HTTP ${response.status}, ${contentType || "未知类型"}`,
            );
          }
          const officialPayload = await response.json();
          const payload = {
            ...officialPayload,
            _snapshot: {
              capturedAt,
              locationSlug,
              sourceUrl: new URL(sourceUrl, location.origin).href,
            },
          };
          return [fileName, JSON.stringify(payload, null, 2) + "\n"];
        }),
      );

      for (const [fileName, contents] of files) {
        if (directory) {
          const handle = await directory.getFileHandle(fileName, {
            create: true,
          });
          const writable = await handle.createWritable();
          await writable.write(contents);
          await writable.close();
        } else {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(
            new Blob([contents], { type: "application/json" }),
          );
          link.download = fileName;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        }
      }

      button.textContent = directory
        ? "已更新两个快照文件"
        : "已下载；请移入快照目录";
      button.style.background = "#067647";
      console.table(
        files.map(([fileName]) => ({ fileName, locationSlug, capturedAt })),
      );
      setTimeout(() => button.remove(), 3500);
    } catch (error) {
      button.disabled = false;
      button.textContent = "导出失败，点击重试";
      button.style.background = "#b42318";
      console.error("[Tesla snapshot]", error);
    }
  };

  document.body.append(button);
  console.info("请点击页面右下角的“导出本站价格快照”按钮。");
})();
```

如果浏览器不支持目录选择器，命令会下载两个 JSON；确认浏览器允许多文件下载后，再手动将它们移入上述固定目录。目录写入会逐个完成；若第二个文件写入失败，后续构建会因两份时间戳不一致而停止，不会发布混合快照。

更新后必须重新构建并重启/部署应用：

```bash
git diff -- data/tesla-snapshots/18647
npm run typecheck && npm run build
```

解析器会同时校验两份 `_snapshot.capturedAt`、官方 `sourceUrl` 与响应内部的 18647 站点标识。浏览器 EV 缓存键也包含该快照时间，因此新构建不会继续读取上一周的本地快照；服务器对快照降级响应使用 `no-store`。

本站价格弹窗使用无脚本、无同源权限的 `sandbox` iframe，只渲染解析后的 Tesla / Member 与非 Tesla 两组价格，不加载保存下来的 Tesla HTML、远程脚本或页面 DOM。
