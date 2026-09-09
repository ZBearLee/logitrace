// 登录契约类型：对齐后端 app/api/routes/auth.py。
export interface LoginIn {
  username: string
  password: string
}

export interface LoginOut {
  access_token: string
  token_type: string
  username: string
  role: string
}
