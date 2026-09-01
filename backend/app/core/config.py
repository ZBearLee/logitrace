"""集中配置：所有环境变量经此读取，代码里不出现裸 os.getenv。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # 应用
    app_name: str = "LogiTrace"
    debug: bool = False

    # MySQL（第 03 步 Docker 编排后填真实值）
    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = "logitrace"
    mysql_password: str = "logitrace"
    mysql_database: str = "logitrace"

    @property
    def mysql_dsn(self) -> str:
        """SQLAlchemy 连接串（异步驱动 aiomysql）。"""
        return (
            f"mysql+aiomysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
        )

    # Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0

    # AI（通用命名，零厂商字眼；无 Key 时相关功能降级）
    ai_api_key: str = ""
    ai_base_url: str = ""
    ai_model: str = ""


settings = Settings()
