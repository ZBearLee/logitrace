export default function Dashboard() {
  // 大屏页：占满 Content，地图/地球满铺；健康状态已上移到 Header 状态灯
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0b1f33' }}>
      {/* 地图 / 地球可视化区域（Cesium 接入点） */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.35)',
          fontSize: 14,
        }}
      >
        地图 / 地球可视化区域（Cesium 接入点）
      </div>
    </div>
  )
}
