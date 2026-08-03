# Buckeye Parking

一个无需登录即可使用的 OSU Columbus Campus 停车便利浏览器。界面使用 Next.js、React、Tailwind CSS、Iconify 与可复用的 MapCN 风格 MapLibre 组件构建，包含实时停车占用、停车证时段判断、官方停车区域图层、CABS 实时车辆和 EV 充电位置。

> 非 Ohio State、CampusParc 或 COTA 官方产品。现场标识、入口提示、封闭通知与活动地图始终优先。

## 本地运行

需要 Node.js 20.9 或更新版本，推荐 Node.js 24 LTS。

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`。

生产检查：

```bash
npm run typecheck
npm run lint
npm run build
npm start
```

## 功能与数据刷新

- CampusParc 停车状态：浏览器直接请求 `https://garageapi.campusparc.com/status`，每 60 秒刷新；失败时使用浏览器中最后一次成功快照，再降级到仓库内的 `status-example.json`。
- CABS：服务器路由聚合 `https://content.osu.edu/v2/bus` 的当前线路、线形与车辆；所选线路车辆每 15 秒刷新。线路代码不写死，停运时 0 辆车属于正常状态。
- 停车证区域：先按本地身份筛选可购证件，再按所选证件与当前美东时段查询 Ohio State FITS ArcGIS 的 Parking 图层。地图用绿色、条纹琥珀、橙色和浅灰分别显示证件已含、稍后可停、访客计费和当前不可停。
- EV：浏览器优先用 GET 从 NLR/美国能源部 AFDC API 读取校园中心 5 英里内全部公开运营的 Level 1、Level 2 与 DC 快充（`limit=all`），并解析其价格字段；直连失败会自动调用同源 `GET /api/ev/stations`。浏览器和服务器均有 6 小时缓存，服务器另有单飞、短期失败冷却及请求限流，避免共享出口反复消耗 NLR 配额。范围内 Tesla 站点也先直连两个官方 GET，再尝试同源服务器出口；所有上游状态会分别显示并写入控制台。Tesla 仍返回 403 时，West 3rd 使用明确标为非实时的官方快照，其他站保留 NLR 资料，绝不把典型拥挤度写成实时空闲枪位。
- Tesla 手动快照：服务器出口持续被 Akamai 拒绝时，可按 [Tesla 价格快照更新说明](./docs/tesla-snapshot-update.md) 在已正常打开的 Tesla 站点页中执行只读导出命令；程序读取 `data/tesla-snapshots/18647` 下的两个 JSON。命令不保存 Cookie、请求头、HAR 或浏览器指纹。
- 时间：所有停车权限以 `America/New_York` 判断。设备处于其他时区时，界面同时显示 Columbus ET 与用户本地时间。

## 隐私

应用不提供账号系统，也不收集车牌或校园身份。以下内容只保存在当前浏览器的 `localStorage`：

- 所选停车证
- 用于筛选停车证的粗粒度身份（学生、Staff、Faculty/A&amp;P 等）
- 收藏的停车点
- EV / CABS 图层开关
- 上次成功的停车状态和 EV 站点快照

地图的定位按钮会由浏览器直接申请位置权限，并仅在主校区、医学中心、西校区与 Buckeye Lots 的缓冲范围内显示当前位置点；位置不会写入本地存储，离开页面后停止监听。

## 主要目录

```text
src/
  app/                  # 页面、样式与数据适配 Route Handlers
  components/           # 停车总览、地图、详情与停车证设置
  data/                 # 20 个停车点元数据与 2026–27 停车证规则
  hooks/                # 实时停车、CABS、EV 与本地偏好
  lib/                  # 数据校验、时区/占用格式、polyline 解码
  types/                # 数据结构
data/tesla-snapshots/   # 人工核验的 Tesla 官方 GET 快照
```

## 环境变量

无需环境变量即可运行。可按 [.env.example](./.env.example) 覆盖 CampusParc 或 CABS 上游地址。EV 浏览器直连默认使用 `DEMO_KEY`，生产部署可配置浏览器可见的 `NEXT_PUBLIC_NLR_API_KEY`；同源回退优先使用不会下发浏览器的 `NLR_API_KEY`，其次才使用 public key 或 `DEMO_KEY`。

Tesla 两个详情接口依次尝试浏览器和服务器 GET。服务器使用与正常 Chrome 同形的只读 GET 请求头，可通过仅服务端可见的 `TESLA_BROWSER_USER_AGENT` 覆盖 UA。若部署服务器出口也被 Akamai 拒绝，可配置 `TESLA_FETCH_PROXY_URL`；路由会向该受信任出口发送 `GET <proxy>?url=<encoded official Tesla URL>`，可选用 `TESLA_FETCH_PROXY_TOKEN` 作为 Bearer token。代理目标始终来自应用内 Tesla 白名单，客户端不能提供任意上游 URL。Node 原生 `fetch` 不保证自动采用 `HTTPS_PROXY`，因此这里使用显式的受信任出口配置。无论哪一层失败，接口响应都会保留逐上游 HTTP 状态并明确标记快照，绝不会把代理或快照伪称为 Tesla 实时成功。

项目含动态 Route Handlers，因此部署目标需要支持 Next.js Node runtime；不适合纯静态文件托管。

## 官方核对入口

- [CampusParc](https://osu.campusparc.com/)
- [CampusParc News](https://osu.campusparc.com/about-us/news/)
- [CABS](https://ttm.osu.edu/cabs)
- [NLR / AFDC Developer API](https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/nearest/)
- [NLR API rate limits](https://developer.nlr.gov/docs/rate-limits/)
- [Tesla West 3rd Supercharger](https://www.tesla.com/findus/location/supercharger/18647)
- [Tesla Greater Columbus Convention Center Supercharger](https://www.tesla.com/findus/location/supercharger/columbusohiosupercharger)
- [Ohio State EV Charging](https://ttm.osu.edu/other-transit-and-services/electric-charging-stations)
- [Ohio State Academic Calendar](https://registrar.osu.edu/academic-calendar/)
- [OpenStreetMap copyright](https://www.openstreetmap.org/copyright)
