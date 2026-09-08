// 第三方模块类型补丁：world-atlas 的 TopoJSON 与 topojson-client 无内置类型声明。
declare module 'world-atlas/countries-110m.json' {
  const value: unknown
  export default value
}

declare module 'topojson-client' {
  export function feature(topology: any, object: any): any
  export function mesh(topology: any, object?: any, filter?: (a: any, b: any) => boolean): any
}
