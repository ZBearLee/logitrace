import CesiumMap from './components/CesiumMap'

export default function Dashboard() {
  // 大屏页：占满 Content，地球满铺；健康状态已上移到 Header 状态灯
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0b1f33' }}>
      <CesiumMap />
    </div>
  )
}
