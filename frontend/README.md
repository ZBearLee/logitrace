# LogiTrace 前端

React + TypeScript + Vite + Ant Design，物流追踪平台的可视化前端。

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发服务器 <http://127.0.0.1:5173> |
| `pnpm build` | 生产构建（含类型检查） |
| `pnpm lint` | 代码检查 |

## 目录

```
src/
├── api/          接口封装，统一走 /api 前缀
├── components/   通用组件（feedback/ 下为错误呈现与错误边界）
├── constants/    展示映射层（后端枚举 → 中文文案）
├── hooks/        通用 hook（useAsyncResource 统一取数）
├── layouts/      页面框架（侧边菜单 + 顶栏）
├── pages/        业务页面
├── types/        领域/契约类型（单一来源，不依赖传输层）
└── styles/       全局样式
```

## 约定

- 包管理器 **pnpm**（不用 npm）
- 样式用 Sass，组件级写 `*.module.scss`，全局样式放 `src/styles/`
- AntD 主题通过 `ConfigProvider` 的 theme token 配置，不手写覆盖组件内部样式
- 请求后端统一用 `/api` 前缀，由 `vite.config.ts` 代理转发到 8000 端口，代码里不写死域名
- 错误处理统一走 `useAsyncResource` + `ErrorState` + `ErrorBoundary`：业务页面不写 try/catch、不写 Alert、不放「重试」按钮
