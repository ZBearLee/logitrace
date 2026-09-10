import CesiumMap from './components/CesiumMap'
import { useAsyncResource } from '@/hooks/useAsyncResource'
import { getMapOverview } from '@/api/shipments'

export default function Dashboard() {
  // 大屏数据一次拉全：港口 + 航线聚合接口，避免按运单逐条请求（N+1）
  const { data, error } = useAsyncResource(() => getMapOverview(), [])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0b1f33' }}>
      <CesiumMap data={data} />
      {/* 数据拉取失败时地球照常显示，只给轻提示不清屏 */}
      {error != null && (
        <div
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            color: 'rgba(255,255,255,0.45)',
            fontSize: 12,
          }}
        >
          航线数据加载失败，显示可能不是最新的
        </div>
      )}
    </div>
  )
}
