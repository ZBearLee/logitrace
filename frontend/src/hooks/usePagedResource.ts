// 列表场景的取数封装，建立在 useAsyncResource 之上。
// 收敛每个列表页都会重复的样板：分页状态、筛选变化时重置页码、空值与 total 兜底。
// 调用方不再手写 page/pageSize state、不再手写 deps 数组；
// 自动重试、断网与页面重新可见的自愈、竞态保护，全部从 useAsyncResource 继承。
import { useCallback, useState } from 'react'
import { useAsyncResource } from '@/hooks/useAsyncResource'

export interface PageParams {
  page: number
  page_size: number
}

export interface PagedResult<T> {
  items: T[]
  total: number
}

export interface PagedResource<T, F> {
  /** 已做空数组兜底，页面不必再写 data?.items ?? [] */
  items: T[]
  total: number
  loading: boolean
  error: unknown
  page: number
  pageSize: number
  filters: F
  /** 更新筛选条件：内部自动重置到第一页，避免筛选后仍停在当前页导致空列表 */
  setFilters: (filters: F) => void
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  retry: () => void
}

/**
 * 列表取数。fetcher 收到的参数已合并分页条件与筛选条件。
 * @param fetcher         取数函数，参数为 { page, page_size } 与筛选条件的合并
 * @param initialFilters  初始筛选条件，同时决定筛选的类型
 * @param initialPageSize 默认每页条数
 */
export function usePagedResource<T, F extends object>(
  fetcher: (params: PageParams & F) => Promise<PagedResult<T>>,
  initialFilters: F,
  initialPageSize = 20,
): PagedResource<T, F> {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [filters, setFiltersState] = useState<F>(initialFilters)

  const setFilters = useCallback((next: F) => {
    setFiltersState(next)
    setPage(1)
  }, [])

  // filters 是 state，引用变化才重取；分页变化同理
  const { data, loading, error, retry } = useAsyncResource(
    () => fetcher({ page, page_size: pageSize, ...filters }),
    [page, pageSize, filters],
  )

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    loading,
    error,
    page,
    pageSize,
    filters,
    setFilters,
    setPage,
    setPageSize,
    retry,
  }
}
