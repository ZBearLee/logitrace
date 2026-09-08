// 全局兜底：捕获渲染期异常，整页 Result + 返回首页。
// 技术细节只进 console，不展示给用户。
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button, Result } from 'antd'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 预留错误上报入口；技术细节只进 console，不展示给用户
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <Result
        status="error"
        title="页面出错了"
        subTitle="这是一个未预期的错误，请返回首页或稍后重试。"
        extra={
          <Button type="primary" onClick={() => window.location.assign('/')}>
            返回首页
          </Button>
        }
      />
    )
  }
}
