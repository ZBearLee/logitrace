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

    @property
    def mysql_dsn_sync(self) -> str:
        """同步连接串：批量生成是一次性任务，用不着异步。"""
        return (
            f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
        )


settings = Settings()
