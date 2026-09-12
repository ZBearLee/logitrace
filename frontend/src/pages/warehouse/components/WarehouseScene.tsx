// 仓库数字孪生场景：Three.js 手写（InstancedMesh 千级库位 + 月台 + 作业动画）。
// 1024 个库位如果各建一个 Mesh 就是 1024 次 draw call、明显掉帧；
// 用一个 InstancedMesh 只占一次 draw call，颜色走 instanceColor，千级库位也不会掉帧。
// 场景生命周期参照 CesiumMap：StrictMode 下必须彻底 dispose，否则反复切页残留 WebGL 上下文会白屏。
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { WarehouseLayout, WarehouseSlot } from '@/types/warehouse'

interface Props {
  layout: WarehouseLayout
  /** 选中库位下标；变化时不重建场景，只改该实例颜色 */
  selectedIndex?: number | null
  onSelectSlot?: (slot: WarehouseSlot | null) => void
}

/** 库位与间距（场景单位≈米）：留出的通道让「排」看起来像真实货架巷道。 */
const SLOT_W = 1.1
const SLOT_H = 0.9
const SLOT_D = 1.1
const COL_GAP = 1.35
const ROW_GAP = 2.1
const LEVEL_H = 1.25
/** 每 8 列留一条拣货巷道：既是真实仓库形态，也让千级库位有可读的层次。 */
const AISLE_EVERY = 8
const AISLE_W = 2.2

const STATUS_COLOR: Record<string, string> = {
  occupied: '#2f81f7',
  empty: '#33465c',
  reserved: '#f0a020',
}
const SELECTED_COLOR = '#ffd666'
const DOCK_COLOR: Record<string, string> = { loading: '#2ea043', idle: '#4a5a6e' }
const FLOW_COLOR = '#3fd0c9'

/** 列 → x 坐标：按 AISLE_EVERY 插入巷道，避免整片等距看起来像棋盘。 */
function colToX(col: number) {
  const aisleCount = Math.floor(col / AISLE_EVERY)
  return col * COL_GAP + aisleCount * AISLE_W
}

export default function WarehouseScene({ layout, selectedIndex, onSelectSlot }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  // 选中态只改实例颜色，不重建场景：用 ref 桥接，避免每次点选都重建 WebGL 上下文
  const onSelectRef = useRef(onSelectSlot)
  useEffect(() => {
    onSelectRef.current = onSelectSlot
  }, [onSelectSlot])
  const meshRef = useRef<THREE.InstancedMesh | null>(null)
  const prevSelectedRef = useRef<number | null>(null)

  // 主场景：只在布局数据变化时重建
  useEffect(() => {
    const mount = mountRef.current
    if (mount == null) return

    const { cols, rows, slots } = layout
    const width = mount.clientWidth || 900
    const height = mount.clientHeight || 520

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0b1f33')

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 3000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    // 高分屏按设备像素比渲染，但封顶 2 倍：再高只是白烧填充率
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    // 不允许翻到地面以下：仓库是地面视角，钻到地板下没有信息量
    controls.maxPolarAngle = Math.PI / 2 - 0.05

    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.85)
    dir.position.set(60, 90, 40)
    scene.add(dir)

    // 地面：略大于库区，给月台与作业区留位
    const totalX = colToX(cols)
    const halfX = totalX / 2
    const halfZ = (rows * ROW_GAP) / 2
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(totalX + 24, rows * ROW_GAP + 28),
      new THREE.MeshLambertMaterial({ color: '#13293f' }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.set(totalX / 2 - halfX, -0.02, 0)
    scene.add(ground)

    // ---- 库位：一个 InstancedMesh 承载全部（性能核心）----
    const count = slots.length
    const geo = new THREE.BoxGeometry(SLOT_W, SLOT_H, SLOT_D)
    const mat = new THREE.MeshLambertMaterial()
    const inst = new THREE.InstancedMesh(geo, mat, count)
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    // 记录每个实例的世界坐标：作业动画的终点、拾取后的定位都要用
    const positions = new Float32Array(count * 3)
    slots.forEach((s, i) => {
      const x = colToX(s.col) - halfX
      const y = s.level * LEVEL_H + SLOT_H / 2
      const z = (s.row - rows / 2) * ROW_GAP
      dummy.position.set(x, y, z)
      dummy.updateMatrix()
      inst.setMatrixAt(i, dummy.matrix)
      inst.setColorAt(i, color.set(STATUS_COLOR[s.status] ?? STATUS_COLOR.empty))
      positions[i * 3] = x
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = z
    })
    inst.instanceMatrix.needsUpdate = true
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true
    scene.add(inst)
    meshRef.current = inst

    // ---- 月台：数量少（6 个），单独建 Mesh 便于着色与识别 ----
    const dockGeo = new THREE.BoxGeometry(3, 0.35, 1.6)
    const dockPositions = new Map<string, THREE.Vector3>()
    layout.docks.forEach((d, i) => {
      const mat2 = new THREE.MeshLambertMaterial({
        color: new THREE.Color(DOCK_COLOR[d.status] ?? DOCK_COLOR.idle),
      })
      const m = new THREE.Mesh(dockGeo, mat2)
      const x = totalX / 2 - halfX - (layout.docks.length / 2) * 4 + i * 4
      const z = halfZ + 6
      m.position.set(x, 0.18, z)
      scene.add(m)
      dockPositions.set(d.code, new THREE.Vector3(x, 0.6, z))
    })

    // ---- 作业动画：运单从月台搬向目标库位 ----
    // 只建 len(flows) 个小方块（≤8），走 lerp + 抛物线抬升，成本可忽略
    const flowGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8)
    const flowMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(FLOW_COLOR) })
    const flows = layout.flows.map((f, i) => {
      const m = new THREE.Mesh(flowGeo, flowMat)
      scene.add(m)
      const from = dockPositions.get(f.from_dock) ?? new THREE.Vector3(0, 0.6, halfZ + 6)
      const si = Math.min(Math.max(f.to_slot, 0), count - 1)
      const to = new THREE.Vector3(
        positions[si * 3],
        positions[si * 3 + 1] + 0.4,
        positions[si * 3 + 2],
      )
      // 错开出发时间，避免所有货箱叠在一起同时移动
      return { mesh: m, from, to, t: (i / Math.max(1, layout.flows.length)) % 1 }
    })

    // 初始视角：按库区实际包围盒居中斜俯视，让仓库在画布正中且完整可见。
    const minPos = new Float32Array(3).fill(Infinity)
    const maxPos = new Float32Array(3).fill(-Infinity)
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 3; j++) {
        const v = positions[i * 3 + j]
        if (v < minPos[j]) minPos[j] = v
        if (v > maxPos[j]) maxPos[j] = v
      }
    }
    dockPositions.forEach((p) => {
      if (p.x < minPos[0]) minPos[0] = p.x
      if (p.x > maxPos[0]) maxPos[0] = p.x
      if (p.y < minPos[1]) minPos[1] = p.y
      if (p.y > maxPos[1]) maxPos[1] = p.y
      if (p.z < minPos[2]) minPos[2] = p.z
      if (p.z > maxPos[2]) maxPos[2] = p.z
    })
    // 空数据（库位与月台都没有）时包围盒仍是 ±Infinity，兜底到原点，避免 NaN 相机
    const empty = !Number.isFinite(maxPos[0])
    const center = new THREE.Vector3(
      empty ? 0 : (minPos[0] + maxPos[0]) / 2,
      empty ? 0 : (minPos[1] + maxPos[1]) / 2,
      empty ? 0 : (minPos[2] + maxPos[2]) / 2,
    )
    const size = new THREE.Vector3(
      empty ? 0 : maxPos[0] - minPos[0],
      empty ? 0 : maxPos[1] - minPos[1],
      empty ? 0 : maxPos[2] - minPos[2],
    )
    const maxDim = Math.max(size.x, size.y, size.z) || 20
    const distance = maxDim * 1.45
    const viewDir = new THREE.Vector3(20, 24, 26).normalize()
    camera.position.copy(center).add(viewDir.clone().multiplyScalar(distance))
    controls.target.copy(center)
    controls.update()

    // ---- 拾取：射线打 InstancedMesh，instanceId 即库位 index ----
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObject(inst, false)[0]
      if (hit?.instanceId == null) {
        onSelectRef.current?.(null)
        return
      }
      onSelectRef.current?.(slots[hit.instanceId] ?? null)
    }
    renderer.domElement.addEventListener('click', onClick)

    // ---- 渲染循环：只做 controls 更新与作业动画推进 ----
    let raf = 0
    let last = performance.now()
    const animate = () => {
      raf = requestAnimationFrame(animate)
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      for (const f of flows) {
        f.t += dt * 0.16
        if (f.t > 1) f.t = 0
        const t = f.t
        f.mesh.position.lerpVectors(f.from, f.to, t)
        // 抛物线抬升：平推看起来像贴地滑行，抬一点更像搬运
        f.mesh.position.y = f.from.y + (f.to.y - f.from.y) * t + Math.sin(Math.PI * t) * 1.6
      }
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // ---- 尺寸自适应 ----
    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth || width
      const h = mount.clientHeight || height
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    })
    ro.observe(mount)

    // ---- 销毁：几何/材质/渲染器都要释放，否则切页回来上下文耗尽白屏 ----
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('click', onClick)
      controls.dispose()
      geo.dispose()
      mat.dispose()
      dockGeo.dispose()
      flowGeo.dispose()
      flowMat.dispose()
      ground.geometry.dispose()
      ;(ground.material as THREE.Material).dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      meshRef.current = null
      prevSelectedRef.current = null
    }
  }, [layout])

  // 选中态：只改实例颜色，避免重建场景
  useEffect(() => {
    const inst = meshRef.current
    if (inst == null || inst.instanceColor == null) return
    const color = new THREE.Color()
    const prev = prevSelectedRef.current
    if (prev != null && prev < layout.slots.length) {
      inst.setColorAt(
        prev,
        color.set(STATUS_COLOR[layout.slots[prev].status] ?? STATUS_COLOR.empty),
      )
    }
    if (selectedIndex != null && selectedIndex < layout.slots.length) {
      inst.setColorAt(selectedIndex, color.set(SELECTED_COLOR))
    }
    inst.instanceColor.needsUpdate = true
    prevSelectedRef.current = selectedIndex ?? null
  }, [selectedIndex, layout])

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
}
