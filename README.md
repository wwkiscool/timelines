# MOMENT 一瞬

一个以实时时钟和太阳系公转动画为中心的时间线网站，使用 Next.js App Router、React 和 TypeScript，通过 Spring Boot 后端保存账号与时刻。

## 本地运行

要求 Node.js 20.9 或更新版本。

```bash
npm install
npm run dev
```

开发服务默认从 http://localhost:3001 启动。如果端口被占用，会依次尝试 3002、3003 等端口，请以终端输出的实际地址为准。可通过 `PORT` 环境变量更改起始端口；使用 `npm run dev -- --port 4000` 时则固定使用指定端口。

Windows 下会先检查系统 TCP 监听表，再探测可用端口，确保已被其他服务使用的端口被跳过。

```bash
npm run build     # 生产构建
npm start         # 运行生产版本
npm run typecheck # TypeScript 检查
npm test          # 请求超时、取消和错误处理回归测试
```

如果当前 Windows 环境不允许访问默认 npm 缓存，可使用 `npm install --cache .npm-cache`。

## 已实现

- 北京时间默认显示 `HH:mm:ss`，点击时间区域展开 `HH:mm:ss.mmm`，再次点击只收起毫秒，画面不显示切换提示；暂停后继续会立即同步设备当前时间。
- 午夜蓝、冰青与电蓝的科技配色，多层星星持续向下流动。黄色太阳与九颗星球以倾斜视角立体公转，包含地球卫星与土星环。
- 默认进入沉浸模式，太阳系在首屏中间更突出地呈现；仍可切换退出沉浸，查看页面文案。镜头跟随太阳，太阳与九颗星球沿共同弧形路径平缓地向右上方前行；行星围绕太阳持续公转，公转平面随路径转向，连贯的螺旋历史轨迹沿弧线向后延伸并逐渐淡出。取消完整的太阳椭圆和密集叠加的轨道线，让前进方向清楚可见。三档运动速度、暂停 / 继续，保存记录后波纹回应。
- 近大远小透视、较小的轨道倾角、更舒缓的公转周期、球体明暗、前后遮挡与远处雾化。镜头不随鼠标悬停偏移；拖动或使用方向键旋转观察视角，Home 恢复视角；移动端横向拖动旋转，纵向手势保留页面滚动。
- 记录指定瞬间、分类与备注、详情、搜索、筛选和 JSON 导出。
- 手机号验证码登录、服务端保存个人时刻、编辑和删除、搜索与导出；每人最多 200 条，演示数据单独标识且不入库。
- 当日进度、会话时长、全屏模式、空格暂停 / 继续、N 记录此刻。
- 响应式布局、键盘操作、原生 dialog 焦点管理、减少动态效果偏好支持。

## 时间与性能

时间来自设备 `Date.now()`，展示时区固定为 Asia/Shanghai（UTC+8），并不代表经过服务器校时。毫秒是数据与显示精度，画面按屏幕刷新率更新，通常每秒约 60 帧，而非每毫秒重绘。

数字通过 DOM ref 更新，避免每帧重新渲染 React 组件树。星空使用三层 CSS 动画与本地生成的星点图案，太阳系使用 Canvas 绘制三维坐标的透视投影，并按深度排列星球与轨迹，无 WebGL / Three.js 依赖。限制移动端绘制量与设备像素比，缓存同尺寸、同视角的投影，页面隐藏时暂停动画；暂停和减少动态效果偏好会冻结自动运动，主动拖动与键盘调节视角仍可使用。不加载外部字体、图片或统计脚本，首页可静态预渲染；登录后的数据通过同源 API 代理连接后端。

首屏内置由实际绘图逻辑生成的桌面和手机静态画面；画布成功绘制后才隐藏它。首次绘制直接执行，缺少 ResizeObserver 或较新的媒体查询、动画接口时使用兼容方式，避免初始化延迟或接口缺失导致空画面。

`scripts/render-solar-preview.mjs` 使用实际 Canvas 绘图逻辑检查多个尺寸、视角和动画阶段，并生成预览。通过 `--canvas-module` 指定本地 `@napi-rs/canvas` 模块路径；添加 `--write-posters` 更新两张首屏静态图，添加 `--animation-frames` 生成动画预览帧。这个模块仅用于本地验证，不参与网站运行。

0.5× / 1× / 2× 同时改变星空下移、公转和前进的速度，不改变实际时钟；切换速度保留当前运动位置。「回到此刻」恢复实时运行、默认速度和场景初始位置。星球大小、轨道间距与公转周期为视觉示意，并非真实比例。

星空视觉参考 [sarazond 的向上流动星空](https://codepen.io/sarazond/pen/LYGbwj)，早期太阳系参考为 [saransh 的 Pure CSS Solar System](https://codepen.io/saransh/pen/BKJun)。原站访问被自动审批服务拦截，当前为根据用户描述编写的本地实现，未复制或核验原版源码；首页提供星空参考链接。

本次太阳系运动方向参考用户提供的 [星芒科普抖音短链接](https://v.douyin.com/q7l-5taTfY8/)及标题中“太阳系三维螺旋前行”的描述。浏览器自动审批返回 503，无法打开视频核验具体画面；本地实现围绕斜向上的弧形前进路径、随路径转向的公转平面和渐隐螺旋轨迹调整。

## 主要文件

- `src/components/moment-app.tsx`：主界面、时钟、收藏与交互。
- `src/components/solar-system-scene.tsx`：立体太阳系画面、动画生命周期与播放速度同步。
- `src/components/solar-system-scene.module.css`：太阳系画布的独立样式。
- `src/lib/solar-system.ts`：三维公转、弧形前进路径、螺旋历史、透视投影与深度排序绘制。
- `src/components/starfield.tsx`：三层星空与播放状态同步。
- `src/components/starfield.module.css`：连续下移、循环衔接与减少动态效果的样式。
- `src/components/modal.tsx`：原生对话框。
- `src/lib/time.ts`：时区计算、格式化和演示数据。
- `src/app/globals.css`：完整视觉样式、响应式及减少动态效果支持。

后端在 D:\mySpace\nextjs\backend，数据管理在 D:\mySpace\nextjs\frontend 的 /dashboard/timelines。新数据库按 nextjs/TIMELINES.md 完成迁移；现有 learn_demo 已于 2026-11-09 执行并验证时间线增量迁移。用户端的 BACKEND_API_URL 默认 http://127.0.0.1:8080（见 .env.example），更改后重启。用户通过手机号验证码登录，首次注册为普通用户；管理员权限只由数据库赋予，用户站登录凭证不能进入管理接口。短信 mock 默认关闭，仅允许在显式 `dev`、`h2` 或 `timeline-local` profile 中启用；同时含 `prod` / `production` 会拒绝启动。开发构建会显示测试验证码，生产前端遇到 mock 会提示配置错误且不显示验证码。真实短信供应商尚未接入，非 mock 模式明确返回“短信服务尚未配置”，不会生成未发送的验证码，也不会接受旧 mock 验证码。旧 localStorage 记录保留，登录后在时刻集点击“导入本机旧记录”，确认账号后导入。云端记录不会再写回本机旧存储。速度、沉浸和毫秒显示偏好关联账号保存。

## 后端启动

在本项目目录运行以下命令，启动 `D:\mySpace\nextjs\backend` 的现有编译产物：

```powershell
.\scripts\start-timeline-backend.ps1
```

后端绑定 `127.0.0.1:8080`，使用真实 MySQL 和显式 `timeline-local` profile；这个本地启动脚本明确启用短信 mock，不能用于正式部署。脚本读取后端 `.env.local`，进程环境变量优先；缺少 JWT 密钥时，将稳定的随机密钥保存到本项目被 Git 忽略的 `.env.backend.local`。日志、上传文件和运行信息保存在 `artifacts/backend-local`。`-CheckOnly` 可检查配置、依赖、编译产物和端口；后端源码变更后应先重新构建后端。

2026-11-09 的历史接入报告记录了 MySQL 表、索引、外键及原有行数检查；2026-11-10 本轮修复未迁移真实数据库、未重启现有 8080 后端。当前源码已通过 TypeScript 检查、生产构建、11 项请求回归、24 项定向后端测试和 45 次隔离 H2 HTTP 检查，覆盖登录、重新登录后保留记录与偏好、账号隔离、CRUD、搜索、导入去重、200 条上限及导出。统一请求截止时间为 20 秒，覆盖响应体读取；主动取消保持原语义，写入超时不自动重试并提示先核对结果。太阳系重新通过 7 种尺寸、17 个视角、59 个阶段检查，报告包含生成时间和源码 SHA-256，首屏海报已更新。浏览器已尝试首页与测试登录，但后续操控超时并被取消，完整浏览器增删改查、下载、重登与移动端页面验收仍待补完；不能将 HTTP 或离屏绘图检查视为完整页面验收。

## 隔离接口验证

测试服务使用 H2 内存数据库。依次运行：

```powershell
.\scripts\start-timeline-h2-qa.ps1
.\scripts\start-timeline-client-qa.ps1
node .\scripts\check-timeline-api.mjs
```

测试后端监听 18080，测试用户端监听 3301；运行信息和结果位于 `artifacts/timeline-integration-qa`，与正式服务分开。每次启动客户端会创建独立的 `client-<时间>-<随机标识>` 源码快照，保留旧目录；端口已占用时明确退出，不终止已有服务。两个脚本均支持 `-Foreground` 由当前终端或进程管理器托管；使用该模式时分别在两个终端启动，再运行接口检查。测试数据只在内存中，停止 H2 后消失。最新 HTTP 结果在 `api-checks.json`，修复汇总在 `verification.json` 的 `latestRepairVerification` 中，太阳系报告在 `artifacts/solar-system/validation.json`。
