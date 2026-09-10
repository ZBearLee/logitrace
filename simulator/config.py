"""模拟器配置：独立读取环境变量，不依赖 backend 代码。

默认值与 deploy/docker-compose.yml 保持一致，本地可直接跑。
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = "logitrace"
    mysql_password: str = "logitrace"
    mysql_database: str = "logitrace"

    # Redis：实时位置流写这里（默认 localhost，容器里改 redis 主机名）
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_password: str = ""

    # 实时流节奏：每 tick_seconds 真实秒，推进 advance_minutes 仿真分钟。
    # advance_minutes=1 即 1 倍速：每真实秒推进 1 仿真分钟，移动最贴近真实节奏，
    # 但几天物流要很久才动完；需要快速演示时临时调大（如 2~10），值越大推进越快。
    tick_seconds: float = 1.0
    advance_minutes: int = 1

    # 滞留检测 v1：窗口内速度持续低于 stall_speed(km/h) 判为滞留
    stall_speed: float = 2.0
    stall_window: int = 20

    # 周期性把当前点落库，让历史轨迹随时间增长（避免每 tick 写库）
    persist_minutes: int = 60

    @property
    def mysql_dsn_sync(self) -> str:
        """同步连接串：批量生成是一次性任务，用不着异步。"""
        return (
            f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
        )

    @property
    def redis_url(self) -> str:
        auth = f":{self.redis_password}@" if self.redis_password else ""
        return f"redis://{auth}{self.redis_host}:{self.redis_port}/{self.redis_db}"


settings = Settings()
