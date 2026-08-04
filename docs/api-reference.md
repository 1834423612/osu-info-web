# API 与外部数据源参考

状态：维护参考，最后按代码和官方服务目录核对于 **2026-08-04**。

本文分清三类数据：本项目自己的 Next.js Route Handler、浏览器直接请求的上游，以及已经接入或已验证可继续接入的 Ohio State FITS ArcGIS 图层。除特别注明外，运行时数据均为只读 `GET`。

## 1. 当前数据流总览

| 功能 | 首选调用方 | 上游 | 项目内返回/消费格式 | 当前缓存与刷新 |
| --- | --- | --- | --- | --- |
| 车库占用 | 浏览器直连 | CampusParc `garageapi` | `GarageApiResponse` | 每 60 秒；浏览器保留最后一次成功响应 |
| 停车证地块 | 本项目服务器 | OSU FITS ArcGIS Parking layer | GeoJSON `FeatureCollection<Polygon\|MultiPolygon>` | 服务器/CDN 15 分钟，陈旧响应可用 24 小时 |
| CABS 线路目录 | 本项目服务器 | OSU Content API | `{ routes, lastModified }` | 5 分钟，陈旧响应可用 1 小时 |
| CABS 线路详情 | 本项目服务器 | OSU Content API | `{ code, patterns, stops, lastModified }` | 15 分钟，陈旧响应可用 24 小时；浏览器每 10 分钟更新 |
| CABS 车辆 | 本项目服务器 | OSU Content API | `{ vehicles, lastModified }` | 上游不缓存；同源响应 10 秒，浏览器每 15 秒轮询 |
| 校园施工影响 | 本项目服务器 | OSU FITS Construction Impacts | 归一化 GeoJSON `CampusImpactResponse` | 服务器/CDN 30 分钟，陈旧响应可用 24 小时；图层默认关闭 |
| 公共充电站 | 浏览器优先，服务器回退 | NLR/DOE AFDC | `EvStationsResponse` | 浏览器与服务器均 6 小时；失败时最长使用 7 天陈旧缓存 |
| Tesla 详情 | 浏览器优先，服务器/受信任出口回退 | Tesla 两个详情 GET | 归一化为 `EvStation` | EV 浏览器缓存 6 小时；服务器 15 分钟；失败时明确使用静态快照或 AFDC 基础资料 |
| 底图 | 浏览器 | OpenStreetMap raster tiles | PNG tile | 由浏览器及上游控制 |

主要类型定义：

- [`src/types/parking.ts`](../src/types/parking.ts)
- [`src/types/transit.ts`](../src/types/transit.ts)
- [`src/types/ev.ts`](../src/types/ev.ts)
- [`src/types/campus-gis.ts`](../src/types/campus-gis.ts)

## 2. 本项目 Route Handlers

### `GET /api/parking-areas`

代码：[`src/app/api/parking-areas/route.ts`](../src/app/api/parking-areas/route.ts)

查询参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `zones` | 是 | 逗号分隔；只接受 `A,B,C,CX,WA,WB,WC,WCO`，重复项会去除 |

服务器固定查询主校区包围框 `-83.065,39.975,-82.985,40.035`，不会把客户端输入拼成任意 ArcGIS URL。上游为：

```text
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Transportation/MapServer/0/query
```

请求字段为 `OBJECTID,Name,CPNAME,Permit,Usage,VisitorPark,Link`，并指定 `inSR=4326`、`outSR=4326`、`f=geojson`。成功时直接返回 GeoJSON：

```ts
type ParkingAreasResponse = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  {
    OBJECTID: number;
    Name?: string;
    CPNAME?: string;
    Permit?: string;
    Usage?: string;
    VisitorPark?: string;
    Link?: string | null;
  }
>;
```

无有效 `zones` 时返回空 `FeatureCollection`；上游失败返回 HTTP 502 和带 `error` 的空集合。`Cache-Control` 为 `s-maxage=900, stale-while-revalidate=86400`。

### `GET /api/campus/impacts`

代码：[`src/app/api/campus/impacts/route.ts`](../src/app/api/campus/impacts/route.ts)

该接口不接受客户端查询参数。服务器固定 OSU 官方 Construction Impacts 图层、主校区 envelope、`Publish='Yes'` 和最小字段集合，并请求 `outSR=4326`、`f=geojson`。已结束的记录按 `End_Date` 过滤；尚未开始但已发布的记录会保留，以便用户提前规划。

上游：

```text
GET https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Construction/MapServer/0/query
```

返回：

```ts
type CampusImpactResponse = {
  data: FeatureCollection<Polygon | MultiPolygon, {
    id: number;
    name: string;
    summary?: string;
    startDate?: string; // ISO 8601
    endDate?: string;   // ISO 8601
    affectsParking: boolean;
    affectsVehicles: boolean;
    affectsPedestrians: boolean;
    affectsCyclists: boolean;
    isEvent: boolean;
    impactType: "construction" | "event" | "other";
    impactColor: string;
    officialMapUrl: "https://maps.osu.edu/";
  }>;
  count: number;
  updatedAt: string;
  source: { label: string; url: string; queryUrl: string };
};
```

服务器重验证 1800 秒；响应声明 `s-maxage=1800, stale-while-revalidate=86400`。原始 `Comments` 只作为纯文本渲染，避免把上游 Markdown/HTML 直接注入页面。地图偏好 `mapConstructionImpactsVisible` 保存在本地，默认关闭以避免增加地图密度。

### `GET /api/transit/routes`

代码：[`src/app/api/transit/routes/route.ts`](../src/app/api/transit/routes/route.ts)

上游：`GET https://content.osu.edu/v2/bus/routes`，可用服务器环境变量 `CABS_API_BASE` 覆盖基地址。

```ts
type TransitRoutesResponse = {
  routes: TransitRoute[];
  lastModified?: string;
  error?: string;
};
```

服务器重验证 300 秒；响应声明 `s-maxage=300, stale-while-revalidate=3600`。上游失败返回 HTTP 502 和空 `routes`。

### `GET /api/transit/routes/:code`

代码：[`src/app/api/transit/routes/[code]/route.ts`](../src/app/api/transit/routes/%5Bcode%5D/route.ts)

`code` 会转为大写并限制为 1–8 个字母或数字；无效值返回 HTTP 400。上游为：

```text
GET https://content.osu.edu/v2/bus/routes/{CODE}
```

```ts
type TransitRouteDetailResponse = {
  code: string;
  patterns: TransitPattern[]; // encodedPolyline 在浏览器中解码为完整路线
  stops: TransitStop[];
  lastModified?: string;
  error?: string;
};
```

服务器重验证 900 秒；响应声明 `s-maxage=900, stale-while-revalidate=86400`。浏览器还会验证 polyline 至少有两个合法经纬度点。

### `GET /api/transit/vehicles`

代码：[`src/app/api/transit/vehicles/route.ts`](../src/app/api/transit/vehicles/route.ts)

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `routes` | 是 | 逗号分隔线路代码；同样限制为 1–8 个字母或数字，最多 10 条 |

服务器并行请求每条线路：

```text
GET https://content.osu.edu/v2/bus/routes/{CODE}/vehicles
```

某条线路失败不会使整批失败；该线路只产生 0 个车辆。10 位或 13 位数字时间戳会规范化为 ISO 时间。返回：

```ts
type TransitVehiclesResponse = {
  vehicles: TransitVehicle[];
  lastModified?: string;
};
```

上游使用 `no-store`，同源响应为 `s-maxage=10, stale-while-revalidate=20`。

### `GET /api/ev/stations`

代码：[`src/app/api/ev/stations/route.ts`](../src/app/api/ev/stations/route.ts)

两种白名单调用：

```text
GET /api/ev/stations?source=nlr
GET /api/ev/stations?source=tesla&stationId=afdc-320148
```

Tesla `stationId` 只允许 [`KNOWN_TESLA_LOCATIONS`](../src/lib/ev-stations.ts) 中的站点；客户端不能传任意上游 URL。当前白名单是 West 3rd `afdc-320148` 和 Greater Columbus Convention Center `afdc-118948`。

返回结构：

```ts
type EvStationsResponse = {
  stations: EvStation[];
  generatedAt: string;
  sourceUpdatedAt?: string;
  isFallback: boolean;
  warning?: string;
  requestOrigin?: "browser" | "server" | "mixed" | "snapshot";
  upstreams?: EvUpstreamStatus[];
  requestId?: string;
};
```

诊断信息不包含 API key、Cookie、完整请求头或原始响应体。响应头包括 `X-EV-Request-Id`、`X-EV-Source` 和 `X-EV-Upstream-State`。进程内按来源缓存并合并并发请求：NLR 6 小时、Tesla 15 分钟；Tesla 陈旧缓存最长 24 小时，NLR 陈旧缓存最长 7 天。路由另按客户端地址限制为每分钟 90 次。注意这些内存状态不会跨多个 serverless 实例共享。

NLR 失败可能返回 429 或 502。Tesla 上游失败时路由仍可返回 HTTP 200，但 `isFallback=true`，并使用明确标注的快照或保留 AFDC 基础资料；消费者必须读取 `isFallback`、`requestOrigin` 和 `upstreams`，不能只看 HTTP 200。

## 3. 浏览器直接调用

### CampusParc 车库状态

代码：[`src/hooks/use-parking-status.ts`](../src/hooks/use-parking-status.ts)、[`src/lib/parking-feed.ts`](../src/lib/parking-feed.ts)

```text
GET https://garageapi.campusparc.com/status
```

可用 `NEXT_PUBLIC_GARAGE_API_URL` 覆盖。浏览器每 60 秒请求，12 秒超时，返回格式：

```ts
type GarageApiResponse = {
  Garages: Array<{
    GarageId: number;
    GarageName: string;
    GarageCount: number;
    GarageCapacity: number;
    UsePercentage: number;
    GarageType: number;
    GarageUrl: string;
    OSUID: string;
    Modified: string; // Columbus local time，无 UTC offset
    Closed: boolean;
  }>;
};
```

最后一次成功值保存在 `localStorage` 的 `buckeye-parking:garage-feed:v1`。该缓存没有硬过期时间，但页面启动后会立即重验证；若从未成功，则降级到 `data-example/status-example.json`。

### NLR / DOE AFDC

代码：[`src/hooks/use-ev-stations.ts`](../src/hooks/use-ev-stations.ts)

```text
GET https://developer.nlr.gov/api/alt-fuel-stations/v1/nearest.json
```

固定业务参数：校园中心 `40.0067,-83.0305`、5 miles、`fuel_type=ELEC`、`access=public`、`status=E`、`country=US`、`limit=all`。浏览器先用 `NEXT_PUBLIC_NLR_API_KEY` / `NEXT_PUBLIC_NREL_API_KEY`，缺省为 `DEMO_KEY`；直连失败后才调用同源 `/api/ev/stations?source=nlr`。私钥必须只配置为服务器端 `NLR_API_KEY` 或 `NREL_API_KEY`。

原始 AFDC `fuel_stations[]` 会被归一化为 `EvStation[]`；其中 `status_code` 是运营状态，不是实时空闲端口。客户端缓存键为 `buckeye-parking:ev-stations:v6`：新鲜 6 小时，失败时最多使用 7 天；跨标签页请求保护为 2 分钟，NLR 429 至少冷却 1 小时并遵守更长的 `Retry-After`。

### Tesla 两个详情 GET

URL 由 [`teslaDetailsEndpoints()`](../src/lib/tesla-ev.ts) 生成：

```text
GET https://www.tesla.com/api/findus/get-charger-details
  ?locationSlug={slug}&programType=supercharger&locale=en-US&isInHkMoTw=false

GET https://www.tesla.com/api/findus/get-location-details
  ?locationSlug={slug}&functionTypes=nacs&locale=en_US&isInHkMoTw=false
```

浏览器以 `credentials=omit` 直连；若 CORS、Akamai 或网络失败，再调用同源服务器。服务器可选 `TESLA_FETCH_PROXY_URL` 和 `TESLA_FETCH_PROXY_TOKEN`，但代理目标仍由站点白名单构造。两份响应必须同时成功并通过 [`parseTeslaStation()`](../src/lib/tesla-ev.ts) 才能标记为 `dataState="live"`。

West 3rd 的人工快照位于 `data/tesla-snapshots/18647/`，更新步骤见 [Tesla 价格快照更新](./tesla-snapshot-update.md)。快照不包含 Cookie、HAR、指纹或完整网页。

### OpenStreetMap 与外部导航

MapLibre 在浏览器读取：

```text
https://a.tile.openstreetmap.org/{z}/{x}/{y}.png
https://b.tile.openstreetmap.org/{z}/{x}/{y}.png
https://c.tile.openstreetmap.org/{z}/{x}/{y}.png
```

Google Maps directions/search、CampusParc、CABS、Tesla、AFDC 站点页等 URL 只是用户点击后的顶层导航，不由本项目抓取。设备定位来自浏览器 Geolocation API，也不会发送给本项目服务器。

### 静态核对来源（不是运行时 API）

以下官方资料用于维护仓库内规则或地点元数据，页面加载时不会自动抓取：

| 用途 | 代码入口 | 官方来源 |
| --- | --- | --- |
| 停车证、价格、时段 | [`src/data/permits.ts`](../src/data/permits.ts) | CampusParc permit comparison、2026–27 rate table、surface/garage access table、off-peak 与 event parking 页面 |
| 20 个停车设施详情 | [`src/data/parking-facilities.ts`](../src/data/parking-facilities.ts) | CampusParc Find Parking 各设施直达页、2026–27 rate table、visitor parking 与 late-night 页面 |
| 停车权限判定说明 | [`src/lib/permit-access.ts`](../src/lib/permit-access.ts) | CampusParc parking definitions、surface/garage access PDF |
| 校内 EV 地点与定价说明 | [`src/data/parking-locations.ts`](../src/data/parking-locations.ts) | `https://ttm.osu.edu/other-transit-and-services/electric-charging-stations` |
| CABS 站点静态核对 | 同上 | `https://ttm.osu.edu/cabs-bus-stop-list` |
| Tesla 价格降级 | [`src/lib/tesla-snapshot.ts`](../src/lib/tesla-snapshot.ts) | 已打开的 Tesla 官方站点页中手动导出的两个官方 GET 响应 |

这些来源的“核对日期”与程序实时数据的 `updatedAt` 含义不同；UI 不应把静态规则核对日期显示成实时更新时间。

截至 2026-08-04，CampusParc 的 late-night 专页与 Parking Policies 对 West Campus 指定区及最长停放时长存在公开文字差异。因此程序不硬编码这一冲突项，只把“持证 commuter late-night 指定区”与“访客付费替代”分开说明，并保留两个官方核对入口；现场标牌和最新页面优先。

## 4. Ohio State FITS ArcGIS 官方图层

官方目录：

- [Apps 服务目录](https://gissvc.osu.edu/arcgis/rest/services/Apps)
- [Campusmap Construction](https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Construction/MapServer)
- [Campusmap Buildings and POI](https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Buildings_POI/MapServer)
- [Campusmap Services and Amenities](https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Services_Amenities/MapServer)
- [Campusmap Transportation](https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Transportation/MapServer)

这些服务的元数据声明 `JSON, geoJSON, PBF` 查询格式，单层 `maxRecordCount=2000`。服务目录未公布面向本应用的调用配额或可用性 SLA；缓存建议是本项目的保护策略，不应表述为 OSU 官方保证。

### 通用 GeoJSON 查询参数

本项目建议所有新图层都通过受限的同源 Route Handler 调用，而不是开放一个可转发任意 `where` 或 URL 的代理：

```ts
const params = new URLSearchParams({
  where: "...allowlisted expression...",
  outFields: "...minimal,allowlisted,fields...",
  returnGeometry: "true",
  geometry: "-83.065,39.975,-82.985,40.035",
  geometryType: "esriGeometryEnvelope",
  spatialRel: "esriSpatialRelIntersects",
  inSR: "4326",
  outSR: "4326",
  geometryPrecision: "6",
  maxAllowableOffset: "0.000005",
  f: "geojson",
});
```

`outSR=4326` 不可省略：Buildings/POI 服务原生为 Web Mercator，而 Construction 服务使用以 feet 为单位的 NAD83 HARN 坐标系。GeoJSON 中 ArcGIS 日期字段实测为 Unix epoch milliseconds。

响应必须验证为 `FeatureCollection`，只接受预期几何类型，并丢弃非有限坐标或完全离开允许校园包围框的几何。若返回 `exceededTransferLimit`，使用 `resultOffset` / `resultRecordCount` 分页；不要默默截断到 2000 条。

### Construction Impacts — 已接入

图层与 query URL：

```text
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Construction/MapServer/0
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Construction/MapServer/0/query
```

| 项目 | 值 |
| --- | --- |
| Geometry | `Polygon` |
| 建议 `where` | `Publish='Yes'`；再由应用按 `Start_Date` / `End_Date` 过滤当前、即将发生或历史 |
| 建议字段 | `OBJECTID,ConstructionID,ImpactType,NAME,NOTES,Comments,Start_Date,End_Date,Parking,Vehicle,Pedestrian,Cyclist,Event,Bldg_Num,CentralCampus,WestCampus,WMC` |
| 稳定显示键 | 优先 `ConstructionID`，缺失时用 `OBJECTID` |
| 实测 | 固定校园包围框内 15 个 `Publish='Yes'` feature（2026-08-04） |

`Parking`、`Vehicle`、`Pedestrian`、`Cyclist`、`Event` 为 `Yes/No` 影响标记。`ImpactType` 允许 `Construction/Event/Other`，但实测已发布记录中也可能是 `null`，UI 不应依赖它作为唯一分类。`Comments` 可能含 Markdown 风格的官方链接；应以纯文本渲染，或只把通过 HTTPS allowlist 校验的链接转为可点击内容。

可复制的官方 GeoJSON 验证命令：

```bash
curl --get \
  'https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Construction/MapServer/0/query' \
  --data-urlencode "where=Publish='Yes'" \
  --data-urlencode 'outFields=OBJECTID,ConstructionID,ImpactType,NAME,NOTES,Comments,Start_Date,End_Date,Parking,Vehicle,Pedestrian,Cyclist,Event,Bldg_Num' \
  --data-urlencode 'returnGeometry=true' \
  --data-urlencode 'geometry=-83.065,39.975,-82.985,40.035' \
  --data-urlencode 'geometryType=esriGeometryEnvelope' \
  --data-urlencode 'spatialRel=esriSpatialRelIntersects' \
  --data-urlencode 'inSR=4326' \
  --data-urlencode 'outSR=4326' \
  --data-urlencode 'f=geojson'
```

当前同源接口为 `GET /api/campus/impacts`，缓存 30 分钟并允许 24 小时 stale。地图只在用户打开“施工与通行影响”时请求和显示图层；已过期面不会覆盖地图，已发布的即将开始项目会保留。

### Buildings

图层与 query URL：

```text
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Buildings_POI/MapServer/1
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Buildings_POI/MapServer/1/query
```

| 项目 | 值 |
| --- | --- |
| Geometry | `Polygon` 或 `MultiPolygon` |
| 建议 `where` | `Status='Active'`；如需施工中建筑可明确加入对应状态 |
| 建议字段 | `OBJECTID,BLDG_NUM,BLDG_NAME,ComName,Address,OwnerName,Status,CampusMap,PhotoLink,AlsoKnownAs,SchedulingAbbreviation` |
| 显示名称 | `CampusMap` → `BLDG_NAME` → `ComName` |
| 实测 | 固定校园包围框内 455 个 active feature（2026-08-04） |

`CampusMap` 在 Buildings 中是地图显示名，不是 `Yes/No` 字段。`PhotoLink` 当前指向 `maps.osu.edu` 的图片；使用前仍应校验 HTTPS host。建筑变化慢，建议 `GET /api/osu-map/buildings` 缓存 12–24 小时，并仅在较高 zoom 显示可交互轮廓或标签。

### Landmark POI

图层与 query URL：

```text
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Buildings_POI/MapServer/0
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Buildings_POI/MapServer/0/query
```

| 项目 | 值 |
| --- | --- |
| Geometry | `Point` |
| 建议 `where` | `CampusMap='Yes'` |
| 字段 | `OBJECTID,AMENITY,NAME,NOTES,LINK,CampusMap` |
| 实测 | 32 个点；`AMENITY` 均为 `Points of Interest`（2026-08-04） |

该层适合 Mirror Lake、The Shoe、Fred Beekman Park 一类校园地标，不适合承担餐饮、ATM 等分类查询。

### Services / Amenities — 推荐作为分类 POI

图层与 query URL：

```text
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Services_Amenities/MapServer/0
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Services_Amenities/MapServer/0/query
```

| 项目 | 值 |
| --- | --- |
| Geometry | `Point` |
| 建议 `where` | `CampusMap='Yes'`，可再从服务器白名单加入 `AMENITY IN (...)` |
| 字段 | `OBJECTID,ADDRESS,AMENITY,BUILDING,NAME,NOTES,LINK,CampusMap` |
| 实测 | 147 个点、19 个类别（2026-08-04） |

实测类别包括 Food/Dining、Banking/ATM、Library、Medical、Recreation/Athletics、Student Services、Technology 等。建议 `GET /api/osu-map/amenities?categories=...` 只接受服务元数据中的类别白名单，缓存 1–6 小时。若同时显示 Landmark POI 和 Amenities，使用 `{service}/{layer}/{OBJECTID}` 作 key，不要仅按名称去重。

### Transportation 的其他可用层

服务：

```text
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Transportation/MapServer
```

| Layer ID | 名称 | Geometry | 关键字段/用途 |
| --- | --- | --- | --- |
| 0 | Parking | Polygon | 已使用；`Name,CPNAME,Permit,Usage,VisitorPark,Link` |
| 1 | Stops | Point | `ROUTES,Description`；静态站点参考 |
| 2 | Buckeye Express | Polyline | `ROUTE,Notes,ActiveRoute` |
| 3 | Campus Connector | Polyline | 同上 |
| 4 | Campus Loop South | Polyline | 同上 |
| 5 | East Residential | Polyline | 同上 |
| 6 | Medical Center Express | Polyline | 同上 |
| 7 | Ackerman Shuttle | Polyline | 同上 |
| 8 | Morehouse to Medcenter | Polyline | 同上 |
| 10 | Accessible Entrances | Point | `Accessible,Automated,Description,Instructions,BLDG_NUM,BLDG_NAME,Address,Link,Button,Restrictions` |
| 11 | Northwest Connector | Polyline | `ROUTE,Notes,ActiveRoute` |

查询 URL 统一为：

```text
https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Transportation/MapServer/{LAYER_ID}/query
```

CABS 当前完整线路和车辆应继续以 `content.osu.edu/v2/bus` 为主；ArcGIS polyline 是适合降级或静态核对的地图资料，不应被标成实时线路。Accessible Entrances 是较有价值的独立无障碍图层候选，建议按建筑查询并在高 zoom 才加载。

## 5. OSU GIS 接入顺序建议

1. **Construction Impacts（已完成首版）**：直接影响停车、道路、CABS、步行与骑行；已有独立开关、精确 polygon、小型提示点与官方详情入口。
2. **Amenities**：按用户选择的少数类别加载，避免默认把 147 个点全部铺在地图上。
3. **Buildings**：作为搜索、定位和详情底层，不默认给 455 个建筑都放 HTML marker。
4. **Accessible Entrances**：与选中建筑或无障碍模式联动。
5. **Landmark POI / static CABS GIS**：作为可选补充或降级，不与现有实时数据重复显示。

后续建议继续使用明确的只读接口，而不是一个通用 ArcGIS 转发器：

```text
GET /api/campus/impacts                              # 已实现
GET /api/campus/buildings                            # 候选
GET /api/campus/amenities?categories=Library,Medical # 候选
```

每个接口都应：固定官方 service/layer、固定校园 envelope、allowlist `where` 与 `outFields`、设置超时、校验 GeoJSON、限制响应大小、记录不含原始正文的诊断，并提供短期 stale。地图端应默认关闭高密度图层，把用户选择保存为本地偏好；不要一次打开停车地块、全部建筑、全部 POI、全部 CABS 标记和全部施工面。

## 6. 环境变量

| 变量 | 可见范围 | 用途 |
| --- | --- | --- |
| `NEXT_PUBLIC_GARAGE_API_URL` | 浏览器 | 覆盖 CampusParc 状态 URL |
| `CABS_API_BASE` | 服务器 | 覆盖 OSU Content bus API 基地址 |
| `NEXT_PUBLIC_NLR_API_KEY` / `NEXT_PUBLIC_NREL_API_KEY` | 浏览器 | AFDC 浏览器直连 key；会出现在客户端，请勿填私钥 |
| `NLR_API_KEY` / `NREL_API_KEY` | 服务器 | AFDC 同源回退 key；优先于 public key 与 `DEMO_KEY` |
| `TESLA_FETCH_PROXY_URL` | 服务器 | 可选受信任 Tesla 出口；服务器会附加 allowlisted `url` 参数 |
| `TESLA_FETCH_PROXY_TOKEN` | 服务器 | 上述出口的可选 Bearer token |
| `TESLA_BROWSER_USER_AGENT` | 服务器 | 覆盖 Tesla 只读 GET 的 UA；不是绕过鉴权凭据 |

规范示例见 [`.env.example`](../.env.example)。项目不应新增 `NEXT_PUBLIC_` 前缀的 Tesla token 或 NLR 私钥。

## 7. 维护检查清单

- 打开官方 layer metadata，确认 layer ID、字段名、geometry type 和 `maxRecordCount` 未变化。
- 用固定校园 envelope 做 `returnCountOnly=true` 基线检查，记录数量突变但不要把数量写成业务断言。
- 对 query 结果检查 `type === "FeatureCollection"`、预期 geometry、有限坐标和校园边界。
- ArcGIS date 统一从 epoch milliseconds 转为 `America/New_York` 展示；保留 ISO/epoch 原值用于比较。
- 只渲染已发布且与所选时间窗口相交的 construction feature。
- 所有上游 `LINK` / `PhotoLink` 都重新解析并只允许 HTTPS；不要使用上游 HTML。
- `exceededTransferLimit` 必须分页，不能把少于预期的列表当作完整结果。
- 将 FITS/Ohio State 数据出处展示在地图或详情页；该应用仍须保持“非官方产品”说明。
- 每次变更缓存、调用方或返回类型时，同步更新本文和 README 的“功能与数据刷新”。
