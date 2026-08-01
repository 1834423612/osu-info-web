# Buckeye Parking

一个无需登录即可使用的 OSU Columbus Campus 停车便利浏览器。界面使用 Next.js、React、Tailwind CSS、Iconify 与 MapLibre 构建，包含实时停车占用、停车证时段判断、官方停车区域图层、CABS 实时车辆和 EV 充电位置。

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
- 停车证区域：按所选证件与当前美东时段查询 Ohio State FITS ArcGIS 的 Parking 图层，并在地图上显示一般可用的非保留地面区域。
- EV：校内 Level 2 点位来自官方静态清单；周边公共 DC 快充由 NLR/美国能源部 AFDC API 按校园中心 5 英里范围获取。浏览器每 15 分钟检查更新并保留 6 小时缓存；上游不可用时降级到经 Tesla 与 Ohio State 官方页面核对的备用站点。AFDC 的运营状态不等于充电端口实时空闲，只有来源明确提供实时枪位时界面才显示占用率。
- 时间：所有停车权限以 `America/New_York` 判断。设备处于其他时区时，界面同时显示 Columbus ET 与用户本地时间。

## 隐私

应用不提供账号系统，也不收集车牌或校园身份。以下内容只保存在当前浏览器的 `localStorage`：

- 所选停车证
- 收藏的停车点
- EV / CABS 图层开关
- 上次成功的停车状态和 EV 站点快照

地图的定位按钮会由浏览器直接申请一次性位置权限；位置不会写入本地存储。

## 主要目录

```text
src/
  app/                  # 页面、样式与数据适配 Route Handlers
  components/           # 停车总览、地图、详情与停车证设置
  data/                 # 20 个停车点元数据与 2026–27 停车证规则
  hooks/                # 实时停车、CABS、EV 与本地偏好
  lib/                  # 数据校验、时区/占用格式、polyline 解码
  types/                # 数据结构
```

## 环境变量

无需环境变量即可运行。可按 [.env.example](./.env.example) 覆盖 CampusParc 或 CABS 上游地址。EV 接口默认使用 NLR 的 `DEMO_KEY`；生产部署建议配置 `NLR_API_KEY`，减少公共演示密钥的限额影响。

项目含动态 Route Handlers，因此部署目标需要支持 Next.js Node runtime；不适合纯静态文件托管。

## 官方核对入口

- [CampusParc](https://osu.campusparc.com/)
- [CampusParc News](https://osu.campusparc.com/about-us/news/)
- [CABS](https://ttm.osu.edu/cabs)
- [NLR / AFDC Developer API](https://developer.nlr.gov/docs/transportation/alt-fuel-stations-v1/nearest/)
- [Ohio State EV Charging](https://ttm.osu.edu/other-transit-and-services/electric-charging-stations)
- [Ohio State Academic Calendar](https://registrar.osu.edu/academic-calendar/)
- [OpenStreetMap copyright](https://www.openstreetmap.org/copyright)
