import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, Empty } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import 'antd/dist/reset.css'
import '@/styles/global.css'
import App from '@/App'
import ErrorBoundary from '@/components/feedback/ErrorBoundary'

// 部分构建环境下 ESM/CJS 互操作会把 locale 包成 { default: ... }，
// 直接传给 ConfigProvider 会静默失效并回退成英文文案，这里统一解包。
const antdLocale = (zhCN as unknown as { default?: typeof zhCN }).default ?? zhCN

// 全局统一表格空态：沿用 antd 默认空状态样式（图片），只把文案定成中文。
// 放在这里而不是各个页面，保证所有列表页（运单、订单…）表现一致。
const locale = {
  ...antdLocale,
  Table: {
    ...antdLocale.Table,
    emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />,
  },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={locale} theme={{ token: { colorPrimary: '#1677ff' } }}>
      {/* 全局错误兜底：捕获渲染期异常；放在 ConfigProvider 内层以继承主题与中文文案 */}
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ConfigProvider>
  </React.StrictMode>,
)
